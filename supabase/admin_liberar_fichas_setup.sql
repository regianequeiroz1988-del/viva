-- ===========================================================================
-- ENVIO DIRETO DO ADMIN PRO LIGADOR JÁ LIBERA AS FICHAS (até 10 "a ligar" por vez),
-- igual quando o gerente distribui. Antes ficavam presas na fila até alguém
-- conceder em Notificações. Rode isto no Supabase (SQL Editor). Pode rodar de novo.
-- ===========================================================================
create or replace function public.admin_liberar_fichas_ligador(p_ligador uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not public.is_admin() then raise exception 'apenas admin'; end if;
  v_n := public._liberar_fichas(p_ligador, 10 - public._fichas_pendentes(p_ligador));
  if v_n > 0 then
    update public.solicitacoes_fichas set status = 'concedida', quantidade = v_n, respondida_at = now()
     where ligador_id = p_ligador and status = 'pendente';
  end if;
  return v_n;
end; $$;
grant execute on function public.admin_liberar_fichas_ligador(uuid) to authenticated;

-- Destrava agora quem já está com fichas presas na fila e o lote vazio.
select public._liberar_fichas(l.id, 10 - public._fichas_pendentes(l.id))
  from public.ligadores l
 where l.ativo and public._fichas_na_fila(l.id) > 0 and public._fichas_pendentes(l.id) < 10;
update public.solicitacoes_fichas s set status = 'concedida', respondida_at = now()
 where s.status = 'pendente' and public._fichas_pendentes(s.ligador_id) > 0;
