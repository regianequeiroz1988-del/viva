-- ===========================================================================
--  CHECKOUT COM CRÉDITOS — server-authoritative (fecha "pedido pago forjado")
--  ---------------------------------------------------------------------------
--  ANTES: o cliente INSERIA o pedido com status:'pago' e calculava o desconto de
--  crédito no navegador → dava pra forjar pedido pago de graça / pagar menos.
--  AGORA: uma RPC `security definer` debita o crédito e cria o pedido pago de
--  forma ATÔMICA, e a RLS impede o cliente de inserir/alterar pedido p/ 'pago'.
--
--  ⚠️ ORDEM DE APLICAÇÃO (zero downtime):
--    1) Rode a PARTE 1 (a RPC) agora.
--    2) git push + espere o deploy da Vercel (front passa a chamar a RPC).
--    3) Rode a PARTE 2 (a RLS) depois do deploy.
--  (Assim nenhum pagamento com crédito quebra no meio da troca.)
-- ===========================================================================


-- ========================= PARTE 1 — rode AGORA ============================
-- RPC que paga com créditos: total calculado no servidor, débito + pedido pago
-- atômicos, com trava de linha (sem corrida / duplo gasto).
create or replace function public.pagar_com_creditos(
  p_itens      jsonb,
  p_metodo     text  default 'creditos',
  p_utm        jsonb default '{}'::jsonb,
  p_visitor_id text  default null,
  p_pagador    jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_total  numeric(12,2);
  v_saldo  numeric(12,2);
  v_pedido uuid;
begin
  if v_uid is null then
    raise exception 'nao autenticado';
  end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'itens invalidos';
  end if;

  -- Total no SERVIDOR a partir dos itens (qty * price). O débito é SEMPRE igual
  -- ao valor do pedido — não dá pra "pagar menos" nem criar pedido pago de graça.
  select coalesce(sum( (it->>'qty')::numeric * (it->>'price')::numeric ), 0)
    into v_total
    from jsonb_array_elements(p_itens) as it;

  if v_total is null or v_total <= 0 then
    raise exception 'total invalido';
  end if;

  -- Trava a linha do perfil e confere o saldo.
  select creditos_nao_sacaveis into v_saldo
    from public.profiles where id = v_uid for update;

  if v_saldo is null or v_saldo < v_total then
    raise exception 'saldo insuficiente';
  end if;

  -- Debita o crédito e cria o pedido pago — na MESMA transação.
  update public.profiles
     set creditos_nao_sacaveis = creditos_nao_sacaveis - v_total
   where id = v_uid;

  insert into public.pedidos (user_id, total, status, itens, metodo, utm, visitor_id, pagador)
  values (v_uid, v_total, 'pago', p_itens, coalesce(nullif(p_metodo, ''), 'creditos'),
          coalesce(p_utm, '{}'::jsonb), p_visitor_id, coalesce(p_pagador, '{}'::jsonb))
  returning id into v_pedido;

  return v_pedido;
end;
$$;

grant execute on function public.pagar_com_creditos(jsonb, text, jsonb, text, jsonb) to authenticated;


-- ===================== PARTE 2 — rode DEPOIS do deploy =====================
-- Tira o "for all" antigo e dá ao cliente só o necessário: ler os próprios
-- pedidos, criar pedido PENDENTE (Pix/depósito) e apagar pedido PENDENTE
-- (limpeza do Pix que não gerou). Status 'pago' passa a ser EXCLUSIVO do
-- servidor: webhook das gates (service_role) ou a RPC acima (security definer).
drop policy if exists "pedidos_proprios" on public.pedidos;

create policy "pedidos_select_proprio" on public.pedidos
  for select using (auth.uid() = user_id);

create policy "pedidos_insert_pendente" on public.pedidos
  for insert with check (auth.uid() = user_id and status = 'pendente');

create policy "pedidos_delete_pendente" on public.pedidos
  for delete using (auth.uid() = user_id and status = 'pendente');

-- (Sem policy de UPDATE para o cliente — ele não muda mais status de pedido.
--  Admin continua pela "admin_atualiza_pedidos"; as gates pelo service_role.)
