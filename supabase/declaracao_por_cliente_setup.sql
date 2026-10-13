-- ===========================================================================
-- DECLARAÇÃO DE VALORES SÓ PRA QUEM O LIGADOR PEDIR.
--  * Todo ganhador vem LIBERADO (recebe o código sem declarar).
--  * O ligador clica "Pedir declaração deste ganhador" → só aquele CPF passa a ter que declarar.
--  * A chave geral (premio_exigir_declaracao) continua existindo: ligada, vale pra todos.
-- Rode isto no Supabase (SQL Editor). Pode rodar de novo sem problema.
-- ===========================================================================
alter table public.premio_declaracao add column if not exists exigida boolean not null default false;

-- Quem já tinha começado/terminado a declaração continua no fluxo dela.
update public.premio_declaracao set exigida = true
 where not exigida and estado in ('enviada', 'pendente', 'recusou');

-- Desliga a chave geral (todo mundo liberado por padrão).
insert into public.configuracoes (chave, valor) values ('premio_exigir_declaracao', 'false')
on conflict (chave) do update set valor = 'false';

-- Esse CPF precisa declarar? (chave geral ligada OU ligador pediu, e ainda não regularizado)
create or replace function public._precisa_declarar(p_cpf text)
returns boolean language sql stable security definer set search_path = public as $$
  select (
    coalesce((select c.valor from public.configuracoes c where c.chave = 'premio_exigir_declaracao'), 'false') = 'true'
    or exists (select 1 from public.premio_declaracao d where d.cpf = p_cpf and d.exigida)
  ) and not exists (select 1 from public.premio_declaracao d where d.cpf = p_cpf and d.estado = 'regularizado');
$$;

create or replace function public.ganhador_precisa_declarar(p_cpf text)
returns boolean language sql stable security definer set search_path = public as $$
  select public._precisa_declarar(regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g'));
$$;
grant execute on function public.ganhador_precisa_declarar(text) to anon, authenticated;

-- O código de resgate só fica escondido de quem precisa declarar.
create or replace function public.ganhador_consultar_premio(p_cpf text)
returns table(codigo text, estado text, valor numeric)
language plpgsql security definer set search_path = public as $$
declare v_cpf text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g'); v_trava boolean;
begin
  if length(v_cpf) <> 11 then return; end if;
  if not exists (select 1 from public.premios_liberados pl where pl.cpf = v_cpf) then return; end if;
  v_trava := public._precisa_declarar(v_cpf);
  return query
    select case when v_trava then null::text else pl.codigo end, pl.estado, pl.valor
      from public.premios_liberados pl
     where pl.cpf = v_cpf;
end; $$;
grant execute on function public.ganhador_consultar_premio(text) to anon, authenticated;

-- Ligador: a declaração deste CPF é exigida?
create or replace function public.ligador_declaracao_exigida(p_token uuid, p_cpf text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_lig uuid; v_cpf text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
begin
  select l.id into v_lig from public.ligadores l where l.token = p_token and l.ativo = true;
  if v_lig is null or not public._ligador_tem_premio(v_lig, v_cpf) then return false; end if;
  return coalesce((select c.valor from public.configuracoes c where c.chave = 'premio_exigir_declaracao'), 'false') = 'true'
      or exists (select 1 from public.premio_declaracao d where d.cpf = v_cpf and d.exigida);
end; $$;
grant execute on function public.ligador_declaracao_exigida(uuid, text) to anon, authenticated;

-- Ligador pede a declaração de um ganhador da carteira dele.
create or replace function public.ligador_exigir_declaracao(p_token uuid, p_cpf text)
returns void language plpgsql security definer set search_path = public as $$
declare v_lig uuid; v_cpf text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
begin
  select l.id into v_lig from public.ligadores l where l.token = p_token and l.ativo = true;
  if v_lig is null then raise exception 'token invalido'; end if;
  if length(v_cpf) <> 11 or not public._ligador_tem_premio(v_lig, v_cpf) then
    raise exception 'Esse CPF não está na sua carteira.';
  end if;
  insert into public.premio_declaracao (cpf, estado, exigida, atualizado_em)
    values (v_cpf, 'aguardando', true, now())
  on conflict (cpf) do update set exigida = true,
    estado = case when public.premio_declaracao.estado = 'regularizado' then 'aguardando' else public.premio_declaracao.estado end,
    atualizado_em = now();
end; $$;
grant execute on function public.ligador_exigir_declaracao(uuid, text) to anon, authenticated;
