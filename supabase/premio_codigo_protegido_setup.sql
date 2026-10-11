-- ===========================================================================
-- CÓDIGO DO RESGATE PROTEGIDO: o ganhador só recebe o código depois de declarar
-- (ou com a chave de declaração desligada). O ligador continua vendo o código pelo
-- token dele. Remove a consulta pública antiga (consultar_premio), que entregava
-- o código pra qualquer pessoa com o CPF.
-- Rode no Supabase (SQL Editor) depois do premio_declaracao_setup.sql.
-- Pode rodar de novo sem problema.
-- ===========================================================================
drop function if exists public.consultar_premio(text);

-- Código do resgate nunca sai do banco sem a regra de declaração cumprida:
--   ganhador (anônimo, pelo CPF): recebe o código só depois de regularizado,
--   ou com a chave premio_exigir_declaracao desligada.
--   ligador (pelo token, só CPF da própria carteira): sempre recebe o código.
-- A consulta pública antiga (consultar_premio) é removida pelo premio_codigo_protegido_setup.sql.

-- Tabela da declaração (mesma de premio_declaracao_setup.sql; "if not exists" deixa rodar de novo).
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
alter table public.premio_declaracao enable row level security;

-- O CPF está na carteira deste ligador? (cliente com ficha dele, ou pedido dele com esse CPF)
create or replace function public._ligador_tem_premio(p_lig uuid, p_cpf text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles pr
     where pr.cpf = p_cpf
       and (pr.ligador_id = p_lig or exists (select 1 from public.pedidos p where p.user_id = pr.id and p.ligador_id = p_lig))
  )
$$;
revoke execute on function public._ligador_tem_premio(uuid, text) from public, anon, authenticated;

-- A ficha do ligador (ligador_id, gerente_id, status, obs) é do sistema. O próprio
-- cliente não pode gravar esses campos no próprio perfil, senão se coloca numa carteira alheia.
create or replace function public._protege_ficha_do_perfil()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or auth.uid() <> new.id or pg_trigger_depth() > 1 then return new; end if;
  if tg_op = 'INSERT' then
    if new.ligador_id is not null or new.gerente_id is not null or new.ligador_status is not null then
      raise exception 'Campo protegido.';
    end if;
  elsif new.ligador_id is distinct from old.ligador_id
     or new.gerente_id is distinct from old.gerente_id
     or new.ligador_status is distinct from old.ligador_status
     or new.ligador_obs is distinct from old.ligador_obs
     or new.ligador_at is distinct from old.ligador_at then
    raise exception 'Campo protegido.';
  end if;
  return new;
end; $$;
drop trigger if exists trg_protege_ficha_do_perfil on public.profiles;
create trigger trg_protege_ficha_do_perfil
  before insert or update on public.profiles
  for each row execute function public._protege_ficha_do_perfil();

-- Qualquer gravação de prêmio por ligador passa pela carteira dele (código, estado e valor).
create or replace function public._premio_so_da_carteira()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.ligador_id is not null and not public._ligador_tem_premio(new.ligador_id, new.cpf) then
    raise exception 'Esse CPF não está na sua carteira.';
  end if;
  return new;
end; $$;
drop trigger if exists trg_premio_so_da_carteira on public.premios_liberados;
create trigger trg_premio_so_da_carteira
  before insert or update on public.premios_liberados
  for each row execute function public._premio_so_da_carteira();

create or replace function public.ganhador_consultar_premio(p_cpf text)
returns table(codigo text, estado text, valor numeric)
language plpgsql security definer set search_path = public as $$
declare v_cpf text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g'); v_exige boolean; v_decl text;
begin
  if length(v_cpf) <> 11 then return; end if;
  if not exists (select 1 from public.premios_liberados pl where pl.cpf = v_cpf) then return; end if;
  v_exige := coalesce((select c.valor from public.configuracoes c where c.chave = 'premio_exigir_declaracao'), 'true') <> 'false';
  select d.estado into v_decl from public.premio_declaracao d where d.cpf = v_cpf;
  return query
    select case when v_exige and coalesce(v_decl, '') <> 'regularizado' then null::text else pl.codigo end,
           pl.estado, pl.valor
      from public.premios_liberados pl
     where pl.cpf = v_cpf;
end; $$;
grant execute on function public.ganhador_consultar_premio(text) to anon, authenticated;

create or replace function public.ligador_consultar_premio(p_token uuid, p_cpf text)
returns table(codigo text, estado text, valor numeric)
language plpgsql security definer set search_path = public as $$
declare v_lig uuid; v_cpf text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
begin
  select l.id into v_lig from public.ligadores l where l.token = p_token and l.ativo = true;
  if v_lig is null or length(v_cpf) <> 11 or not public._ligador_tem_premio(v_lig, v_cpf) then return; end if;
  return query select pl.codigo, pl.estado, pl.valor from public.premios_liberados pl where pl.cpf = v_cpf;
end; $$;
grant execute on function public.ligador_consultar_premio(uuid, text) to anon, authenticated;

create or replace function public.ligador_resetar_premio(p_token uuid, p_cpf text)
returns void language plpgsql security definer set search_path = public as $$
declare v_lig uuid; v_cpf text;
begin
  select id into v_lig from public.ligadores where token = p_token and ativo = true;
  if v_lig is null then raise exception 'token invalido'; end if;
  v_cpf := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
  if length(v_cpf) <> 11 then raise exception 'cpf invalido'; end if;
  if not public._ligador_tem_premio(v_lig, v_cpf) then raise exception 'Esse CPF não está na sua carteira.'; end if;
  delete from public.premios_liberados where cpf = v_cpf;
end; $$;
grant execute on function public.ligador_resetar_premio(uuid, text) to anon, authenticated;
