-- Corrige bug real: a função ligador_cadastros() tinha uma coluna "id"
-- ambígua — ela é ao mesmo tempo uma coluna de SAÍDA da função (RETURNS
-- TABLE(id uuid, ...)) e uma coluna da tabela `ligadores` (`select id into
-- v_lig from public.ligadores ...`). O Postgres não sabia a qual das duas
-- "id" se referia e recusava rodar (erro 42702, "column reference is
-- ambiguous") — por isso os cadastros enviados ao ligador não apareciam no
-- painel dele. Corrigido qualificando a tabela com um alias (l.id).
-- Rode isto uma vez no Supabase (SQL Editor).

create or replace function public.ligador_cadastros(p_token uuid)
returns table(id uuid, nome text, cpf text, telefone text,
              ligador_status text, ligador_obs text, ligador_at timestamptz, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare v_lig uuid;
begin
  select l.id into v_lig from public.ligadores l where l.token = p_token and l.ativo = true;
  if v_lig is null then return; end if;
  return query
    select pr.id, pr.nome, pr.cpf, pr.telefone, pr.ligador_status, pr.ligador_obs, pr.ligador_at, pr.created_at
    from public.profiles pr where pr.ligador_id = v_lig order by pr.created_at desc;
end; $$;
grant execute on function public.ligador_cadastros(uuid) to anon, authenticated;
