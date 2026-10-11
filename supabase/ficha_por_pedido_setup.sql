-- ===========================================================================
-- CADA PIX É UMA FICHA. Some a junção por cliente.
--  * Pix novo NÃO herda a ficha de pedidos antigos: vira ficha nova (aparece de novo
--    pro ligador, mesmo se a anterior já tinha "deu bom"/"deu ruim").
--  * "Deu bom / ruim / retorno" vale só pro pedido em que foi marcado.
--  * Contagens, envios e liberação são por PEDIDO.
--  * ordem_cliente = nº da ficha da pessoa (1ª, 2ª, 3ª...), pra avisar que é repetida.
--  * Cadastro "só cadastro" continua separado; some quando a pessoa já tem pedido
--    com esse ligador (não aparece duas vezes).
-- Rode isto no Supabase (SQL Editor). Pode rodar de novo sem problema.
-- ===========================================================================

-- 1) Tira a junção: gatilhos que copiavam a ficha entre pedidos e do perfil pro pedido.
drop trigger if exists trg_pedido_herda_ficha on public.pedidos;
drop trigger if exists trg_pedido_ficha_do_cliente on public.pedidos;
drop trigger if exists trg_pedido_mesma_ficha on public.pedidos;
drop function if exists public._pedido_herda_ficha();
drop function if exists public._pedido_ficha_do_cliente();
drop function if exists public._pedido_mesma_ficha();

-- 2) Número da ficha da pessoa (só Pix; depósito não é ficha).
alter table public.pedidos add column if not exists ordem_cliente int;

create or replace function public._pedido_ordem_cliente()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.ordem_cliente is null and new.user_id is not null and coalesce(new.metodo, '') <> 'deposito' then
    select count(*) + 1 into new.ordem_cliente
      from public.pedidos p
     where p.user_id = new.user_id and coalesce(p.metodo, '') <> 'deposito';
  end if;
  return new;
end; $$;

drop trigger if exists trg_pedido_ordem_cliente on public.pedidos;
create trigger trg_pedido_ordem_cliente
  before insert on public.pedidos
  for each row execute function public._pedido_ordem_cliente();

update public.pedidos p
   set ordem_cliente = x.n
  from (
    select id, row_number() over (partition by user_id order by created_at, id) as n
      from public.pedidos
     where coalesce(metodo, '') <> 'deposito'
  ) x
 where p.id = x.id and p.ordem_cliente is distinct from x.n;

-- 3) Contagens por pedido (cadastro só conta se a pessoa não tem pedido com o mesmo ligador/gerente).
create or replace function public._fichas_pendentes(p_lig uuid)
returns int language sql stable security definer set search_path = public as $$
  select (
    (select count(*) from public.pedidos p
      where p.ligador_id = p_lig and p.ligador_liberado_at is not null and coalesce(p.ligador_status, 'a_ligar') = 'a_ligar')
  + (select count(*) from public.profiles pr
      where pr.ligador_id = p_lig and pr.ligador_liberado_at is not null and coalesce(pr.ligador_status, 'a_ligar') = 'a_ligar'
        and not exists (select 1 from public.pedidos p where p.user_id = pr.id and p.ligador_id = p_lig))
  )::int;
$$;

create or replace function public._fichas_na_fila(p_lig uuid)
returns int language sql stable security definer set search_path = public as $$
  select (
    (select count(*) from public.pedidos p where p.ligador_id = p_lig and p.ligador_liberado_at is null)
  + (select count(*) from public.profiles pr where pr.ligador_id = p_lig and pr.ligador_liberado_at is null
        and not exists (select 1 from public.pedidos p where p.user_id = pr.id and p.ligador_id = p_lig))
  )::int;
$$;

create or replace function public._estoque_gerente(p_ger uuid)
returns int language sql stable security definer set search_path = public as $$
  select (
    (select count(*) from public.pedidos p where p.gerente_id = p_ger and p.ligador_id is null)
  + (select count(*) from public.profiles pr where pr.gerente_id = p_ger and pr.ligador_id is null
        and not exists (select 1 from public.pedidos p where p.user_id = pr.id and p.gerente_id = p_ger))
  )::int;
$$;

create or replace function public._fichas_do_ligador(p_lig uuid, p_status text)
returns bigint language sql stable security definer set search_path = public as $$
  select (
    (select count(*) from public.pedidos p
      where p.ligador_id = p_lig and (p_status is null or p.ligador_status = p_status))
  + (select count(*) from public.profiles pr
      where pr.ligador_id = p_lig and (p_status is null or pr.ligador_status = p_status)
        and not exists (select 1 from public.pedidos p where p.user_id = pr.id and p.ligador_id = p_lig))
  )::bigint;
$$;

-- 4) Liberar N fichas da fila do ligador (um pedido = uma ficha; cadastro também).
create or replace function public._liberar_fichas(p_lig uuid, p_qtd int)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int := 0; r record;
begin
  for r in
    select 'p'::text as t, p.id, p.created_at from public.pedidos p
     where p.ligador_id = p_lig and p.ligador_liberado_at is null
    union all
    select 'c'::text, pr.id, pr.created_at from public.profiles pr
     where pr.ligador_id = p_lig and pr.ligador_liberado_at is null
    order by 3 asc
  loop
    exit when v_n >= greatest(coalesce(p_qtd, 0), 0);
    if r.t = 'p' then
      update public.pedidos set ligador_liberado_at = now() where id = r.id;
    else
      update public.profiles set ligador_liberado_at = now() where id = r.id;
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end; $$;
revoke execute on function public._liberar_fichas(uuid, int) from public, anon, authenticated;

-- 5) Estoque do gerente → ligador: N fichas (pedidos) mais antigas, mais cadastros.
create or replace function public._estoque_para_ligador(p_ger uuid, p_lig uuid, p_qtd int)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int := 0; r record;
begin
  for r in
    select 'p'::text as t, p.id, p.created_at from public.pedidos p
     where p.gerente_id = p_ger and p.ligador_id is null
    union all
    select 'c'::text, pr.id, pr.created_at from public.profiles pr
     where pr.gerente_id = p_ger and pr.ligador_id is null
    order by 3 asc
    limit greatest(coalesce(p_qtd, 0), 0)
  loop
    if r.t = 'p' then
      update public.pedidos set ligador_id = p_lig, ligador_status = 'a_ligar', ligador_obs = null,
        ligador_at = null, ligador_liberado_at = now() where id = r.id;
    else
      update public.profiles set ligador_id = p_lig, ligador_status = 'a_ligar', ligador_obs = null,
        ligador_at = null, ligador_liberado_at = now() where id = r.id;
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end; $$;
revoke execute on function public._estoque_para_ligador(uuid, uuid, int) from public, anon, authenticated;

-- 6) Estoque do gerente: uma linha por FICHA (pedido), com o número da ficha da pessoa.
drop function if exists public.gerente_estoque(uuid);
create or replace function public.gerente_estoque(p_token uuid)
returns table(tipo text, id uuid, nome text, telefone text, cidade text, uf text, total numeric,
              created_at timestamptz, ordem int)
language plpgsql security definer set search_path = public as $$
declare v_ger uuid := public._gerente_do_token(p_token);
begin
  if v_ger is null then return; end if;
  return query
    select (case when p.status = 'pago' then 'pago' else 'pendente' end)::text, p.id,
           coalesce(nullif(p.pagador->>'nome', ''), pr.nome), coalesce(nullif(p.pagador->>'telefone', ''), pr.telefone),
           coalesce(p.cidade, pr.cidade), coalesce(p.uf, pr.estado), p.total, p.created_at, p.ordem_cliente
      from public.pedidos p left join public.profiles pr on pr.id = p.user_id
     where p.gerente_id = v_ger and p.ligador_id is null
    union all
    select 'cadastro'::text, pr.id, pr.nome, pr.telefone, pr.cidade, pr.estado, null::numeric, pr.created_at, 0
      from public.profiles pr
     where pr.gerente_id = v_ger and pr.ligador_id is null
       and not exists (select 1 from public.pedidos p where p.user_id = pr.id and p.gerente_id = v_ger)
    order by 8 asc;
end; $$;
grant execute on function public.gerente_estoque(uuid) to anon, authenticated;

-- 7) Gerente envia FICHAS escolhidas (só os pedidos marcados, não o cliente inteiro).
create or replace function public.gerente_enviar_fichas(p_token uuid, p_ligador uuid, p_pedidos uuid[], p_cadastros uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare v_ger uuid := public._gerente_do_token(p_token); v_np int; v_nc int;
begin
  if v_ger is null then raise exception 'token invalido'; end if;
  if not exists (select 1 from public.ligadores l where l.id = p_ligador and l.gerente_id = v_ger and l.ativo = true) then
    raise exception 'Esse ligador não é seu.';
  end if;
  update public.pedidos set ligador_id = p_ligador, ligador_status = 'a_ligar', ligador_obs = null,
         ligador_at = null, ligador_liberado_at = null
   where id = any(coalesce(p_pedidos, '{}')) and gerente_id = v_ger and ligador_id is null
     and coalesce(metodo, '') <> 'deposito';
  get diagnostics v_np = row_count;
  update public.profiles set ligador_id = p_ligador, ligador_status = 'a_ligar', ligador_obs = null,
         ligador_at = null, ligador_liberado_at = null
   where id = any(coalesce(p_cadastros, '{}')) and gerente_id = v_ger and ligador_id is null;
  get diagnostics v_nc = row_count;
  perform public._liberar_fichas(p_ligador, public._fichas_na_fila(p_ligador));
  if v_np + v_nc > 0 then
    update public.solicitacoes_fichas set status = 'concedida', quantidade = v_np + v_nc, respondida_at = now()
     where ligador_id = p_ligador and status = 'pendente' and gerente_id = v_ger;
  end if;
  return v_np + v_nc;
end; $$;
grant execute on function public.gerente_enviar_fichas(uuid, uuid, uuid[], uuid[]) to anon, authenticated;
