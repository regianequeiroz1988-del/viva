-- Valor do "prêmio instantâneo" mostrado no /ganhador (ao digitar o CPF) —
-- agora editável pelo LIGADOR (não só pelo admin). Padrão R$ 50.000,00, como
-- sempre foi. A config já é PÚBLICA por natureza (não termina em _key/_token —
-- o /ganhador é acessado por visitantes anônimos), só a ESCRITA precisa de uma
-- RPC própria porque a policy de update de `configuracoes` exige is_admin(),
-- e o ligador não autentica pelo Supabase Auth (token próprio).
-- Rode isto uma vez no Supabase (SQL Editor) se seu banco já existia antes.

insert into public.configuracoes (chave, valor) values ('premio_ganhador_valor', '50000')
on conflict (chave) do nothing;

create or replace function public.ligador_definir_premio(p_token uuid, p_valor numeric)
returns void language plpgsql security definer set search_path = public as $$
declare v_lig uuid;
begin
  select id into v_lig from public.ligadores where token = p_token and ativo = true;
  if v_lig is null then raise exception 'token invalido'; end if;
  if p_valor is null or p_valor < 0 then raise exception 'valor invalido'; end if;
  insert into public.configuracoes (chave, valor) values ('premio_ganhador_valor', p_valor::text)
  on conflict (chave) do update set valor = excluded.valor, updated_at = now();
end; $$;
grant execute on function public.ligador_definir_premio(uuid, numeric) to anon, authenticated;
