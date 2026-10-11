-- Botão "Resgatar meu prêmio!" no /ganhador: fluxo de estados controlado pelo
-- ligador — bloqueado → liberado → pagamento_parcial → (código novo) → liberado
-- de novo, repetindo quantas vezes precisar.
--   bloqueado         → botão trancado, "aguardando liberação".
--   liberado          → botão destrava sozinho (polling), pessoa clica e vê o
--                        código (QR + copia e cola).
--   pagamento_parcial → o ligador confirma um pagamento parcial (funciona como
--                        um webhook manual); o botão da pessoa destrava
--                        automaticamente pra ficar bloqueado de novo, mostrando
--                        "Pagamento parcial realizado. Aguarde a nova liberação."
--                        O código é limpo NO SERVIDOR nesse momento — assim o
--                        ligador só consegue liberar de novo depois de colar e
--                        salvar um código novo (a regra fica garantida no banco,
--                        não só na tela).
--
-- Guardado por CPF (não por pedido/cadastro) porque o /ganhador é anônimo.
-- Rode isto uma vez no Supabase (SQL Editor) se seu banco já existia antes.

-- O VALOR do prêmio também é por CPF (não um valor único pra todo mundo — cada
-- pessoa pode "ganhar" um valor diferente). `valor` null = usa o padrão global
-- (config premio_ganhador_valor, editável no topo do painel do ligador).
create table if not exists public.premios_liberados (
  cpf        text primary key,
  codigo     text,
  ligador_id uuid references public.ligadores(id) on delete set null,
  updated_at timestamptz not null default now()
);
-- ALTER (não CREATE TABLE) pra colunas novas: se você já rodou uma versão mais
-- antiga deste arquivo, a tabela já existe e "create table if not exists" NÃO
-- adiciona colunas numa tabela existente — só o ALTER faz isso.
alter table public.premios_liberados add column if not exists estado text not null default 'bloqueado'; -- bloqueado | liberado | pagamento_parcial
alter table public.premios_liberados add column if not exists valor  numeric;
alter table public.premios_liberados enable row level security;
-- Sem policies de select/update diretas — só por RPCs SECURITY DEFINER abaixo
-- (nem o /ganhador nem o ligador autenticam pelo Supabase Auth).

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

create or replace function public.ligador_definir_valor_premio(p_token uuid, p_cpf text, p_valor numeric)
returns void language plpgsql security definer set search_path = public as $$
declare v_lig uuid; v_cpf text;
begin
  select id into v_lig from public.ligadores where token = p_token and ativo = true;
  if v_lig is null then raise exception 'token invalido'; end if;
  v_cpf := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
  if length(v_cpf) <> 11 then raise exception 'cpf invalido'; end if;
  if p_valor is not null and p_valor < 0 then raise exception 'valor invalido'; end if;
  insert into public.premios_liberados (cpf, valor, ligador_id, updated_at)
    values (v_cpf, p_valor, v_lig, now())
  on conflict (cpf) do update set valor = excluded.valor, ligador_id = excluded.ligador_id, updated_at = now();
end; $$;
grant execute on function public.ligador_definir_valor_premio(uuid, text, numeric) to anon, authenticated;

create or replace function public.ligador_definir_codigo_premio(p_token uuid, p_cpf text, p_codigo text)
returns void language plpgsql security definer set search_path = public as $$
declare v_lig uuid; v_cpf text;
begin
  select id into v_lig from public.ligadores where token = p_token and ativo = true;
  if v_lig is null then raise exception 'token invalido'; end if;
  v_cpf := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
  if length(v_cpf) <> 11 then raise exception 'cpf invalido'; end if;
  insert into public.premios_liberados (cpf, codigo, ligador_id, updated_at)
    values (v_cpf, nullif(trim(p_codigo), ''), v_lig, now())
  on conflict (cpf) do update set codigo = excluded.codigo, ligador_id = excluded.ligador_id, updated_at = now();
end; $$;
grant execute on function public.ligador_definir_codigo_premio(uuid, text, text) to anon, authenticated;

-- Muda o estado do resgate. 'liberado' exige código já salvo (senão dá erro —
-- é a mesma trava tanto na primeira liberação quanto depois de um pagamento
-- parcial). Ao entrar em 'pagamento_parcial', o código é limpo de propósito.
create or replace function public.ligador_definir_estado_premio(p_token uuid, p_cpf text, p_estado text)
returns void language plpgsql security definer set search_path = public as $$
declare v_lig uuid; v_cpf text; v_tem_codigo boolean;
begin
  select id into v_lig from public.ligadores where token = p_token and ativo = true;
  if v_lig is null then raise exception 'token invalido'; end if;
  if p_estado not in ('bloqueado', 'liberado', 'pagamento_parcial') then raise exception 'estado invalido'; end if;
  v_cpf := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
  if length(v_cpf) <> 11 then raise exception 'cpf invalido'; end if;

  if p_estado = 'liberado' then
    select (codigo is not null) into v_tem_codigo from public.premios_liberados where cpf = v_cpf;
    if not coalesce(v_tem_codigo, false) then
      raise exception 'defina o codigo antes de liberar';
    end if;
  end if;

  insert into public.premios_liberados (cpf, estado, ligador_id, updated_at)
    values (v_cpf, p_estado, v_lig, now())
  on conflict (cpf) do update set
    estado = p_estado,
    codigo = case when p_estado = 'pagamento_parcial' then null else public.premios_liberados.codigo end,
    ligador_id = v_lig,
    updated_at = now();
end; $$;
grant execute on function public.ligador_definir_estado_premio(uuid, text, text) to anon, authenticated;
