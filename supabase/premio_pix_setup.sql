-- ===========================================================================
-- CHAVE PIX DO GANHADOR. Gravada pelo servidor (/api/ganhador?acao=pix, service role)
-- só quando o prêmio do CPF está liberado. O admin/ligador lê pra fazer o pagamento.
-- Rode isto no Supabase (SQL Editor). Pode rodar de novo sem problema.
-- ===========================================================================
create table if not exists public.premio_pix (
  cpf           text primary key,
  tipo          text not null,           -- cpf | cnpj | email | telefone | aleatoria
  chave         text not null,
  nome          text,
  telefone      text,
  whatsapp_ok   boolean not null default false,
  whatsapp_erro text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.premio_pix enable row level security;
drop policy if exists premio_pix_admin on public.premio_pix;
create policy premio_pix_admin on public.premio_pix for select using (public.is_admin());

-- Ligador vê a chave Pix dos ganhadores da carteira dele.
create or replace function public.ligador_premio_pix(p_token uuid, p_cpf text)
returns table(tipo text, chave text, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare v_lig uuid; v_cpf text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
begin
  select l.id into v_lig from public.ligadores l where l.token = p_token and l.ativo = true;
  if v_lig is null or not public._ligador_tem_premio(v_lig, v_cpf) then return; end if;
  return query select x.tipo, x.chave, x.created_at from public.premio_pix x where x.cpf = v_cpf;
end; $$;
grant execute on function public.ligador_premio_pix(uuid, text) to anon, authenticated;
