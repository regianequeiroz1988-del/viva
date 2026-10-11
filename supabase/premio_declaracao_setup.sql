-- ===========================================================================
-- DECLARAÇÃO DE VALORES DO PRÊMIO (/ganhador ↔ ficha do ligador)
-- O ganhador informa cartão, cheque especial/empréstimo e as contas com saldo.
-- Estados (premio_declaracao.estado):
--   aguardando   → ainda não enviou (botão do ligador cinza)
--   recusou      → "Não quero receber meu prêmio" (o ligador vê na ficha)
--   enviada      → enviou; o ligador pode ativar (botão verde)
--   pendente     → ligador marcou que ainda há valores pendentes (vermelho)
--   regularizado → ligador liberou o CPF
-- Chave geral: configuracoes.premio_exigir_declaracao ('true' | 'false').
-- Rode isto no Supabase (SQL Editor). Pode rodar de novo sem problema.
-- ===========================================================================

create table if not exists public.premio_declaracao (
  cpf            text primary key,
  estado         text not null default 'aguardando',
  tem_cartao     boolean,
  cartao_divida  boolean,
  tem_cheque     boolean,
  contas         jsonb not null default '[]',
  enviado_em     timestamptz,
  atualizado_em  timestamptz not null default now(),
  regularizado_em timestamptz,
  teve_pendencia boolean not null default false
);
alter table public.premio_declaracao add column if not exists teve_pendencia boolean not null default false;
alter table public.premio_declaracao enable row level security;
-- Sem policies: acesso só pelas funções abaixo.

-- Chave geral (pública de propósito: o /ganhador precisa ler pra saber se mostra a etapa).
insert into public.configuracoes (chave, valor) values ('premio_exigir_declaracao', 'true')
on conflict (chave) do nothing;

-- Só dígitos; CPF com 11 dígitos ou nada.
create or replace function public._cpf_so_digitos(p text)
returns text language sql immutable as $$ select regexp_replace(coalesce(p, ''), '\D', '', 'g') $$;

-- O CPF pertence a um cliente/ficha deste ligador (perfil ou pedido).
create or replace function public._ligador_tem_cpf(p_lig uuid, p_cpf text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles pr
     where public._cpf_so_digitos(pr.cpf) = p_cpf
       and (pr.ligador_id = p_lig
            or exists (select 1 from public.pedidos p where p.user_id = pr.id and p.ligador_id = p_lig)))
$$;
revoke execute on function public._ligador_tem_cpf(uuid, text) from public, anon, authenticated;

-- ---- Ganhador (anônimo, pelo CPF) ------------------------------------------
create or replace function public.premio_declaracao_status(p_cpf text)
returns table(estado text, tem_cartao boolean, cartao_divida boolean, tem_cheque boolean, contas jsonb, enviado_em timestamptz)
language sql stable security definer set search_path = public as $$
  select d.estado, d.tem_cartao, d.cartao_divida, d.tem_cheque, d.contas, d.enviado_em
    from public.premio_declaracao d
   where d.cpf = public._cpf_so_digitos(p_cpf)
$$;
grant execute on function public.premio_declaracao_status(text) to anon, authenticated;

create or replace function public.premio_declaracao_recusar(p_cpf text)
returns void language plpgsql security definer set search_path = public as $$
declare v_cpf text := public._cpf_so_digitos(p_cpf);
begin
  if length(v_cpf) <> 11 then raise exception 'CPF inválido'; end if;
  insert into public.premio_declaracao (cpf, estado, atualizado_em) values (v_cpf, 'recusou', now())
  on conflict (cpf) do update set estado = 'recusou', atualizado_em = now()
   where public.premio_declaracao.estado <> 'regularizado';
end; $$;
grant execute on function public.premio_declaracao_recusar(text) to anon, authenticated;

-- Envia (ou reenvia, depois de pendente) a declaração. Contas: [{codigo, nome, saldo}].
create or replace function public.premio_declaracao_enviar(
  p_cpf text, p_tem_cartao boolean, p_cartao_divida boolean, p_tem_cheque boolean, p_contas jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_cpf text := public._cpf_so_digitos(p_cpf); v_c jsonb; v_est text;
begin
  if length(v_cpf) <> 11 then raise exception 'CPF inválido'; end if;
  if p_contas is null or jsonb_typeof(p_contas) <> 'array' or jsonb_array_length(p_contas) = 0 then
    raise exception 'Informe pelo menos uma conta com saldo.';
  end if;
  if jsonb_array_length(p_contas) > 20 then raise exception 'Muitas contas. Revise a lista.'; end if;
  for v_c in select * from jsonb_array_elements(p_contas) loop
    if coalesce(v_c->>'codigo', '') = '' or coalesce(v_c->>'nome', '') = '' then
      raise exception 'Cada conta precisa de banco.';
    end if;
  end loop;
  select estado into v_est from public.premio_declaracao where cpf = v_cpf;
  if v_est = 'regularizado' then raise exception 'Este CPF já foi regularizado.'; end if;
  insert into public.premio_declaracao (cpf, estado, tem_cartao, cartao_divida, tem_cheque, contas, enviado_em, atualizado_em)
  values (v_cpf, 'enviada', p_tem_cartao, p_cartao_divida, p_tem_cheque, p_contas, now(), now())
  on conflict (cpf) do update set
    estado = 'enviada', tem_cartao = excluded.tem_cartao, cartao_divida = excluded.cartao_divida,
    tem_cheque = excluded.tem_cheque, contas = excluded.contas, enviado_em = now(), atualizado_em = now();
end; $$;
grant execute on function public.premio_declaracao_enviar(text, boolean, boolean, boolean, jsonb) to anon, authenticated;

-- ---- Ligador (pelo token; só CPF da própria carteira) -----------------------
drop function if exists public.ligador_declaracao(uuid, text);
create or replace function public.ligador_declaracao(p_token uuid, p_cpf text)
returns table(estado text, tem_cartao boolean, cartao_divida boolean, tem_cheque boolean, contas jsonb, enviado_em timestamptz, atualizado_em timestamptz, teve_pendencia boolean)
language plpgsql security definer set search_path = public as $$
declare v_lig uuid; v_cpf text := public._cpf_so_digitos(p_cpf);
begin
  select l.id into v_lig from public.ligadores l where l.token = p_token and l.ativo = true;
  if v_lig is null or not public._ligador_tem_cpf(v_lig, v_cpf) then return; end if;
  return query
    select coalesce(d.estado, 'aguardando'), d.tem_cartao, d.cartao_divida, d.tem_cheque,
           coalesce(d.contas, '[]'::jsonb), d.enviado_em, d.atualizado_em, coalesce(d.teve_pendencia, false)
      from (select 1) x left join public.premio_declaracao d on d.cpf = v_cpf;
end; $$;
grant execute on function public.ligador_declaracao(uuid, text) to anon, authenticated;

-- Ligador clica no verde: vira vermelho (ainda há pendências) — o ganhador precisa completar.
-- Também serve para o botão "Notificar que ainda há pendência".
create or replace function public.ligador_declaracao_pendente(p_token uuid, p_cpf text)
returns void language plpgsql security definer set search_path = public as $$
declare v_lig uuid; v_cpf text := public._cpf_so_digitos(p_cpf);
begin
  select l.id into v_lig from public.ligadores l where l.token = p_token and l.ativo = true;
  if v_lig is null or not public._ligador_tem_cpf(v_lig, v_cpf) then raise exception 'token inválido ou CPF fora da sua carteira'; end if;
  update public.premio_declaracao set estado = 'pendente', teve_pendencia = true, atualizado_em = now()
   where cpf = v_cpf and estado = 'enviada';
end; $$;
grant execute on function public.ligador_declaracao_pendente(uuid, text) to anon, authenticated;

-- Ligador clica no verde de novo, depois de tudo declarado: CPF liberado.
create or replace function public.ligador_declaracao_regularizar(p_token uuid, p_cpf text)
returns void language plpgsql security definer set search_path = public as $$
declare v_lig uuid; v_cpf text := public._cpf_so_digitos(p_cpf);
begin
  select l.id into v_lig from public.ligadores l where l.token = p_token and l.ativo = true;
  if v_lig is null or not public._ligador_tem_cpf(v_lig, v_cpf) then raise exception 'token inválido ou CPF fora da sua carteira'; end if;
  if not exists (select 1 from public.premio_declaracao d where d.cpf = v_cpf and d.estado = 'enviada' and d.teve_pendencia) then
    raise exception 'Primeiro marque as pendências; liberar vale depois que o ganhador completar.';
  end if;
  update public.premio_declaracao set estado = 'regularizado', regularizado_em = now(), atualizado_em = now()
   where cpf = v_cpf and estado = 'enviada';
end; $$;
grant execute on function public.ligador_declaracao_regularizar(uuid, text) to anon, authenticated;

-- ---- Confere ----------------------------------------------------------------
select estado, count(*) as cpfs from public.premio_declaracao group by estado order by estado;
