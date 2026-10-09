-- ===========================================================================
-- SEM LIMITE DE 10 FICHAS: toda ficha atribuída a um ligador já fica visível pra
-- ele na hora (envio do admin, do gerente ou concessão de pedido de fichas).
-- Rode isto no Supabase (SQL Editor). Pode rodar de novo sem problema.
-- ===========================================================================

-- Atribuiu a um ligador → libera na hora. Vale pra qualquer caminho de envio.
create or replace function public._ficha_liberada_na_hora()
returns trigger language plpgsql as $$
begin
  new.ligador_liberado_at := now();
  return new;
end; $$;

drop trigger if exists trg_pedido_liberado_na_hora on public.pedidos;
create trigger trg_pedido_liberado_na_hora
  before insert or update on public.pedidos
  for each row when (new.ligador_id is not null and new.ligador_liberado_at is null)
  execute function public._ficha_liberada_na_hora();

drop trigger if exists trg_cadastro_liberado_na_hora on public.profiles;
create trigger trg_cadastro_liberado_na_hora
  before insert or update on public.profiles
  for each row when (new.ligador_id is not null and new.ligador_liberado_at is null)
  execute function public._ficha_liberada_na_hora();

-- Admin concede pedido de fichas: sem teto.
create or replace function public.conceder_fichas(p_solicitacao uuid, p_qtd int)
returns int language plpgsql security definer set search_path = public as $$
declare v_lig uuid; v_n int;
begin
  if not public.is_admin() then raise exception 'apenas admin'; end if;
  select s.ligador_id into v_lig from public.solicitacoes_fichas s where s.id = p_solicitacao and s.status = 'pendente';
  if v_lig is null then raise exception 'solicitacao nao encontrada'; end if;
  v_n := public._liberar_fichas(v_lig, greatest(coalesce(p_qtd, 0), 0));
  update public.solicitacoes_fichas set status = 'concedida', quantidade = v_n, respondida_at = now() where id = p_solicitacao;
  return v_n;
end; $$;
grant execute on function public.conceder_fichas(uuid, int) to authenticated;

-- Gerente concede pedido de fichas: sem teto (fila do ligador, depois estoque do gerente).
create or replace function public.gerente_conceder_fichas(p_token uuid, p_solicitacao uuid, p_qtd int)
returns int language plpgsql security definer set search_path = public as $$
declare v_ger uuid := public._gerente_do_token(p_token); v_lig uuid; v_qtd int; v_n int;
begin
  if v_ger is null then raise exception 'token invalido'; end if;
  select s.ligador_id into v_lig
    from public.solicitacoes_fichas s join public.ligadores l on l.id = s.ligador_id
   where s.id = p_solicitacao and s.status = 'pendente' and s.gerente_id = v_ger and l.gerente_id = v_ger;
  if v_lig is null then raise exception 'Pedido não encontrado.'; end if;
  v_qtd := greatest(coalesce(p_qtd, 0), 0);
  if v_qtd <= 0 then raise exception 'Informe quantas fichas.'; end if;
  if public._fichas_na_fila(v_lig) + public._estoque_gerente(v_ger) = 0 then
    raise exception 'Você está sem fichas. Peça mais ao admin.';
  end if;
  v_n := public._liberar_fichas(v_lig, v_qtd);
  if v_n < v_qtd then v_n := v_n + public._estoque_para_ligador(v_ger, v_lig, v_qtd - v_n); end if;
  update public.solicitacoes_fichas set status = 'concedida', quantidade = v_n, respondida_at = now() where id = p_solicitacao;
  return v_n;
end; $$;
grant execute on function public.gerente_conceder_fichas(uuid, uuid, int) to anon, authenticated;

-- Envio direto do admin: libera tudo que estiver na fila.
create or replace function public.admin_liberar_fichas_ligador(p_ligador uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not public.is_admin() then raise exception 'apenas admin'; end if;
  v_n := public._liberar_fichas(p_ligador, public._fichas_na_fila(p_ligador));
  update public.solicitacoes_fichas set status = 'concedida', quantidade = v_n, respondida_at = now()
   where ligador_id = p_ligador and status = 'pendente' and v_n > 0;
  return v_n;
end; $$;
grant execute on function public.admin_liberar_fichas_ligador(uuid) to authenticated;

-- Libera agora tudo que está esperando na fila de qualquer ligador.
update public.pedidos  set ligador_liberado_at = now() where ligador_id is not null and ligador_liberado_at is null;
update public.profiles set ligador_liberado_at = now() where ligador_id is not null and ligador_liberado_at is null;
update public.solicitacoes_fichas s set status = 'concedida', respondida_at = now()
 where s.status = 'pendente' and public._fichas_pendentes(s.ligador_id) > 0;

-- Confere: ninguém deve ter fichas esperando na fila.
select coalesce(l.nome, l.usuario) as ligador,
       public._fichas_pendentes(l.id) as liberadas_a_ligar,
       public._fichas_na_fila(l.id)   as esperando_na_fila
  from public.ligadores l
 where l.ativo
 order by liberadas_a_ligar desc;
