-- Preenchimento automático de telefone via Serasa — pra clientes que só
-- informaram o CPF e nunca confirmaram o WhatsApp. Roda num timer no servidor
-- (ver lib/telefoneAuto.js), a cada poucos minutos, só em quem: não tem
-- telefone, se cadastrou há mais de 10 minutos, e não tem NADA marcado (sem
-- ligador atribuído). `telefone_auto_verificado` evita tentar de novo pra
-- sempre no mesmo cliente (e gastar Serasa à toa) depois da 1ª tentativa,
-- ache ou não o telefone.
-- Rode isto uma vez no Supabase (SQL Editor) se seu banco já existia antes.

alter table public.profiles add column if not exists telefone_auto_verificado boolean not null default false;
create index if not exists profiles_telefone_auto_idx on public.profiles (telefone_auto_verificado) where telefone is null;
