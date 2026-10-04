-- ===========================================================================
--  ORIGEM DO CADASTRO (UTM) — de qual link/campanha o cliente veio.
--  Rode no SQL Editor do Supabase. Seguro rodar a qualquer momento.
-- ===========================================================================

-- 1) Coluna na ficha do cliente. "PROPRIO-..." = veio do NOSSO anúncio.
alter table public.profiles add column if not exists origem text;

-- 2) O trigger de criação de perfil passa a gravar a origem (vem no metadata
--    do signUp: getUtms().utm_campaign). NULL quando o cliente entra direto.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, cpf, email, nome, telefone, origem)
  values (
    new.id,
    new.raw_user_meta_data->>'cpf',
    new.email,
    new.raw_user_meta_data->>'nome',
    new.raw_user_meta_data->>'telefone',
    new.raw_user_meta_data->>'origem'
  );
  return new;
end;
$$;
