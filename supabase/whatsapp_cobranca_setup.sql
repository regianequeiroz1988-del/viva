-- Lembrete manual de Pix pelo WhatsApp.
-- Execute uma vez no SQL Editor do Supabase antes de publicar o front novo.

begin;

-- Pré-requisito de segurança para qualquer operação financeira/admin: garante
-- que um usuário comum não consiga promover a própria conta nem fabricar saldo.
create or replace function public.protege_profile_sensiveis()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.is_admin() then return new; end if;
  if new.is_admin is distinct from old.is_admin then
    raise exception 'permissao negada: alterar is_admin';
  end if;
  if new.cpf is distinct from old.cpf then
    raise exception 'permissao negada: alterar cpf';
  end if;
  if coalesce(new.creditos_nao_sacaveis, 0) > coalesce(old.creditos_nao_sacaveis, 0)
     or coalesce(new.saldo_saque, 0) > coalesce(old.saldo_saque, 0)
     or coalesce(new.total_sacado, 0) > coalesce(old.total_sacado, 0)
     or coalesce(new.pontos, 0) > coalesce(old.pontos, 0) then
    raise exception 'permissao negada: aumentar saldo/creditos/pontos';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protege_profile on public.profiles;
create trigger trg_protege_profile
  before update on public.profiles
  for each row execute function public.protege_profile_sensiveis();
revoke update (is_admin) on public.profiles from anon, authenticated;

alter table public.pedidos
  add column if not exists pix_copia_cola text,
  add column if not exists pix_gerado_at timestamptz,
  add column if not exists pix_expira_em timestamptz,
  add column if not exists whatsapp_optin boolean,
  add column if not exists whatsapp_optin_at timestamptz,
  add column if not exists whatsapp_optin_versao text,
  add column if not exists whatsapp_optin_telefone text,
  add column if not exists whatsapp_lembrete_at timestamptz,
  add column if not exists whatsapp_lembrete_status text,
  add column if not exists whatsapp_lembrete_admin_id uuid,
  add column if not exists whatsapp_lembrete_atendimento text,
  add column if not exists whatsapp_lembrete_destino text,
  add column if not exists whatsapp_lembrete_modelo text;

-- Campo de opt-in fica apenas como legado de versoes anteriores. O fluxo atual
-- e interno: todos os pedidos sao considerados elegiveis, sem aceite no checkout.
update public.pedidos set whatsapp_optin = true where whatsapp_optin is distinct from true;
update public.pedidos
set pagador = jsonb_set(coalesce(pagador, '{}'::jsonb), '{whatsapp_optin}', 'true'::jsonb, true)
where coalesce(pagador ->> 'whatsapp_optin', '') is distinct from 'true';
alter table public.pedidos alter column whatsapp_optin set default true;
alter table public.pedidos alter column whatsapp_optin set not null;

comment on column public.pedidos.whatsapp_optin is
  'Campo legado; todos os pedidos sao considerados consentidos para o lembrete interno.';
comment on column public.pedidos.whatsapp_optin_telefone is
  'Campo legado mantido apenas para compatibilidade com pedidos antigos.';
comment on column public.pedidos.whatsapp_lembrete_status is
  'No modo manual, preparado significa que o admin reservou/abriu o fluxo; não confirma envio.';

create index if not exists pedidos_whatsapp_cobranca_idx
  on public.pedidos (pix_expira_em)
  where status = 'pendente'
    and whatsapp_lembrete_at is null
    and metodo is distinct from 'deposito';

-- Cada cobrança criada fica vinculada de forma imutável ao pedido, gateway e valor.
-- Assim uma charge antiga não pode aprovar outro pedido e o pagamento continua
-- reconhecível mesmo quando o cliente gera um novo Pix pelo rodízio.
create table if not exists public.pix_tentativas (
  id              uuid primary key default gen_random_uuid(),
  pedido_id       uuid not null references public.pedidos(id) on delete cascade,
  gateway         text not null,
  order_id        text,
  charge_id       text not null,
  valor_centavos  bigint not null check (valor_centavos > 0),
  pix_copia_cola  text,
  pix_expira_em   timestamptz,
  created_at      timestamptz not null default now(),
  unique (gateway, charge_id)
);

create index if not exists pix_tentativas_pedido_idx
  on public.pix_tentativas (pedido_id, created_at desc);

-- Não fazemos backfill automático de cobranças antigas: antes do lockdown de
-- RLS esses campos podiam ter vindo do navegador. Pedidos pendentes antigos devem
-- gerar um novo Pix para ganhar um vínculo server-side verificável.

create or replace function public.bloquear_update_pix_tentativas()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'o vinculo de uma tentativa Pix e imutavel';
end;
$$;

drop trigger if exists pix_tentativas_sem_update on public.pix_tentativas;
create trigger pix_tentativas_sem_update
before update on public.pix_tentativas
for each row execute function public.bloquear_update_pix_tentativas();

revoke execute on function public.bloquear_update_pix_tentativas() from public;

alter table public.pix_tentativas enable row level security;
revoke insert, update, delete on table public.pix_tentativas from anon, authenticated;
grant select on table public.pix_tentativas to authenticated;
drop policy if exists "pix_tentativas_admin_select" on public.pix_tentativas;
create policy "pix_tentativas_admin_select" on public.pix_tentativas
  for select using (public.is_admin());

comment on table public.pix_tentativas is
  'Vínculo server-side entre cada cobrança Pix e seu pedido; clientes não podem inserir ou alterar.';

create or replace function public.pedido_sem_tentativa_pix(p_pedido uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.pedidos p
    where p.id = p_pedido
      and p.user_id = auth.uid()
  ) and not exists (
    select 1 from public.pix_tentativas t where t.pedido_id = p_pedido
  );
$$;

revoke all on function public.pedido_sem_tentativa_pix(uuid) from public;
grant execute on function public.pedido_sem_tentativa_pix(uuid) to authenticated;

insert into public.configuracoes (chave, valor) values
  ('whatsapp_cobranca_ativo', 'true')
on conflict (chave) do update set valor = excluded.valor;

insert into public.configuracoes (chave, valor) values
  ('whatsapp_cobranca_numero', ''),
  ('whatsapp_cobranca_espera_minutos', '5'),
  ('whatsapp_cobranca_mensagem', $$Olá, {{nome}}! Tudo bem?

Vimos que você gerou o Pix do pedido #{{pedido}}, no valor de {{valor}}, mas o pagamento ainda não foi confirmado.

Se ainda tiver interesse, é só realizar o pagamento para confirmar sua participação. Vou te enviar o código Pix na próxima mensagem.

Esse Pix é válido até {{expiracao}}. Se você já pagou, desconsidere esta mensagem. Se precisar de ajuda, responda por aqui.$$)
on conflict (chave) do nothing;

-- Volta automaticamente o template promocional para a mensagem curta.
update public.configuracoes
set valor = $$Olá, {{nome}}! Tudo bem?

Vimos que você gerou o Pix do pedido #{{pedido}}, no valor de {{valor}}, mas o pagamento ainda não foi confirmado.

Se ainda tiver interesse, é só realizar o pagamento para confirmar sua participação. Vou te enviar o código Pix na próxima mensagem.

Esse Pix é válido até {{expiracao}}. Se você já pagou, desconsidere esta mensagem. Se precisar de ajuda, responda por aqui.$$
where chave = 'whatsapp_cobranca_mensagem'
  and (lower(valor) like '%renato%' or lower(valor) like '%viva sorte+%');

-- Reserva atomica: duas abas/admins nao conseguem preparar o mesmo lembrete.
-- O retorno traz os dados canonicos vindos do banco; a tela apenas abre o WhatsApp.
create or replace function public.whatsapp_normalizar_br(p_numero text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_digits text := regexp_replace(coalesce(p_numero, ''), '[^0-9]', '', 'g');
begin
  if left(v_digits, 2) = '00' then
    v_digits := substring(v_digits from 3);
  end if;

  if left(v_digits, 2) = '55' and length(v_digits) in (12, 13) then
    v_digits := substring(v_digits from 3);
  end if;

  if length(v_digits) in (10, 11) and v_digits ~ '^[1-9][0-9]{9,10}$' then
    return '55' || v_digits;
  end if;

  return '';
end;
$$;

revoke all on function public.whatsapp_normalizar_br(text) from public;

drop function if exists public.preparar_lembrete_whatsapp(uuid);
drop function if exists public.preparar_lembrete_whatsapp(uuid, boolean);
create or replace function public.preparar_lembrete_whatsapp(
  p_pedido uuid,
  p_ignorar_espera boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pedido public.pedidos%rowtype;
  v_agora timestamptz := clock_timestamp();
  v_espera integer := 5;
  v_valor_espera text;
  v_ativo text;
  v_modelo text;
  v_numero_atendimento text;
  v_numero_atendimento_norm text;
  v_nome text;
  v_telefone_perfil text;
  v_destino text;
  v_pix_copia_cola text;
  v_pix_expira_em timestamptz;
  v_pix_gerado_at timestamptz;
  v_lembrete_at timestamptz;
  v_nova_reserva boolean := false;
  v_admin uuid := auth.uid();
begin
  if not public.is_admin() then
    raise exception 'apenas admin';
  end if;

  v_ativo := coalesce((select valor from public.configuracoes where chave = 'whatsapp_cobranca_ativo'), 'false');
  if lower(trim(v_ativo)) <> 'true' then
    return jsonb_build_object('ok', false, 'motivo', 'O lembrete esta desativado nas Configuracoes.');
  end if;

  select * into v_pedido
  from public.pedidos
  where id = p_pedido
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'Pedido nao encontrado.');
  end if;

  select coalesce(nullif(nome_social, ''), nome, ''), telefone
  into v_nome, v_telefone_perfil
  from public.profiles
  where id = v_pedido.user_id;

  if v_telefone_perfil is null then
    return jsonb_build_object('ok', false, 'motivo', 'Cliente sem telefone no perfil.');
  end if;


  v_destino := public.whatsapp_normalizar_br(v_telefone_perfil);
  v_numero_atendimento := coalesce((select valor from public.configuracoes where chave = 'whatsapp_cobranca_numero'), '');
  v_numero_atendimento_norm := public.whatsapp_normalizar_br(v_numero_atendimento);
  v_modelo := coalesce(nullif((select valor from public.configuracoes where chave = 'whatsapp_cobranca_mensagem'), ''), 'Olá, {{nome}}! Tudo bem? Vimos que você gerou o Pix do pedido #{{pedido}}, mas ainda não finalizou. Vou enviar o código Pix na próxima mensagem.');
  v_pix_copia_cola := coalesce(nullif(trim(v_pedido.pix_copia_cola), ''), nullif(trim(v_pedido.pagador ->> 'pix_copia_cola'), ''));
  begin
    v_pix_expira_em := coalesce(v_pedido.pix_expira_em, nullif(v_pedido.pagador ->> 'pix_expira_em', '')::timestamptz);
  exception when others then
    v_pix_expira_em := v_pedido.pix_expira_em;
  end;
  begin
    v_pix_gerado_at := coalesce(v_pedido.pix_gerado_at, nullif(v_pedido.pagador ->> 'pix_gerado_at', '')::timestamptz);
  exception when others then
    v_pix_gerado_at := v_pedido.pix_gerado_at;
  end;

  if v_pedido.status <> 'pendente' then
    return jsonb_build_object('ok', false, 'motivo', 'O pedido nao esta mais pendente.');
  end if;
  if v_pedido.metodo = 'deposito' then
    return jsonb_build_object('ok', false, 'motivo', 'Depositos nao recebem este lembrete.');
  end if;
  if v_destino = '' then
    return jsonb_build_object('ok', false, 'motivo', 'O cliente nao possui um celular brasileiro valido.');
  end if;
  if coalesce(trim(v_pix_copia_cola), '') = '' then
    return jsonb_build_object('ok', false, 'motivo', 'Este pedido nao possui um Pix salvo.');
  end if;
  if v_pix_expira_em is null or v_pix_expira_em <= v_agora then
    return jsonb_build_object('ok', false, 'motivo', 'O Pix deste pedido ja expirou.');
  end if;
  if v_pix_expira_em <= v_agora + interval '3 minutes' then
    return jsonb_build_object('ok', false, 'motivo', 'Faltam menos de 3 minutos para este Pix expirar; gere um novo codigo antes do lembrete.');
  end if;

  select valor into v_valor_espera
  from public.configuracoes
  where chave = 'whatsapp_cobranca_espera_minutos';
  if coalesce(v_valor_espera, '') ~ '^[0-9]+$' then
    v_espera := least(120, greatest(0, v_valor_espera::integer));
  end if;
  if not coalesce(p_ignorar_espera, false)
     and coalesce(v_pix_gerado_at, v_pedido.created_at) + make_interval(mins => v_espera) > v_agora then
    return jsonb_build_object('ok', false, 'motivo', 'Aguarde o tempo minimo configurado antes do lembrete.');
  end if;

  if v_pedido.whatsapp_lembrete_at is null then
    update public.pedidos
    set whatsapp_lembrete_at = v_agora,
        whatsapp_lembrete_status = 'preparado',
        whatsapp_lembrete_admin_id = v_admin,
        whatsapp_lembrete_atendimento = v_numero_atendimento_norm,
        whatsapp_lembrete_destino = v_destino,
        whatsapp_lembrete_modelo = v_modelo
    where id = p_pedido
    returning whatsapp_lembrete_at into v_lembrete_at;
    v_nova_reserva := true;
  else
    v_lembrete_at := v_pedido.whatsapp_lembrete_at;
  end if;

  return jsonb_build_object(
    'ok', true,
    'motivo', '',
    'lembrete_at', v_lembrete_at,
    'nova_reserva', v_nova_reserva,
    'destino', coalesce(v_pedido.whatsapp_lembrete_destino, v_destino),
    'numero_atendimento', coalesce(v_pedido.whatsapp_lembrete_atendimento, v_numero_atendimento_norm),
    'pix_copia_cola', v_pix_copia_cola,
    'pix_expira_em', v_pix_expira_em,
    'nome', v_nome,
    'total', v_pedido.total,
    'mensagem_modelo', coalesce(v_pedido.whatsapp_lembrete_modelo, v_modelo)
  );
end;
$$;

revoke all on function public.preparar_lembrete_whatsapp(uuid, boolean) from public;
grant execute on function public.preparar_lembrete_whatsapp(uuid, boolean) to authenticated;
commit;
