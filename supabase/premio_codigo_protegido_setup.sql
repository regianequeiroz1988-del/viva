-- ===========================================================================
-- CÓDIGO DO RESGATE PROTEGIDO: o ganhador só recebe o código depois de declarar
-- (ou com a chave de declaração desligada). O ligador continua vendo o código pelo
-- token dele. Remove a consulta pública antiga (consultar_premio), que entregava
-- o código pra qualquer pessoa com o CPF.
-- Rode no Supabase (SQL Editor) depois do premio_declaracao_setup.sql.
-- Pode rodar de novo sem problema.
-- ===========================================================================
drop function if exists public.consultar_premio(text);

-- Código do resgate nunca sai do banco sem a regra de declaração cumprida:
--   ganhador (anônimo, pelo CPF): recebe o código só depois de regularizado,
--   ou com a chave premio_exigir_declaracao desligada.
--   ligador (pelo token, só CPF da própria carteira): sempre recebe o código.
-- A antiga consultar_premio (pública, por CPF) foi removida de propósito.
create or replace function public.ganhador_consultar_premio(p_cpf text)
returns table(codigo text, estado text, valor numeric)
language plpgsql security definer set search_path = public as $$
declare v_cpf text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g'); v_exige boolean; v_decl text;
begin
  if length(v_cpf) <> 11 then return; end if;
  if not exists (select 1 from public.premios_liberados pl where pl.cpf = v_cpf) then return; end if;
  v_exige := coalesce((select c.valor from public.configuracoes c where c.chave = 'premio_exigir_declaracao'), 'true') <> 'false';
  select d.estado into v_decl from public.premio_declaracao d where d.cpf = v_cpf;
  return query
    select case when v_exige and coalesce(v_decl, '') <> 'regularizado' then null::text else pl.codigo end,
           pl.estado, pl.valor
      from public.premios_liberados pl
     where pl.cpf = v_cpf;
end; $$;
grant execute on function public.ganhador_consultar_premio(text) to anon, authenticated;

create or replace function public.ligador_consultar_premio(p_token uuid, p_cpf text)
returns table(codigo text, estado text, valor numeric)
language plpgsql security definer set search_path = public as $$
declare v_lig uuid; v_cpf text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
begin
  select l.id into v_lig from public.ligadores l where l.token = p_token and l.ativo = true;
  if v_lig is null or length(v_cpf) <> 11 then return; end if;
  if not exists (
    select 1 from public.profiles pr
     where regexp_replace(coalesce(pr.cpf, ''), '\D', '', 'g') = v_cpf
       and (pr.ligador_id = v_lig or exists (select 1 from public.pedidos p where p.user_id = pr.id and p.ligador_id = v_lig))
  ) and not exists (
    select 1 from public.pedidos p
     where p.ligador_id = v_lig and regexp_replace(coalesce(p.pagador->>'cpf', ''), '\D', '', 'g') = v_cpf
  ) then return; end if;
  return query
    select pl.codigo, pl.estado, pl.valor from public.premios_liberados pl where pl.cpf = v_cpf;
end; $$;
grant execute on function public.ligador_consultar_premio(uuid, text) to anon, authenticated;
