-- ===========================================================================
--  BravoPay — chaves de config (rode no SQL Editor do Supabase).
--  Terminam em '_key' de propósito: a RLS (config_leitura_publica) oculta dos
--  visitantes; só admin/serviço leem. Configure a chave depois no /admin.
--  ⚠️ BravoPay é gateway de ALTO RISCO (.club, saque USDT) — teste saque antes.
-- ===========================================================================
insert into public.configuracoes (chave, valor) values
  ('bravopay_api_key', ''),
  ('bravopay_webhook_key', '')
on conflict (chave) do nothing;

-- (opcional) MedusaPay foi removida do código — pode apagar as configs dela:
-- delete from public.configuracoes where chave in ('medusapay_secret_key', 'medusapay_public_key');
