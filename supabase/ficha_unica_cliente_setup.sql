-- ===========================================================================
-- UMA FICHA POR CLIENTE: todos os pedidos (Pix gerados) do mesmo cliente andam
-- juntos como uma ficha só — mesmo ligador/gerente, mesmo status e observação.
--   • Pix novo de quem já tem ficha entra NA MESMA ficha (não vira ficha nova).
--   • Enviar / devolver / "deu bom" num pedido vale pra todos os pedidos do cliente.
--   • Contagens (a ligar, estoque, resumo) contam CLIENTES, não pedidos.
-- Rode isto no Supabase (SQL Editor), depois do sem_limite_fichas_setup.sql.
-- Pode rodar de novo sem problema.
-- ===========================================================================

-- ---- 1) Pedido novo herda a ficha que o cliente já tem ---------------------
-- Ordem dos BEFORE INSERT (alfabética): gerente_automatico → herda_ficha → liberado_na_hora.
-- Ficha com ligador tem prioridade; depois, ficha no estoque de gerente; por fim,
-- a ficha "só cadastro" do perfil (que migra pro pedido).
create or replace function public._pedido_herda_ficha()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if new.user_id is null or coalesce(new.metodo, '') = 'deposito' then return new; end if;

  select p.ligador_id, p.gerente_id, p.ligador_status, p.ligador_obs, p.ligador_at, p.ligador_liberado_at into r
    from public.pedidos p
   where p.user_id = new.user_id and coalesce(p.metodo, '') <> 'deposito'
     and (p.ligador_id is not null or p.gerente_id is not null)
   order by (p.ligador_id is not null) desc, p.created_at desc
   limit 1;

  if not found then
    select pr.ligador_id, pr.gerente_id, pr.ligador_status, pr.ligador_obs, pr.ligador_at, pr.ligador_liberado_at into r
      from public.profiles pr
     where pr.id = new.user_id and (pr.ligador_id is not null or pr.gerente_id is not null);
    if found then
      update public.profiles set ligador_id = null, gerente_id = null, ligador_status = null,
             ligador_obs = null, ligador_at = null, ligador_liberado_at = null
       where id = new.user_id;
    end if;
  end if;

  if r.ligador_id is not null or r.gerente_id is not null then
    new.ligador_id := r.ligador_id;
    new.gerente_id := r.gerente_id;
    new.ligador_status := case when r.ligador_id is not null then coalesce(r.ligador_status, 'a_ligar') end;
    new.ligador_obs := r.ligador_obs;
    new.ligador_at := r.ligador_at;
    new.ligador_liberado_at := case when r.ligador_id is not null then coalesce(r.ligador_liberado_at, now()) end;
  end if;
  return new;
end; $$;
revoke execute on function public._pedido_herda_ficha() from public, anon, authenticated;

drop trigger if exists trg_pedido_herda_ficha on public.pedidos;
create trigger trg_pedido_herda_ficha
  before insert on public.pedidos
  for each row execute function public._pedido_herda_ficha();

-- ---- 2) Mexeu na ficha de um pedido → vale pros outros pedidos do cliente ---
create or replace function public._pedido_ficha_do_cliente()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return null; end if; -- evita cascata
  if new.user_id is null or coalesce(new.metodo, '') = 'deposito' then return null; end if;
  update public.pedidos p
     set ligador_id = new.ligador_id, gerente_id = new.gerente_id,
         ligador_status = new.ligador_status, ligador_obs = new.ligador_obs,
         ligador_at = new.ligador_at, ligador_liberado_at = new.ligador_liberado_at
   where p.user_id = new.user_id and p.id <> new.id and coalesce(p.metodo, '') <> 'deposito'
     and (p.ligador_id, p.gerente_id, p.ligador_status, p.ligador_obs, p.ligador_liberado_at)
         is distinct from (new.ligador_id, new.gerente_id, new.ligador_status, new.ligador_obs, new.ligador_liberado_at);
  return null;
end; $$;
revoke execute on function public._pedido_ficha_do_cliente() from public, anon, authenticated;

drop trigger if exists trg_pedido_ficha_do_cliente on public.pedidos;
create trigger trg_pedido_ficha_do_cliente
  after insert or update of ligador_id, gerente_id, ligador_status, ligador_obs, ligador_liberado_at on public.pedidos
  for each row execute function public._pedido_ficha_do_cliente();

-- ---- 3) Contagens por CLIENTE ----------------------------------------------
create or replace function public._fichas_pendentes(p_lig uuid)
returns int language sql stable security definer set search_path = public as $$
  select (
    (select count(distinct p.user_id) from public.pedidos p
      where p.ligador_id = p_lig and p.ligador_liberado_at is not null and coalesce(p.ligador_status, 'a_ligar') = 'a_ligar')
  + (select count(*) from public.profiles pr
      where pr.ligador_id = p_lig and pr.ligador_liberado_at is not null and coalesce(pr.ligador_status, 'a_ligar') = 'a_ligar'
        and not exists (select 1 from public.pedidos p where p.user_id = pr.id and p.ligador_id = p_lig))
  )::int;
$$;

create or replace function public._fichas_na_fila(p_lig uuid)
returns int language sql stable security definer set search_path = public as $$
  select (
    (select count(distinct p.user_id) from public.pedidos p  where p.ligador_id = p_lig and p.ligador_liberado_at is null)
  + (select count(*) from public.profiles pr where pr.ligador_id = p_lig and pr.ligador_liberado_at is null
        and not exists (select 1 from public.pedidos p where p.user_id = pr.id and p.ligador_id = p_lig))
  )::int;
$$;

create or replace function public._estoque_gerente(p_ger uuid)
returns int language sql stable security definer set search_path = public as $$
  select (
    (select count(distinct p.user_id) from public.pedidos p where p.gerente_id = p_ger and p.ligador_id is null)
  + (select count(*) from public.profiles pr where pr.gerente_id = p_ger and pr.ligador_id is null
        and not exists (select 1 from public.pedidos p where p.user_id = pr.id and p.gerente_id = p_ger))
  )::int;
$$;

-- Fichas de um ligador num status (null = todas), contando clientes.
create or replace function public._fichas_do_ligador(p_lig uuid, p_status text)
returns bigint language sql stable security definer set search_path = public as $$
  select (
    (select count(distinct p.user_id) from public.pedidos p
      where p.ligador_id = p_lig and (p_status is null or p.ligador_status = p_status))
  + (select count(*) from public.profiles pr
      where pr.ligador_id = p_lig and (p_status is null or pr.ligador_status = p_status)
        and not exists (select 1 from public.pedidos p where p.user_id = pr.id and p.ligador_id = p_lig))
  )::bigint;
$$;

revoke execute on function public._fichas_pendentes(uuid)        from public, anon, authenticated;
revoke execute on function public._fichas_na_fila(uuid)          from public, anon, authenticated;
revoke execute on function public._estoque_gerente(uuid)         from public, anon, authenticated;
revoke execute on function public._fichas_do_ligador(uuid, text) from public, anon, authenticated;

-- Estoque → ligador: N CLIENTES mais antigos (o gatilho leva os outros pedidos junto).
create or replace function public._estoque_para_ligador(p_ger uuid, p_lig uuid, p_qtd int)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int := 0; r record;
begin
  for r in
    select * from (
      select distinct on (p.user_id) 'p'::text as t, p.id, p.created_at
        from public.pedidos p
       where p.gerente_id = p_ger and p.ligador_id is null
       order by p.user_id, p.created_at asc
    ) x
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

-- Estoque do gerente: uma linha por cliente (o pedido pago representa a ficha; senão o mais recente).
drop function if exists public.gerente_estoque(uuid);
create or replace function public.gerente_estoque(p_token uuid)
returns table(tipo text, id uuid, nome text, telefone text, cidade text, uf text, total numeric,
              created_at timestamptz, qtd int, pagos int)
language plpgsql security definer set search_path = public as $$
declare v_ger uuid := public._gerente_do_token(p_token);
begin
  if v_ger is null then return; end if;
  return query
    select * from (
      select distinct on (p.user_id)
             (case when bool_or(p.status = 'pago') over w then 'pago' else 'pendente' end)::text as f_tipo,
             p.id as f_id,
             coalesce(nullif(p.pagador->>'nome', ''), pr.nome) as f_nome,
             coalesce(nullif(p.pagador->>'telefone', ''), pr.telefone) as f_tel,
             coalesce(p.cidade, pr.cidade) as f_cidade, coalesce(p.uf, pr.estado) as f_uf,
             p.total as f_total, p.created_at as f_criado,
             (count(*) over w)::int as f_qtd, (count(*) filter (where p.status = 'pago') over w)::int as f_pagos
        from public.pedidos p left join public.profiles pr on pr.id = p.user_id
       where p.gerente_id = v_ger and p.ligador_id is null
      window w as (partition by p.user_id)
       order by p.user_id, (p.status = 'pago') desc, p.created_at desc
    ) x
    union all
    select 'cadastro'::text, pr.id, pr.nome, pr.telefone, pr.cidade, pr.estado, null::numeric, pr.created_at, 0, 0
      from public.profiles pr
     where pr.gerente_id = v_ger and pr.ligador_id is null
       and not exists (select 1 from public.pedidos p where p.user_id = pr.id and p.gerente_id = v_ger)
    order by 8 asc;
end; $$;
grant execute on function public.gerente_estoque(uuid) to anon, authenticated;

-- Cartões "só cadastro" do ligador: some quem já virou ficha de pedido com ele.
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
      from public.profiles pr
     where pr.ligador_id = v_lig and pr.ligador_liberado_at is not null
       and not exists (select 1 from public.pedidos p where p.user_id = pr.id and p.ligador_id = v_lig)
     order by pr.created_at desc;
end; $$;
grant execute on function public.ligador_cadastros(uuid) to anon, authenticated;

drop function if exists public.gerente_ligadores(uuid);
create or replace function public.gerente_ligadores(p_token uuid)
returns table(id uuid, usuario text, nome text, ativo boolean,
              a_ligar int, retorno bigint, bom bigint, ruim bigint, na_fila int, sem_transmissao boolean)
language plpgsql security definer set search_path = public as $$
declare v_ger uuid := public._gerente_do_token(p_token);
begin
  if v_ger is null then return; end if;
  return query
    select l.id, l.usuario, l.nome, l.ativo,
      public._fichas_pendentes(l.id),
      public._fichas_do_ligador(l.id, 'retorno'),
      public._fichas_do_ligador(l.id, 'bom'),
      public._fichas_do_ligador(l.id, 'ruim'),
      public._fichas_na_fila(l.id),
      l.sem_transmissao
    from public.ligadores l
    where l.gerente_id = v_ger
    order by coalesce(l.nome, l.usuario);
end; $$;
grant execute on function public.gerente_ligadores(uuid) to anon, authenticated;

drop function if exists public.listar_ligadores();
create or replace function public.listar_ligadores()
returns table(id uuid, usuario text, nome text, ativo boolean, created_at timestamptz,
              total bigint, a_ligar bigint, retorno bigint, bom bigint, ruim bigint, gerente_id uuid)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return; end if;
  return query
    select l.id, l.usuario, l.nome, l.ativo, l.created_at,
      public._fichas_do_ligador(l.id, null),
      public._fichas_do_ligador(l.id, 'a_ligar'),
      public._fichas_do_ligador(l.id, 'retorno'),
      public._fichas_do_ligador(l.id, 'bom'),
      public._fichas_do_ligador(l.id, 'ruim'),
      l.gerente_id
    from public.ligadores l
    order by l.created_at desc;
end; $$;
grant execute on function public.listar_ligadores() to authenticated;

-- Liberar N fichas = N clientes (os outros pedidos do cliente vão junto).
create or replace function public._liberar_fichas(p_lig uuid, p_qtd int)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int := 0; v_k int; r record;
begin
  for r in
    select 'p' as t, p.user_id as id, min(p.created_at) as created_at from public.pedidos p
     where p.ligador_id = p_lig and p.ligador_liberado_at is null
     group by p.user_id
    union all
    select 'c' as t, pr.id, pr.created_at from public.profiles pr
     where pr.ligador_id = p_lig and pr.ligador_liberado_at is null
    order by created_at asc
  loop
    exit when v_n >= greatest(coalesce(p_qtd, 0), 0);
    if r.t = 'p' then
      update public.pedidos set ligador_liberado_at = now()
       where user_id = r.id and ligador_id = p_lig and ligador_liberado_at is null;
    else
      update public.profiles set ligador_liberado_at = now() where id = r.id and ligador_liberado_at is null;
    end if;
    get diagnostics v_k = row_count;
    if v_k > 0 then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end; $$;
revoke execute on function public._liberar_fichas(uuid, int) from public, anon, authenticated;

-- Gerente envia clientes pro ligador: conta clientes, sem teto, e libera na hora.
create or replace function public.gerente_enviar_fichas(p_token uuid, p_ligador uuid, p_pedidos uuid[], p_cadastros uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare v_ger uuid := public._gerente_do_token(p_token); v_users uuid[]; v_np int; v_nc int;
begin
  if v_ger is null then raise exception 'token invalido'; end if;
  if not exists (select 1 from public.ligadores l where l.id = p_ligador and l.gerente_id = v_ger and l.ativo = true) then
    raise exception 'Esse ligador não é seu.';
  end if;
  select array_agg(distinct p.user_id) into v_users
    from public.pedidos p
   where p.id = any(coalesce(p_pedidos, '{}')) and p.gerente_id = v_ger and p.ligador_id is null;
  v_np := coalesce(array_length(v_users, 1), 0);
  update public.pedidos set ligador_id = p_ligador, ligador_status = 'a_ligar', ligador_obs = null,
         ligador_at = null, ligador_liberado_at = null
   where user_id = any(coalesce(v_users, '{}')) and gerente_id = v_ger and ligador_id is null
     and coalesce(metodo, '') <> 'deposito';
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

-- ---- 4) Arruma as fichas que já existem ------------------------------------
-- 4a) Cliente com pedidos em donos diferentes: todos vão pra ficha "principal"
--     (a que está com ligador; senão a mais recente com gerente).
with dono as (
  select distinct on (p.user_id) p.user_id, p.ligador_id, p.gerente_id, p.ligador_status,
         p.ligador_obs, p.ligador_at, p.ligador_liberado_at
    from public.pedidos p
   where p.user_id is not null and coalesce(p.metodo, '') <> 'deposito'
     and (p.ligador_id is not null or p.gerente_id is not null)
   order by p.user_id, (p.ligador_id is not null) desc, p.created_at desc
)
update public.pedidos p
   set ligador_id = d.ligador_id, gerente_id = d.gerente_id, ligador_status = d.ligador_status,
       ligador_obs = d.ligador_obs, ligador_at = d.ligador_at, ligador_liberado_at = d.ligador_liberado_at
  from dono d
 where p.user_id = d.user_id and coalesce(p.metodo, '') <> 'deposito'
   and (p.ligador_id, p.gerente_id, p.ligador_status, p.ligador_obs, p.ligador_liberado_at)
       is distinct from (d.ligador_id, d.gerente_id, d.ligador_status, d.ligador_obs, d.ligador_liberado_at);

-- 4b) Ficha "só cadastro" de quem já gerou pedido: migra pros pedidos (se eles
--     ainda não têm ligador) e sai do perfil — senão o ligador vê a pessoa 2x.
update public.pedidos p
   set ligador_id = pr.ligador_id, gerente_id = pr.gerente_id, ligador_status = pr.ligador_status,
       ligador_obs = pr.ligador_obs, ligador_at = pr.ligador_at, ligador_liberado_at = pr.ligador_liberado_at
  from public.profiles pr
 where pr.id = p.user_id and coalesce(p.metodo, '') <> 'deposito'
   and (pr.ligador_id is not null or pr.gerente_id is not null)
   and not exists (select 1 from public.pedidos q
                    where q.user_id = p.user_id and coalesce(q.metodo, '') <> 'deposito' and q.ligador_id is not null)
   and (pr.ligador_id is not null
        or not exists (select 1 from public.pedidos q
                        where q.user_id = p.user_id and coalesce(q.metodo, '') <> 'deposito' and q.gerente_id is not null));

update public.profiles pr
   set ligador_id = null, gerente_id = null, ligador_status = null, ligador_obs = null,
       ligador_at = null, ligador_liberado_at = null
 where (pr.ligador_id is not null or pr.gerente_id is not null)
   and exists (select 1 from public.pedidos p where p.user_id = pr.id and coalesce(p.metodo, '') <> 'deposito');

-- Confere: fichas por ligador (agora contando clientes).
select coalesce(l.nome, l.usuario) as ligador,
       public._fichas_do_ligador(l.id, null)      as fichas,
       public._fichas_do_ligador(l.id, 'a_ligar') as a_ligar,
       public._fichas_do_ligador(l.id, 'retorno') as retornos
  from public.ligadores l
 where l.ativo
 order by fichas desc;
