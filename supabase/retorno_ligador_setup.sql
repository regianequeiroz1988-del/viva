-- Botão "Retornar" no painel do ligador ganha um status PRÓPRIO ('retorno'),
-- separado de "A ligar" — aparece numa aba nova ("Retornos") em vez de voltar
-- pra fila normal. Só precisa liberar o novo valor nas funções de resposta
-- (o resto — colunas, RLS — já existe desde cadastro_ligador_setup.sql).
-- Rode isto uma vez no Supabase (SQL Editor) se seu banco já existia antes.
-- Requer que supabase/cadastro_ligador_setup.sql já tenha sido rodado.

create or replace function public.ligador_responder(p_token uuid, p_pedido uuid, p_status text, p_obs text)
returns void language plpgsql security definer set search_path = public as $$
declare v_lig uuid;
begin
  select id into v_lig from public.ligadores where token = p_token and ativo = true;
  if v_lig is null then raise exception 'token invalido'; end if;
  if p_status not in ('a_ligar', 'bom', 'ruim', 'retorno') then raise exception 'status invalido'; end if;
  update public.pedidos set ligador_status = p_status, ligador_obs = p_obs, ligador_at = now()
   where id = p_pedido and ligador_id = v_lig;
end; $$;

create or replace function public.ligador_responder_cadastro(p_token uuid, p_perfil uuid, p_status text, p_obs text)
returns void language plpgsql security definer set search_path = public as $$
declare v_lig uuid;
begin
  select id into v_lig from public.ligadores where token = p_token and ativo = true;
  if v_lig is null then raise exception 'token invalido'; end if;
  if p_status not in ('a_ligar', 'bom', 'ruim', 'retorno') then raise exception 'status invalido'; end if;
  update public.profiles set ligador_status = p_status, ligador_obs = p_obs, ligador_at = now()
   where id = p_perfil and ligador_id = v_lig;
end; $$;
