-- ===========================================================================
-- AJUSTE DA FICHA ÚNICA (rode depois do ficha_unica_cliente_setup.sql):
--  • Admin → Ligadores volta a mostrar/trocar o gerente de cada ligador
--    (listar_ligadores tinha perdido a coluna gerente_id).
--  • Liberar N fichas e o envio do gerente contam CLIENTES, não pedidos.
-- Pode rodar de novo sem problema.
-- ===========================================================================
drop function if exists public.listar_ligadores();
create or replace function public.listar_ligadores()
returns table(id uuid, usuario text, nome text, ativo boolean, created_at timestamptz,
              total bigint, a_ligar bigint, retorno bigint, bom bigint, ruim bigint, gerente_id uuid)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return; end if;
  return query
    select l.id, l.usuario, l.nome, l.ativo, l.created_at,
      public._fichas_do_ligador(l.id, null),
      public._fichas_do_ligador(l.id, 'a_ligar'),
      public._fichas_do_ligador(l.id, 'retorno'),
      public._fichas_do_ligador(l.id, 'bom'),
      public._fichas_do_ligador(l.id, 'ruim'),
      l.gerente_id
    from public.ligadores l
    order by l.created_at desc;
end; $$;
grant execute on function public.listar_ligadores() to authenticated;

-- Liberar N fichas = N clientes (os outros pedidos do cliente vão junto).
create or replace function public._liberar_fichas(p_lig uuid, p_qtd int)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int := 0; v_k int; r record;
begin
  for r in
    select 'p' as t, p.user_id as id, min(p.created_at) as created_at from public.pedidos p
     where p.ligador_id = p_lig and p.ligador_liberado_at is null
     group by p.user_id
    union all
    select 'c' as t, pr.id, pr.created_at from public.profiles pr
     where pr.ligador_id = p_lig and pr.ligador_liberado_at is null
    order by created_at asc
  loop
    exit when v_n >= greatest(coalesce(p_qtd, 0), 0);
    if r.t = 'p' then
      update public.pedidos set ligador_liberado_at = now()
       where user_id = r.id and ligador_id = p_lig and ligador_liberado_at is null;
    else
      update public.profiles set ligador_liberado_at = now() where id = r.id and ligador_liberado_at is null;
    end if;
    get diagnostics v_k = row_count;
    if v_k > 0 then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end; $$;
revoke execute on function public._liberar_fichas(uuid, int) from public, anon, authenticated;

-- Gerente envia clientes pro ligador: conta clientes, sem teto, e libera na hora.
create or replace function public.gerente_enviar_fichas(p_token uuid, p_ligador uuid, p_pedidos uuid[], p_cadastros uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare v_ger uuid := public._gerente_do_token(p_token); v_users uuid[]; v_np int; v_nc int;
begin
  if v_ger is null then raise exception 'token invalido'; end if;
  if not exists (select 1 from public.ligadores l where l.id = p_ligador and l.gerente_id = v_ger and l.ativo = true) then
    raise exception 'Esse ligador não é seu.';
  end if;
  select array_agg(distinct p.user_id) into v_users
    from public.pedidos p
   where p.id = any(coalesce(p_pedidos, '{}')) and p.gerente_id = v_ger and p.ligador_id is null;
  v_np := coalesce(array_length(v_users, 1), 0);
  update public.pedidos set ligador_id = p_ligador, ligador_status = 'a_ligar', ligador_obs = null,
         ligador_at = null, ligador_liberado_at = null
   where user_id = any(coalesce(v_users, '{}')) and gerente_id = v_ger and ligador_id is null
     and coalesce(metodo, '') <> 'deposito';
  update public.profiles set ligador_id = p_ligador, ligador_status = 'a_ligar', ligador_obs = null,
         ligador_at = null, ligador_liberado_at = null
   where id = any(coalesce(p_cadastros, '{}')) and gerente_id = v_ger and ligador_id is null;
  get diagnostics v_nc = row_count;
  perform public._liberar_fichas(p_ligador, public._fichas_na_fila(p_ligador));
  if v_np + v_nc > 0 then
    update public.solicitacoes_fichas set status = 'concedida', quantidade = v_np + v_nc, respondida_at = now()
     where ligador_id = p_ligador and status = 'pendente' and gerente_id = v_ger;
  end if;
  return v_np + v_nc;
end; $$;
grant execute on function public.gerente_enviar_fichas(uuid, uuid, uuid[], uuid[]) to anon, authenticated;
