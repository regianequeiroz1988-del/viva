-- Coluna que registra QUEM confirmou o pagamento: 'webhook' (o gateway avisou)
-- ou 'polling' (a pagina do comprador perguntou). Sem ela, uma consulta simples
-- nao detecta webhook quebrado ate um cliente reclamar que pagou e nao recebeu.
--
-- Rode isto em TODO Supabase novo do projeto — nao e opcional. Ja aconteceu uma
-- vez desta coluna faltar (criada so por SQL avulso, nunca versionada) e o
-- UPDATE de confirmacao de pagamento falhar silenciosamente: 3 vendas pagas na
-- CinqPay ficaram presas em "pendente" no banco ate alguem notar.

alter table public.pedidos add column if not exists confirmado_por text;

comment on column public.pedidos.confirmado_por is
  'Quem confirmou o pagamento: webhook (o gateway avisou) ou polling (a pagina do comprador perguntou). Serve para detectar webhook quebrado antes de perder venda.';
