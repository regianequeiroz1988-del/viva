-- ===========================================================================
-- SHARPIFY: nova gate de Pix. A PayForge sai do sistema.
-- Rode isto no Supabase (SQL Editor). Pode rodar de novo sem problema.
-- Depois de rodar: /admin → Gateway de pagamento → escolha a Sharpify, cole o
-- Client ID e o Client Secret, salve e clique em "Testar conexão".
-- ===========================================================================
insert into public.configuracoes (chave, valor) values
  ('sharpify_client_id_key', ''),
  ('sharpify_client_secret_key', ''),
  ('sharpify_webhook_key', '')
on conflict (chave) do nothing;

-- Pedidos ainda pendentes na PayForge: se o cliente pagar depois, o site não recebe a confirmação.
-- Confira a lista antes de rodar o restante (ou rode uns 30 min depois do último Pix da PayForge).
select id, total, created_at from public.pedidos where gateway = 'payforge' and status = 'pendente' order by created_at;

-- Se a PayForge estava como gate ativa, volta pra Umbrella (troque no /admin quando quiser).
update public.configuracoes set valor = 'umbrella' where chave = 'gateway_ativo' and valor = 'payforge';

-- Tira a PayForge do rodízio.
update public.configuracoes
   set valor = array_to_string(array(
         select x from unnest(string_to_array(valor, ',')) as x where x <> '' and x <> 'payforge'
       ), ',')
 where chave = 'gateway_rodizio';

-- Apaga as chaves da PayForge.
delete from public.configuracoes
 where chave in ('payforge_public_key', 'payforge_secret_key', 'payforge_webhook_key', 'payforge_valor_minimo_centavos');
