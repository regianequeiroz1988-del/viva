-- "Enviar pro ligador" também pras abas "Somente Cadastros" (clientes sem
-- nenhum pedido). Ganha as MESMAS colunas de atribuição que já existem em
-- pedidos, só que em profiles, + duas RPCs novas pro painel do ligador ver e
-- responder esses cadastros (não são pedidos, então não cabem em
-- ligador_pedidos/ligador_responder, que são tipadas pra tabela pedidos).
-- Rode isto uma vez no Supabase (SQL Editor) se seu banco já existia antes.
-- Requer que supabase/cadastro_exportado_setup.sql já tenha sido rodado.

alter table public.profiles add column if not exists ligador_id     uuid references public.ligadores(id) on delete set null;
alter table public.profiles add column if not exists ligador_status text;   -- a_ligar | bom | ruim
alter table public.profiles add column if not exists ligador_obs    text;
alter table public.profiles add column if not exists ligador_at     timestamptz;
create index if not exists profiles_ligador_idx on public.profiles (ligador_id);

-- ---- LIGADOR: ver/responder os CADASTROS atribuídos a ele (por TOKEN) ------
create or replace function public.ligador_cadastros(p_token uuid)
returns table(id uuid, nome text, cpf text, telefone text,
              ligador_status text, ligador_obs text, ligador_at timestamptz, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare v_lig uuid;
begin
  select id into v_lig from public.ligadores where token = p_token and ativo = true;
  if v_lig is null then return; end if;
  return query
    select pr.id, pr.nome, pr.cpf, pr.telefone, pr.ligador_status, pr.ligador_obs, pr.ligador_at, pr.created_at
    from public.profiles pr where pr.ligador_id = v_lig order by pr.created_at desc;
end; $$;
grant execute on function public.ligador_cadastros(uuid) to anon, authenticated;

create or replace function public.ligador_responder_cadastro(p_token uuid, p_perfil uuid, p_status text, p_obs text)
returns void language plpgsql security definer set search_path = public as $$
declare v_lig uuid;
begin
  select id into v_lig from public.ligadores where token = p_token and ativo = true;
  if v_lig is null then raise exception 'token invalido'; end if;
  if p_status not in ('a_ligar', 'bom', 'ruim', 'retorno') then raise exception 'status invalido'; end if;
  update public.profiles set ligador_status = p_status, ligador_obs = p_obs, ligador_at = now()
   where id = p_perfil and ligador_id = v_lig;
end; $$;
grant execute on function public.ligador_responder_cadastro(uuid, uuid, text, text) to anon, authenticated;

-- listar_ligadores: soma também os cadastros atribuídos (via subqueries — um
-- JOIN direto duplicaria linhas quando o ligador tem pedidos E cadastros).
create or replace function public.listar_ligadores()
returns table(id uuid, usuario text, nome text, ativo boolean, created_at timestamptz,
              total bigint, a_ligar bigint, bom bigint, ruim bigint)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return; end if;
  return query
    select l.id, l.usuario, l.nome, l.ativo, l.created_at,
      ((select count(*) from public.pedidos p where p.ligador_id = l.id)
        + (select count(*) from public.profiles pr where pr.ligador_id = l.id))::bigint,
      ((select count(*) from public.pedidos p where p.ligador_id = l.id and p.ligador_status = 'a_ligar')
        + (select count(*) from public.profiles pr where pr.ligador_id = l.id and pr.ligador_status = 'a_ligar'))::bigint,
      ((select count(*) from public.pedidos p where p.ligador_id = l.id and p.ligador_status = 'bom')
        + (select count(*) from public.profiles pr where pr.ligador_id = l.id and pr.ligador_status = 'bom'))::bigint,
      ((select count(*) from public.pedidos p where p.ligador_id = l.id and p.ligador_status = 'ruim')
        + (select count(*) from public.profiles pr where pr.ligador_id = l.id and pr.ligador_status = 'ruim'))::bigint
    from public.ligadores l
    order by l.created_at desc;
end; $$;

-- remover_ligador: solta também os cadastros atribuídos a ele.
create or replace function public.remover_ligador(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'apenas admin'; end if;
  update public.pedidos set ligador_id = null, ligador_status = null, ligador_obs = null, ligador_at = null
   where ligador_id = p_id;
  update public.profiles set ligador_id = null, ligador_status = null, ligador_obs = null, ligador_at = null
   where ligador_id = p_id;
  delete from public.ligadores where id = p_id;
end; $$;
