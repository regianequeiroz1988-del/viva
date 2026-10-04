-- ===========================================================================
--  SÓ DEIXA CADASTRAR COM CPF VÁLIDO — validação no SERVIDOR (à prova de API)
--  ---------------------------------------------------------------------------
--  O site já valida CPF no formulário, mas dá pra burlar chamando a API de
--  cadastro do Supabase direto. Esta validação entra no trigger handle_new_user,
--  que roda SEMPRE no signup — então CPF inválido é recusado mesmo via API.
--  Rode TUDO no SQL Editor do Supabase.
-- ===========================================================================

-- 1) Função que valida o CPF (dígitos verificadores) — mesma regra do front ----
create or replace function public.cpf_e_valido(p_cpf text)
returns boolean
language plpgsql
immutable
as $$
declare
  c text;
  soma int;
  d1 int;
  d2 int;
  i int;
begin
  c := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
  if length(c) <> 11 then return false; end if;
  if c ~ '^(.)\1{10}$' then return false; end if;   -- 000..., 111..., etc.
  soma := 0;
  for i in 0..8 loop
    soma := soma + (substr(c, i + 1, 1))::int * (10 - i);
  end loop;
  d1 := (soma * 10) % 11;
  if d1 = 10 then d1 := 0; end if;
  if d1 <> (substr(c, 10, 1))::int then return false; end if;
  soma := 0;
  for i in 0..9 loop
    soma := soma + (substr(c, i + 1, 1))::int * (11 - i);
  end loop;
  d2 := (soma * 10) % 11;
  if d2 = 10 then d2 := 0; end if;
  return d2 = (substr(c, 11, 1))::int;
end;
$$;

-- 2) Trigger de criação de perfil agora RECUSA cadastro com CPF inválido --------
--    (mantém a gravação da origem/UTM que já existia)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.cpf_e_valido(new.raw_user_meta_data->>'cpf') then
    raise exception 'CPF invalido';
  end if;
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

-- (o trigger on_auth_user_created já existe e continua apontando pra esta função)

-- ===========================================================================
--  AUDITORIA — ache outras contas falsas (CPF inválido) que já entraram:
-- ===========================================================================
-- select id, nome, email, cpf, is_admin, created_at
--   from public.profiles
--  where not public.cpf_e_valido(cpf)
--  order by created_at desc;
