-- Fichas do ligador em LOTES: ele pode ter muitas fichas atribuídas, mas só VÊ as
-- liberadas (no máximo 10 "a ligar" por vez). Quando termina o lote, pede mais
-- (solicitacoes_fichas) e o admin concede pela aba Notificações.
-- Rode isto UMA vez no Supabase (SQL Editor). Pode rodar de novo sem problema.

alter table public.pedidos  add column if not exists ligador_liberado_at timestamptz;
alter table public.profiles add column if not exists ligador_liberado_at timestamptz;

create table if not exists public.solicitacoes_fichas (
  id            uuid primary key default gen_random_uuid(),
  ligador_id    uuid not null references public.ligadores(id) on delete cascade,
  status        text not null default 'pendente', -- pendente | concedida | recusada
  quantidade    int,
  created_at    timestamptz not null default now(),
  respondida_at timestamptz
);
alter table public.solicitacoes_fichas enable row level security;
-- Sem policies: acesso só pelas funções abaixo.
create index if not exists solicitacoes_fichas_pend_idx on public.solicitacoes_fichas (status, created_at);

-- Fichas liberadas ainda "a ligar" (o lote atual do ligador).
create or replace function public._fichas_pendentes(p_lig uuid)
returns int language sql stable security definer set search_path = public as $$
  select (
    (select count(*) from public.pedidos p
      where p.ligador_id = p_lig and p.ligador_liberado_at is not null and coalesce(p.ligador_status, 'a_ligar') = 'a_ligar')
  + (select count(*) from public.profiles pr
      where pr.ligador_id = p_lig and pr.ligador_liberado_at is not null and coalesce(pr.ligador_status, 'a_ligar') = 'a_ligar')
  )::int;
$$;

-- Fichas atribuídas mas ainda NÃO liberadas (a fila do ligador).
create or replace function public._fichas_na_fila(p_lig uuid)
returns int language sql stable security definer set search_path = public as $$
  select (
    (select count(*) from public.pedidos p  where p.ligador_id = p_lig and p.ligador_liberado_at is null)
  + (select count(*) from public.profiles pr where pr.ligador_id = p_lig and pr.ligador_liberado_at is null)
  )::int;
$$;

-- Libera as N fichas mais antigas da fila (pedidos e cadastros juntos). Devolve quantas.
create or replace function public._liberar_fichas(p_lig uuid, p_qtd int)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int := 0; r record;
begin
  for r in
    select 'p' as t, p.id, p.created_at from public.pedidos p
     where p.ligador_id = p_lig and p.ligador_liberado_at is null
    union all
    select 'c' as t, pr.id, pr.created_at from public.profiles pr
     where pr.ligador_id = p_lig and pr.ligador_liberado_at is null
    order by created_at asc
    limit greatest(coalesce(p_qtd, 0), 0)
  loop
    if r.t = 'p' then update public.pedidos  set ligador_liberado_at = now() where id = r.id;
    else              update public.profiles set ligador_liberado_at = now() where id = r.id; end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end; $$;

revoke execute on function public._fichas_pendentes(uuid)      from public, anon, authenticated;
revoke execute on function public._fichas_na_fila(uuid)        from public, anon, authenticated;
revoke execute on function public._liberar_fichas(uuid, int)   from public, anon, authenticated;

-- Migração das fichas que já existiam: o que o ligador já trabalhou continua
-- visível; das que estão "a ligar", libera até completar 10 por ligador.
update public.pedidos  set ligador_liberado_at = coalesce(ligador_at, now())
 where ligador_id is not null and ligador_liberado_at is null and coalesce(ligador_status, 'a_ligar') <> 'a_ligar';
update public.profiles set ligador_liberado_at = coalesce(ligador_at, now())
 where ligador_id is not null and ligador_liberado_at is null and coalesce(ligador_status, 'a_ligar') <> 'a_ligar';
select public._liberar_fichas(l.id, 10 - public._fichas_pendentes(l.id)) from public.ligadores l;

-- O ligador só enxerga (e só responde) fichas LIBERADAS.
create or replace function public.ligador_pedidos(p_token uuid)
returns setof public.pedidos
language plpgsql security definer set search_path = public as $$
declare v_lig uuid;
begin
  select l.id into v_lig from public.ligadores l where l.token = p_token and l.ativo = true;
  if v_lig is null then return; end if;
  return query select * from public.pedidos p
   where p.ligador_id = v_lig and p.ligador_liberado_at is not null
   order by p.created_at desc;
end; $$;
grant execute on function public.ligador_pedidos(uuid) to anon, authenticated;

create or replace function public.ligador_cadastros(p_token uuid)
returns table(id uuid, nome text, cpf text, telefone text,
              ligador_status text, ligador_obs text, ligador_at timestamptz, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare v_lig uuid;
begin
  select l.id into v_lig from public.ligadores l where l.token = p_token and l.ativo = true;
  if v_lig is null then return; end if;
  return query
    select pr.id, pr.nome, pr.cpf, pr.telefone, pr.ligador_status, pr.ligador_obs, pr.ligador_at, pr.created_at
    from public.profiles pr
    where pr.ligador_id = v_lig and pr.ligador_liberado_at is not null
    order by pr.created_at desc;
end; $$;
grant execute on function public.ligador_cadastros(uuid) to anon, authenticated;

create or replace function public.ligador_responder(p_token uuid, p_pedido uuid, p_status text, p_obs text)
returns void language plpgsql security definer set search_path = public as $$
declare v_lig uuid;
begin
  select l.id into v_lig from public.ligadores l where l.token = p_token and l.ativo = true;
  if v_lig is null then raise exception 'token invalido'; end if;
  if p_status not in ('a_ligar', 'bom', 'ruim', 'retorno') then raise exception 'status invalido'; end if;
  update public.pedidos set ligador_status = p_status, ligador_obs = p_obs, ligador_at = now()
   where id = p_pedido and ligador_id = v_lig and ligador_liberado_at is not null;
end; $$;
grant execute on function public.ligador_responder(uuid, uuid, text, text) to anon, authenticated;

create or replace function public.ligador_responder_cadastro(p_token uuid, p_perfil uuid, p_status text, p_obs text)
returns void language plpgsql security definer set search_path = public as $$
declare v_lig uuid;
begin
  select l.id into v_lig from public.ligadores l where l.token = p_token and l.ativo = true;
  if v_lig is null then raise exception 'token invalido'; end if;
  if p_status not in ('a_ligar', 'bom', 'ruim', 'retorno') then raise exception 'status invalido'; end if;
  update public.profiles set ligador_status = p_status, ligador_obs = p_obs, ligador_at = now()
   where id = p_perfil and ligador_id = v_lig and ligador_liberado_at is not null;
end; $$;
grant execute on function public.ligador_responder_cadastro(uuid, uuid, text, text) to anon, authenticated;

-- Situação do lote do ligador (pra tela dele).
drop function if exists public.ligador_situacao_fichas(uuid);
create or replace function public.ligador_situacao_fichas(p_token uuid)
returns table(pendentes int, na_fila int, solicitacao_pendente boolean)
language plpgsql security definer set search_path = public as $$
declare v_lig uuid;
begin
  select l.id into v_lig from public.ligadores l where l.token = p_token and l.ativo = true;
  if v_lig is null then return; end if;
  return query select public._fichas_pendentes(v_lig), public._fichas_na_fila(v_lig),
    exists(select 1 from public.solicitacoes_fichas s where s.ligador_id = v_lig and s.status = 'pendente');
end; $$;
grant execute on function public.ligador_situacao_fichas(uuid) to anon, authenticated;

-- Ligador pede mais fichas — só quando terminou o lote atual. Não duplica pedido pendente.
create or replace function public.ligador_solicitar_fichas(p_token uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_lig uuid;
begin
  select l.id into v_lig from public.ligadores l where l.token = p_token and l.ativo = true;
  if v_lig is null then raise exception 'token invalido'; end if;
  if public._fichas_pendentes(v_lig) > 0 then raise exception 'Termine as fichas atuais antes de pedir mais.'; end if;
  if exists(select 1 from public.solicitacoes_fichas s where s.ligador_id = v_lig and s.status = 'pendente') then return; end if;
  insert into public.solicitacoes_fichas (ligador_id) values (v_lig);
end; $$;
grant execute on function public.ligador_solicitar_fichas(uuid) to anon, authenticated;

-- ADMIN: pedidos de fichas pendentes (aba Notificações).
drop function if exists public.listar_solicitacoes_fichas();
create or replace function public.listar_solicitacoes_fichas()
returns table(id uuid, ligador_id uuid, ligador_nome text, created_at timestamptz, na_fila int, pendentes int)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return; end if;
  return query
    select s.id, s.ligador_id, coalesce(l.nome, l.usuario), s.created_at,
           public._fichas_na_fila(s.ligador_id), public._fichas_pendentes(s.ligador_id)
    from public.solicitacoes_fichas s join public.ligadores l on l.id = s.ligador_id
    where s.status = 'pendente'
    order by s.created_at asc;
end; $$;
grant execute on function public.listar_solicitacoes_fichas() to authenticated;

-- ADMIN: concede até 10 fichas da fila do ligador. Devolve quantas foram liberadas.
create or replace function public.conceder_fichas(p_solicitacao uuid, p_qtd int)
returns int language plpgsql security definer set search_path = public as $$
declare v_lig uuid; v_n int;
begin
  if not public.is_admin() then raise exception 'apenas admin'; end if;
  select s.ligador_id into v_lig from public.solicitacoes_fichas s where s.id = p_solicitacao and s.status = 'pendente';
  if v_lig is null then raise exception 'solicitacao nao encontrada'; end if;
  v_n := public._liberar_fichas(v_lig, least(greatest(coalesce(p_qtd, 0), 0), 10 - public._fichas_pendentes(v_lig)));
  update public.solicitacoes_fichas set status = 'concedida', quantidade = v_n, respondida_at = now() where id = p_solicitacao;
  return v_n;
end; $$;
grant execute on function public.conceder_fichas(uuid, int) to authenticated;

create or replace function public.recusar_solicitacao_fichas(p_solicitacao uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'apenas admin'; end if;
  update public.solicitacoes_fichas set status = 'recusada', respondida_at = now()
   where id = p_solicitacao and status = 'pendente';
end; $$;
grant execute on function public.recusar_solicitacao_fichas(uuid) to authenticated;

-- Remover ligador também limpa a liberação das fichas devolvidas ao fluxo.
create or replace function public.remover_ligador(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'apenas admin'; end if;
  update public.pedidos set ligador_id = null, ligador_status = null, ligador_obs = null, ligador_at = null, ligador_liberado_at = null
   where ligador_id = p_id;
  update public.profiles set ligador_id = null, ligador_status = null, ligador_obs = null, ligador_at = null, ligador_liberado_at = null
   where ligador_id = p_id;
  delete from public.ligadores where id = p_id;
end; $$;
grant execute on function public.remover_ligador(uuid) to authenticated;
