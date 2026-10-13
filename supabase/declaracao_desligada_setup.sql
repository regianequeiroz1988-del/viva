-- ===========================================================================
-- DECLARAÇÃO DE VALORES DESLIGADA POR PADRÃO.
-- Desliga agora. Pra ligar de novo: /admin → Configurações → exigir declaração.
-- Rode isto no Supabase (SQL Editor). Pode rodar de novo sem problema.
-- ===========================================================================
insert into public.configuracoes (chave, valor) values ('premio_exigir_declaracao', 'false')
on conflict (chave) do update set valor = 'false';
