-- Tabela INTERNA de enriquecimento (consulta OwnData no cadastro).
-- Guarda nascimento/idade/profissão/score/renda do cliente. SÓ o admin lê (RLS);
-- o cliente NUNCA acessa. O backend grava via service role (ignora RLS).
-- Rode isto uma vez no Supabase (SQL Editor).

create table if not exists public.dados_consulta (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  cpf         text,
  nome        text,
  nascimento  text,
  idade       int,
  profissao   text,
  score       text,
  renda       text,
  raw         jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Para tabelas já criadas antes: adiciona a coluna nome (idempotente).
alter table public.dados_consulta add column if not exists nome text;

-- Provedor "Supremo" (substitui a OwnData): menos campos + telefones + checagem
-- de telefone (se o que a pessoa cadastrou bate com algum dos puxados).
alter table public.dados_consulta add column if not exists sexo text;
alter table public.dados_consulta add column if not exists telefones jsonb;
alter table public.dados_consulta add column if not exists telefone_confere boolean;

alter table public.dados_consulta enable row level security;

-- Leitura SOMENTE para admin (reusa a função public.is_admin() do schema).
-- Sem policy de insert/update: só o service role (backend) escreve.
drop policy if exists "dados_consulta_admin_select" on public.dados_consulta;
create policy "dados_consulta_admin_select" on public.dados_consulta
  for select using (public.is_admin());
