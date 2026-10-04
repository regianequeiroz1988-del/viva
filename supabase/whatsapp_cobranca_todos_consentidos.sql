-- Marca o campo legado de opt-in do WhatsApp como verdadeiro para todos os pedidos.
-- O lembrete e um fluxo interno do admin e nao depende de aceite no checkout.

begin;

alter table public.pedidos
  add column if not exists whatsapp_optin boolean;

update public.pedidos
set whatsapp_optin = true
where whatsapp_optin is distinct from true;

update public.pedidos
set pagador = jsonb_set(coalesce(pagador, '{}'::jsonb), '{whatsapp_optin}', 'true'::jsonb, true)
where coalesce(pagador ->> 'whatsapp_optin', '') is distinct from 'true';

alter table public.pedidos alter column whatsapp_optin set default true;
alter table public.pedidos alter column whatsapp_optin set not null;

comment on column public.pedidos.whatsapp_optin is
  'Campo legado; todos os pedidos sao considerados consentidos para o lembrete interno.';

commit;
