-- Botão "Reset" na ficha do ligador: apaga o registro do resgate daquele CPF
-- por completo (código, estado, valor) — a pessoa que digitar o CPF de novo
-- no /ganhador vê exatamente como era no início (bloqueado, sem código).
-- Rode isto uma vez no Supabase (SQL Editor).

create or replace function public.ligador_resetar_premio(p_token uuid, p_cpf text)
returns void language plpgsql security definer set search_path = public as $$
declare v_lig uuid; v_cpf text;
begin
  select id into v_lig from public.ligadores where token = p_token and ativo = true;
  if v_lig is null then raise exception 'token invalido'; end if;
  v_cpf := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
  if length(v_cpf) <> 11 then raise exception 'cpf invalido'; end if;
  delete from public.premios_liberados where cpf = v_cpf;
end; $$;
grant execute on function public.ligador_resetar_premio(uuid, text) to anon, authenticated;
