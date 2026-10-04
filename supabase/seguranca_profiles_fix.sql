-- ===========================================================================
--  CORREÇÃO DE SEGURANÇA — public.profiles (escalonamento de privilégio)
--  ---------------------------------------------------------------------------
--  Brecha: a policy "perfil_proprio_update" (schema.sql) deixa o usuário logado
--  editar a PRÓPRIA linha em QUALQUER coluna, direto pela API pública do
--  Supabase (a anon key fica no front). Com isso dava pra:
--    (1) virar admin sozinho   -> update profiles set is_admin = true ...
--    (2) inflar o próprio saldo -> update profiles set saldo_saque = 99999 ...
--  Este script fecha as duas coisas SEM quebrar a edição de perfil (MeusDados)
--  nem o pagamento com créditos (Checkout, que só DIMINUI o saldo).
--  Rode TUDO no SQL Editor do Supabase.
-- ===========================================================================

-- 1) Trava principal por TRIGGER (sobrevive a regrants do Supabase) -----------
create or replace function public.protege_profile_sensiveis()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Sem usuário logado (service_role / SQL editor) ou admin de verdade: libera.
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;
  -- Usuário comum logado NÃO pode se promover a admin:
  if new.is_admin is distinct from old.is_admin then
    raise exception 'permissao negada: alterar is_admin';
  end if;
  -- ...nem trocar o próprio CPF (é a identidade de login; só admin/serviço muda):
  if new.cpf is distinct from old.cpf then
    raise exception 'permissao negada: alterar cpf';
  end if;
  -- ...nem AUMENTAR o próprio saldo/creditos/pontos (gastar/diminuir continua ok):
  if  new.creditos_nao_sacaveis > old.creditos_nao_sacaveis
   or new.saldo_saque           > old.saldo_saque
   or new.total_sacado          > old.total_sacado
   or new.pontos                > old.pontos then
    raise exception 'permissao negada: aumentar saldo/creditos/pontos';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protege_profile on public.profiles;
create trigger trg_protege_profile
  before update on public.profiles
  for each row execute function public.protege_profile_sensiveis();

-- 2) Reforço: tira o privilégio de mexer em is_admin pela API ------------------
revoke update (is_admin) on public.profiles from anon, authenticated;

-- ===========================================================================
--  AUDITORIA E LIMPEZA — rode e confira os resultados (descomente):
-- ===========================================================================

-- a) Quem está admin? (deve aparecer SÓ a SUA conta)
-- select id, nome, email, cpf, is_admin from public.profiles where is_admin = true;

-- b) Contas com saldo/créditos que você NÃO creditou (procure valores estranhos):
-- select id, nome, email, cpf, creditos_nao_sacaveis, saldo_saque, total_sacado, pontos
--   from public.profiles
--  where creditos_nao_sacaveis > 0 or saldo_saque > 0 or total_sacado > 0
--  order by saldo_saque desc, creditos_nao_sacaveis desc;

-- c) Reverter/bloquear a conta invasora (troque o e-mail se for outro):
-- update public.profiles
--    set is_admin = false, creditos_nao_sacaveis = 0, saldo_saque = 0, nome = 'conta bloqueada'
--  where email = 'teste3@gmail.com';
