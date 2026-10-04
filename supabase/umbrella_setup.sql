-- UmbrellaPag — chaves de config (já incluído no setup_completo.sql).
insert into public.configuracoes (chave, valor) values
  ('umbrella_api_key', ''),
  ('umbrella_webhook_key', '')
on conflict (chave) do nothing;

delete from public.configuracoes where chave in ('bravopay_api_key', 'bravopay_webhook_key');
