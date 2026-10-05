-- ===========================================================================
-- GERENTE ESCOLHE pra qual ligador vai cada ficha do estoque dele.
-- As fichas enviadas entram na fila do ligador; ele já vê até completar 10
-- "a ligar" e o resto sai conforme ele for pedindo mais.
-- Rode isto UMA vez no Supabase (SQL Editor), depois do gerentes_setup.sql.
-- Pode rodar de novo sem problema.
-- ===========================================================================

-- Estoque do gerente com os dados de cada ficha (pra ele escolher).
create or replace function public.gerente_estoque(p_token uuid)
returns table(tipo text, id uuid, nome text, telefone text, cidade text, uf text, total numeric, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare v_ger uuid := public._gerente_do_token(p_token);
begin
  if v_ger is null then return; end if;
  return query
    select (case when p.status = 'pago' then 'pago' else 'pendente' end)::text, p.id,
           coalesce(nullif(p.pagador->>'nome', ''), pr.nome), coalesce(nullif(p.pagador->>'telefone', ''), pr.telefone),
           coalesce(p.cidade, pr.cidade), coalesce(p.uf, pr.estado), p.total, p.created_at
      from public.pedidos p left join public.profiles pr on pr.id = p.user_id
     where p.gerente_id = v_ger and p.ligador_id is null
    union all
    select 'cadastro'::text, pr.id, pr.nome, pr.telefone, pr.cidade, pr.estado, null::numeric, pr.created_at
      from public.profiles pr
     where pr.gerente_id = v_ger and pr.ligador_id is null
    order by 8 asc;
end; $$;
grant execute on function public.gerente_estoque(uuid) to anon, authenticated;

-- Envia as fichas escolhidas pro ligador (só ligador do próprio gerente, só ficha
-- do próprio estoque). Devolve quantas foram enviadas.
create or replace function public.gerente_enviar_fichas(p_token uuid, p_ligador uuid, p_pedidos uuid[], p_cadastros uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare v_ger uuid := public._gerente_do_token(p_token); v_np int; v_nc int;
begin
  if v_ger is null then raise exception 'token invalido'; end if;
  if not exists (select 1 from public.ligadores l where l.id = p_ligador and l.gerente_id = v_ger and l.ativo = true) then
    raise exception 'Esse ligador não é seu.';
  end if;
  update public.pedidos set ligador_id = p_ligador, ligador_status = 'a_ligar', ligador_obs = null,
         ligador_at = null, ligador_liberado_at = null
   where id = any(coalesce(p_pedidos, '{}')) and gerente_id = v_ger and ligador_id is null;
  get diagnostics v_np = row_count;
  update public.profiles set ligador_id = p_ligador, ligador_status = 'a_ligar', ligador_obs = null,
         ligador_at = null, ligador_liberado_at = null
   where id = any(coalesce(p_cadastros, '{}')) and gerente_id = v_ger and ligador_id is null;
  get diagnostics v_nc = row_count;
  perform public._liberar_fichas(p_ligador, 10 - public._fichas_pendentes(p_ligador));
  -- já recebeu fichas: o pedido dele em aberto está atendido
  if v_np + v_nc > 0 then
    update public.solicitacoes_fichas set status = 'concedida', quantidade = v_np + v_nc, respondida_at = now()
     where ligador_id = p_ligador and status = 'pendente' and gerente_id = v_ger;
  end if;
  return v_np + v_nc;
end; $$;
grant execute on function public.gerente_enviar_fichas(uuid, uuid, uuid[], uuid[]) to anon, authenticated;
