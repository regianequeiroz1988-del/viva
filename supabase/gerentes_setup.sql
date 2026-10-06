-- ===========================================================================
-- GERENTES — ficam entre o admin e os ligadores.
--  * Login próprio (usuário + senha, pgcrypto), igual ao ligador; acessa por TOKEN.
--  * Admin envia fichas (pedidos/cadastros) pro gerente: gerente_id preenchido e
--    ligador_id vazio = "estoque" do gerente.
--  * Ligador com gerente pede fichas ao gerente; o gerente libera primeiro da fila
--    do próprio ligador e completa com o estoque dele (máx. 10 "a ligar" por vez).
--  * Estoque acabou → gerente pede mais ao admin (aba Notificações).
-- Rode isto UMA vez no Supabase (SQL Editor). Pode rodar de novo sem problema.
-- Requer schema.sql + fichas_liberadas_setup.sql já aplicados.
-- ===========================================================================
create extension if not exists pgcrypto;

create table if not exists public.gerentes (
  id         uuid primary key default gen_random_uuid(),
  usuario    text unique not null,
  senha_hash text not null,
  nome       text,
  token      uuid not null default gen_random_uuid(),
  ativo      boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.gerentes enable row level security;
-- Sem policies: acesso só via funções SECURITY DEFINER.

alter table public.ligadores add column if not exists gerente_id uuid references public.gerentes(id) on delete set null;
alter table public.pedidos   add column if not exists gerente_id uuid references public.gerentes(id) on delete set null;
alter table public.profiles  add column if not exists gerente_id uuid references public.gerentes(id) on delete set null;
-- Pedido de fichas do ligador vai pro gerente dele (null = vai pro admin).
alter table public.solicitacoes_fichas add column if not exists gerente_id uuid references public.gerentes(id) on delete set null;
create index if not exists ligadores_gerente_idx on public.ligadores (gerente_id);
create index if not exists pedidos_gerente_idx   on public.pedidos (gerente_id) where ligador_id is null;
create index if not exists profiles_gerente_idx  on public.profiles (gerente_id) where ligador_id is null;

create table if not exists public.solicitacoes_gerente (
  id            uuid primary key default gen_random_uuid(),
  gerente_id    uuid not null references public.gerentes(id) on delete cascade,
  status        text not null default 'pendente', -- pendente | atendida | recusada
  quantidade    int,
  created_at    timestamptz not null default now(),
  respondida_at timestamptz
);
alter table public.solicitacoes_gerente enable row level security;
create index if not exists solicitacoes_gerente_pend_idx on public.solicitacoes_gerente (status, created_at);

-- ---- helpers internos ------------------------------------------------------
create or replace function public._gerente_do_token(p_token uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select g.id from public.gerentes g where g.token = p_token and g.ativo = true;
$$;

-- Estoque do gerente: fichas dele que ainda não foram pra nenhum ligador.
create or replace function public._estoque_gerente(p_ger uuid)
returns int language sql stable security definer set search_path = public as $$
  select (
    (select count(*) from public.pedidos p  where p.gerente_id = p_ger and p.ligador_id is null)
  + (select count(*) from public.profiles pr where pr.gerente_id = p_ger and pr.ligador_id is null)
  )::int;
$$;

-- Passa as N fichas mais antigas do estoque pro ligador, já liberadas.
create or replace function public._estoque_para_ligador(p_ger uuid, p_lig uuid, p_qtd int)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int := 0; r record;
begin
  for r in
    select 'p' as t, p.id, p.created_at from public.pedidos p
     where p.gerente_id = p_ger and p.ligador_id is null
    union all
    select 'c' as t, pr.id, pr.created_at from public.profiles pr
     where pr.gerente_id = p_ger and pr.ligador_id is null
    order by created_at asc
    limit greatest(coalesce(p_qtd, 0), 0)
  loop
    if r.t = 'p' then
      update public.pedidos set ligador_id = p_lig, ligador_status = 'a_ligar', ligador_obs = null,
        ligador_at = null, ligador_liberado_at = now() where id = r.id;
    else
      update public.profiles set ligador_id = p_lig, ligador_status = 'a_ligar', ligador_obs = null,
        ligador_at = null, ligador_liberado_at = now() where id = r.id;
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end; $$;

revoke execute on function public._gerente_do_token(uuid)                 from public, anon, authenticated;
revoke execute on function public._estoque_gerente(uuid)                  from public, anon, authenticated;
revoke execute on function public._estoque_para_ligador(uuid, uuid, int)  from public, anon, authenticated;

-- ---- ADMIN -----------------------------------------------------------------
create or replace function public.criar_gerente(p_usuario text, p_senha text, p_nome text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'apenas admin'; end if;
  if coalesce(trim(p_usuario), '') = '' or coalesce(p_senha, '') = '' then raise exception 'usuario e senha obrigatorios'; end if;
  insert into public.gerentes (usuario, senha_hash, nome)
  values (lower(trim(p_usuario)), crypt(p_senha, gen_salt('bf')), nullif(trim(p_nome), ''))
  returning id into v_id;
  return v_id;
end; $$;
grant execute on function public.criar_gerente(text, text, text) to authenticated;

drop function if exists public.listar_gerentes();
create or replace function public.listar_gerentes()
returns table(id uuid, usuario text, nome text, ativo boolean, created_at timestamptz,
              estoque int, qtd_ligadores bigint)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return; end if;
  return query
    select g.id, g.usuario, g.nome, g.ativo, g.created_at, public._estoque_gerente(g.id),
           (select count(*) from public.ligadores l where l.gerente_id = g.id)
    from public.gerentes g order by g.created_at desc;
end; $$;
grant execute on function public.listar_gerentes() to authenticated;

-- Remove o gerente: o estoque dele volta pro admin; ligadores ficam sem gerente.
create or replace function public.remover_gerente(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'apenas admin'; end if;
  update public.pedidos  set gerente_id = null where gerente_id = p_id;
  update public.profiles set gerente_id = null where gerente_id = p_id;
  delete from public.gerentes where id = p_id;
end; $$;
grant execute on function public.remover_gerente(uuid) to authenticated;

create or replace function public.definir_gerente_ligador(p_ligador uuid, p_gerente uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'apenas admin'; end if;
  update public.ligadores set gerente_id = p_gerente where id = p_ligador;
  -- pedido de fichas em aberto acompanha a troca de gerente
  update public.solicitacoes_fichas set gerente_id = p_gerente where ligador_id = p_ligador and status = 'pendente';
end; $$;
grant execute on function public.definir_gerente_ligador(uuid, uuid) to authenticated;

-- listar_ligadores ganha a coluna gerente_id (DROP: muda as colunas de retorno).
drop function if exists public.listar_ligadores();
create or replace function public.listar_ligadores()
returns table(id uuid, usuario text, nome text, ativo boolean, created_at timestamptz,
              total bigint, a_ligar bigint, retorno bigint, bom bigint, ruim bigint, gerente_id uuid)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return; end if;
  return query
    select l.id, l.usuario, l.nome, l.ativo, l.created_at,
      ((select count(*) from public.pedidos p where p.ligador_id = l.id)
        + (select count(*) from public.profiles pr where pr.ligador_id = l.id))::bigint,
      ((select count(*) from public.pedidos p where p.ligador_id = l.id and p.ligador_status = 'a_ligar')
        + (select count(*) from public.profiles pr where pr.ligador_id = l.id and pr.ligador_status = 'a_ligar'))::bigint,
      ((select count(*) from public.pedidos p where p.ligador_id = l.id and p.ligador_status = 'retorno')
        + (select count(*) from public.profiles pr where pr.ligador_id = l.id and pr.ligador_status = 'retorno'))::bigint,
      ((select count(*) from public.pedidos p where p.ligador_id = l.id and p.ligador_status = 'bom')
        + (select count(*) from public.profiles pr where pr.ligador_id = l.id and pr.ligador_status = 'bom'))::bigint,
      ((select count(*) from public.pedidos p where p.ligador_id = l.id and p.ligador_status = 'ruim')
        + (select count(*) from public.profiles pr where pr.ligador_id = l.id and pr.ligador_status = 'ruim'))::bigint,
      l.gerente_id
    from public.ligadores l
    order by l.created_at desc;
end; $$;
grant execute on function public.listar_ligadores() to authenticated;

-- Admin só vê os pedidos de fichas de ligadores SEM gerente.
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
    where s.status = 'pendente' and s.gerente_id is null
    order by s.created_at asc;
end; $$;
grant execute on function public.listar_solicitacoes_fichas() to authenticated;

create or replace function public.listar_solicitacoes_gerente()
returns table(id uuid, gerente_id uuid, gerente_nome text, quantidade int, created_at timestamptz, estoque int)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return; end if;
  return query
    select s.id, s.gerente_id, coalesce(g.nome, g.usuario), s.quantidade, s.created_at, public._estoque_gerente(g.id)
    from public.solicitacoes_gerente s join public.gerentes g on g.id = s.gerente_id
    where s.status = 'pendente'
    order by s.created_at asc;
end; $$;
grant execute on function public.listar_solicitacoes_gerente() to authenticated;

-- p_status: 'atendida' | 'recusada'
create or replace function public.responder_solicitacao_gerente(p_solicitacao uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'apenas admin'; end if;
  if p_status not in ('atendida', 'recusada') then raise exception 'status invalido'; end if;
  update public.solicitacoes_gerente set status = p_status, respondida_at = now()
   where id = p_solicitacao and status = 'pendente';
end; $$;
grant execute on function public.responder_solicitacao_gerente(uuid, text) to authenticated;

-- Chamado pelo admin depois de enviar fichas pro gerente em Pedidos.
create or replace function public.atender_solicitacoes_gerente(p_gerente uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'apenas admin'; end if;
  update public.solicitacoes_gerente set status = 'atendida', respondida_at = now()
   where gerente_id = p_gerente and status = 'pendente';
end; $$;
grant execute on function public.atender_solicitacoes_gerente(uuid) to authenticated;

-- ---- LIGADOR: o pedido de fichas vai pro gerente dele ----------------------
create or replace function public.ligador_solicitar_fichas(p_token uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_lig uuid; v_ger uuid;
begin
  select l.id, l.gerente_id into v_lig, v_ger from public.ligadores l where l.token = p_token and l.ativo = true;
  if v_lig is null then raise exception 'token invalido'; end if;
  if public._fichas_pendentes(v_lig) > 0 then raise exception 'Termine as fichas atuais antes de pedir mais.'; end if;
  if exists(select 1 from public.solicitacoes_fichas s where s.ligador_id = v_lig and s.status = 'pendente') then return; end if;
  insert into public.solicitacoes_fichas (ligador_id, gerente_id) values (v_lig, v_ger);
end; $$;
grant execute on function public.ligador_solicitar_fichas(uuid) to anon, authenticated;

-- ---- GERENTE (por TOKEN) ---------------------------------------------------
create or replace function public.gerente_login(p_usuario text, p_senha text)
returns table(id uuid, nome text, token uuid)
language plpgsql security definer set search_path = public, extensions as $$
begin
  return query
    select g.id, g.nome, g.token from public.gerentes g
    where g.usuario = lower(trim(p_usuario)) and g.ativo = true
      and g.senha_hash = crypt(p_senha, g.senha_hash);
end; $$;
grant execute on function public.gerente_login(text, text) to anon, authenticated;

drop function if exists public.gerente_situacao(uuid);
create or replace function public.gerente_situacao(p_token uuid)
returns table(estoque int, solicitacao_pendente boolean)
language plpgsql security definer set search_path = public as $$
declare v_ger uuid := public._gerente_do_token(p_token);
begin
  if v_ger is null then return; end if;
  return query select public._estoque_gerente(v_ger),
    exists(select 1 from public.solicitacoes_gerente s where s.gerente_id = v_ger and s.status = 'pendente');
end; $$;
grant execute on function public.gerente_situacao(uuid) to anon, authenticated;

create or replace function public.gerente_ligadores(p_token uuid)
returns table(id uuid, usuario text, nome text, ativo boolean,
              a_ligar int, retorno bigint, bom bigint, ruim bigint, na_fila int)
language plpgsql security definer set search_path = public as $$
declare v_ger uuid := public._gerente_do_token(p_token);
begin
  if v_ger is null then return; end if;
  return query
    select l.id, l.usuario, l.nome, l.ativo,
      public._fichas_pendentes(l.id),
      ((select count(*) from public.pedidos p where p.ligador_id = l.id and p.ligador_status = 'retorno')
        + (select count(*) from public.profiles pr where pr.ligador_id = l.id and pr.ligador_status = 'retorno'))::bigint,
      ((select count(*) from public.pedidos p where p.ligador_id = l.id and p.ligador_status = 'bom')
        + (select count(*) from public.profiles pr where pr.ligador_id = l.id and pr.ligador_status = 'bom'))::bigint,
      ((select count(*) from public.pedidos p where p.ligador_id = l.id and p.ligador_status = 'ruim')
        + (select count(*) from public.profiles pr where pr.ligador_id = l.id and pr.ligador_status = 'ruim'))::bigint,
      public._fichas_na_fila(l.id)
    from public.ligadores l
    where l.gerente_id = v_ger
    order by coalesce(l.nome, l.usuario);
end; $$;
grant execute on function public.gerente_ligadores(uuid) to anon, authenticated;

create or replace function public.gerente_solicitacoes(p_token uuid)
returns table(id uuid, ligador_id uuid, ligador_nome text, created_at timestamptz, na_fila int)
language plpgsql security definer set search_path = public as $$
declare v_ger uuid := public._gerente_do_token(p_token);
begin
  if v_ger is null then return; end if;
  return query
    select s.id, s.ligador_id, coalesce(l.nome, l.usuario), s.created_at, public._fichas_na_fila(s.ligador_id)
    from public.solicitacoes_fichas s join public.ligadores l on l.id = s.ligador_id
    where s.status = 'pendente' and s.gerente_id = v_ger and l.gerente_id = v_ger
    order by s.created_at asc;
end; $$;
grant execute on function public.gerente_solicitacoes(uuid) to anon, authenticated;

-- Libera até 10 fichas: primeiro da fila do próprio ligador, depois do estoque do gerente.
create or replace function public.gerente_conceder_fichas(p_token uuid, p_solicitacao uuid, p_qtd int)
returns int language plpgsql security definer set search_path = public as $$
declare v_ger uuid := public._gerente_do_token(p_token); v_lig uuid; v_qtd int; v_n int;
begin
  if v_ger is null then raise exception 'token invalido'; end if;
  select s.ligador_id into v_lig
    from public.solicitacoes_fichas s join public.ligadores l on l.id = s.ligador_id
   where s.id = p_solicitacao and s.status = 'pendente' and s.gerente_id = v_ger and l.gerente_id = v_ger;
  if v_lig is null then raise exception 'Pedido não encontrado.'; end if;
  v_qtd := least(greatest(coalesce(p_qtd, 0), 0), 10 - public._fichas_pendentes(v_lig));
  if v_qtd <= 0 then raise exception 'Esse ligador já está com 10 fichas.'; end if;
  if public._fichas_na_fila(v_lig) + public._estoque_gerente(v_ger) = 0 then
    raise exception 'Você está sem fichas. Peça mais ao admin.';
  end if;
  v_n := public._liberar_fichas(v_lig, v_qtd);
  if v_n < v_qtd then v_n := v_n + public._estoque_para_ligador(v_ger, v_lig, v_qtd - v_n); end if;
  update public.solicitacoes_fichas set status = 'concedida', quantidade = v_n, respondida_at = now() where id = p_solicitacao;
  return v_n;
end; $$;
grant execute on function public.gerente_conceder_fichas(uuid, uuid, int) to anon, authenticated;

create or replace function public.gerente_recusar_solicitacao(p_token uuid, p_solicitacao uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_ger uuid := public._gerente_do_token(p_token);
begin
  if v_ger is null then raise exception 'token invalido'; end if;
  update public.solicitacoes_fichas set status = 'recusada', respondida_at = now()
   where id = p_solicitacao and status = 'pendente' and gerente_id = v_ger;
end; $$;
grant execute on function public.gerente_recusar_solicitacao(uuid, uuid) to anon, authenticated;

-- Gerente pede mais fichas ao admin (um pedido em aberto por vez).
create or replace function public.gerente_solicitar_fichas(p_token uuid, p_qtd int)
returns void language plpgsql security definer set search_path = public as $$
declare v_ger uuid := public._gerente_do_token(p_token);
begin
  if v_ger is null then raise exception 'token invalido'; end if;
  if exists(select 1 from public.solicitacoes_gerente s where s.gerente_id = v_ger and s.status = 'pendente') then return; end if;
  insert into public.solicitacoes_gerente (gerente_id, quantidade)
  values (v_ger, nullif(least(greatest(coalesce(p_qtd, 0), 0), 10000), 0));
end; $$;
grant execute on function public.gerente_solicitar_fichas(uuid, int) to anon, authenticated;
