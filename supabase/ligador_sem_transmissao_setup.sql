-- ===========================================================================
-- LIGADOR SEM TRANSMISSÃO: o gerente libera um ligador dele pra ver e trabalhar
-- as fichas sem transmitir a tela, até desligar de novo.
-- Rode isto UMA vez no Supabase (SQL Editor), depois do gerentes_setup.sql.
-- Pode rodar de novo sem problema.
-- ===========================================================================
alter table public.ligadores add column if not exists sem_transmissao boolean not null default false;

-- Gerente liga/desliga — só pra ligador dele.
create or replace function public.gerente_liberar_sem_transmissao(p_token uuid, p_ligador uuid, p_ativo boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_ger uuid := public._gerente_do_token(p_token);
begin
  if v_ger is null then raise exception 'token invalido'; end if;
  update public.ligadores set sem_transmissao = coalesce(p_ativo, false)
   where id = p_ligador and gerente_id = v_ger;
  if not found then raise exception 'Esse ligador não é seu.'; end if;
end; $$;
grant execute on function public.gerente_liberar_sem_transmissao(uuid, uuid, boolean) to anon, authenticated;

drop function if exists public.gerente_ligadores(uuid);
create or replace function public.gerente_ligadores(p_token uuid)
returns table(id uuid, usuario text, nome text, ativo boolean,
              a_ligar int, retorno bigint, bom bigint, ruim bigint, na_fila int, sem_transmissao boolean)
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
      public._fichas_na_fila(l.id),
      l.sem_transmissao
    from public.ligadores l
    where l.gerente_id = v_ger
    order by coalesce(l.nome, l.usuario);
end; $$;
grant execute on function public.gerente_ligadores(uuid) to anon, authenticated;

-- O painel do ligador lê daqui se está liberado.
drop function if exists public.ligador_situacao_fichas(uuid);
create or replace function public.ligador_situacao_fichas(p_token uuid)
returns table(pendentes int, na_fila int, solicitacao_pendente boolean, sem_transmissao boolean)
language plpgsql security definer set search_path = public as $$
declare v_lig uuid; v_sem boolean;
begin
  select l.id, l.sem_transmissao into v_lig, v_sem from public.ligadores l where l.token = p_token and l.ativo = true;
  if v_lig is null then return; end if;
  return query select public._fichas_pendentes(v_lig), public._fichas_na_fila(v_lig),
    exists(select 1 from public.solicitacoes_fichas s where s.ligador_id = v_lig and s.status = 'pendente'),
    coalesce(v_sem, false);
end; $$;
grant execute on function public.ligador_situacao_fichas(uuid) to anon, authenticated;

-- Trocar o ligador de gerente (ou remover o gerente) desliga a liberação:
-- o gerente novo decide, e ligador sem gerente não fica liberado pra sempre.
create or replace function public.definir_gerente_ligador(p_ligador uuid, p_gerente uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'apenas admin'; end if;
  update public.ligadores set gerente_id = p_gerente,
         sem_transmissao = case when gerente_id is distinct from p_gerente then false else sem_transmissao end
   where id = p_ligador;
  update public.solicitacoes_fichas set gerente_id = p_gerente where ligador_id = p_ligador and status = 'pendente';
end; $$;
grant execute on function public.definir_gerente_ligador(uuid, uuid) to authenticated;

create or replace function public.remover_gerente(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'apenas admin'; end if;
  update public.ligadores set sem_transmissao = false where gerente_id = p_id;
  update public.pedidos  set gerente_id = null where gerente_id = p_id;
  update public.profiles set gerente_id = null where gerente_id = p_id;
  delete from public.gerentes where id = p_id;
end; $$;
grant execute on function public.remover_gerente(uuid) to authenticated;
