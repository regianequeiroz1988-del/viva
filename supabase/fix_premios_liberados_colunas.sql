-- Corrige o erro "column 'estado' of relation 'premios_liberados' does not
-- exist": sua tabela foi criada com uma versão mais antiga do script (só com
-- cpf/codigo/liberado/ligador_id) — "CREATE TABLE IF NOT EXISTS" não adiciona
-- coluna em tabela que já existe, só ALTER TABLE faz isso.
-- Rode isto uma vez no Supabase (SQL Editor).

alter table public.premios_liberados add column if not exists estado text not null default 'bloqueado'; -- bloqueado | liberado | pagamento_parcial
alter table public.premios_liberados add column if not exists valor  numeric;
