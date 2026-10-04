-- Aba "Acompanhar Resumo" no /admin: visão geral do resultado de TODOS os
-- ligadores (a ligar / retornos / deu bom / deu ruim). listar_ligadores()
-- já existia (usada em /admin/ligadores) mas não contava "retorno" — só
-- soma essa coluna nova. DROP primeiro porque o Postgres não deixa trocar
-- as colunas de retorno (OUT) de uma função com CREATE OR REPLACE.
-- Rode isto uma vez no Supabase (SQL Editor) se seu banco já existia antes.

drop function if exists public.listar_ligadores();
create or replace function public.listar_ligadores()
returns table(id uuid, usuario text, nome text, ativo boolean, created_at timestamptz,
              total bigint, a_ligar bigint, retorno bigint, bom bigint, ruim bigint)
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
        + (select count(*) from public.profiles pr where pr.ligador_id = l.id and pr.ligador_status = 'ruim'))::bigint
    from public.ligadores l
    order by l.created_at desc;
end; $$;
grant execute on function public.listar_ligadores() to authenticated;
