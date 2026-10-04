-- "Somente Cadastros" — aba nova em /admin/pedidos para clientes que se
-- cadastraram mas NUNCA geraram nenhum pedido. Precisa de um jeito de marcar
-- "já exportei este cadastro" (igual ao que já existe pra pedidos), então
-- ganha as MESMAS colunas de controle, só que na tabela profiles.
-- Rode isto uma vez no Supabase (SQL Editor) se seu banco já existia antes.

alter table public.profiles add column if not exists exportado_cadastro     boolean not null default false;
alter table public.profiles add column if not exists exportado_cadastro_at  timestamptz;
create index if not exists profiles_exportado_cadastro_idx on public.profiles (exportado_cadastro);

-- Admin precisa poder ATUALIZAR profiles pelo navegador (marcar/reverter exportado).
-- Soma-se à policy já existente (cada um edita o próprio perfil).
drop policy if exists "admin_atualiza_perfis" on public.profiles;
create policy "admin_atualiza_perfis" on public.profiles for update
  using (public.is_admin()) with check (public.is_admin());
