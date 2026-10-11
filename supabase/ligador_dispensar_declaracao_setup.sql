-- ===========================================================================
-- LIGADOR DISPENSA A DECLARAÇÃO DE VALORES DE UM GANHADOR DA PRÓPRIA CARTEIRA.
-- Libera só aquele CPF (fica "regularizado"): o código de resgate sai sem declarar.
-- Não mexe na chave geral (premio_exigir_declaracao) nem em CPF de fora da carteira.
-- Rode isto no Supabase (SQL Editor). Pode rodar de novo sem problema.
-- ===========================================================================
create or replace function public.ligador_dispensar_declaracao(p_token uuid, p_cpf text)
returns void language plpgsql security definer set search_path = public as $$
declare v_lig uuid; v_cpf text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
begin
  select l.id into v_lig from public.ligadores l where l.token = p_token and l.ativo = true;
  if v_lig is null then raise exception 'token invalido'; end if;
  if length(v_cpf) <> 11 or not public._ligador_tem_premio(v_lig, v_cpf) then
    raise exception 'Esse CPF não está na sua carteira.';
  end if;
  if exists (select 1 from public.premio_declaracao d where d.cpf = v_cpf and d.estado = 'recusou') then
    raise exception 'Este ganhador recusou o prêmio.';
  end if;
  insert into public.premio_declaracao (cpf, estado, regularizado_em, atualizado_em)
    values (v_cpf, 'regularizado', now(), now())
  on conflict (cpf) do update set estado = 'regularizado', regularizado_em = now(), atualizado_em = now();
end; $$;
grant execute on function public.ligador_dispensar_declaracao(uuid, text) to anon, authenticated;
