-- ===========================================================================
-- NÚMERO DA FICHA DO CLIENTE (ordem_cliente) CONTA SÓ COMPRAS PAGAS ANTERIORES.
--  * Gerou e não pagou → 1ª ficha.  Gerou de novo e pagou → continua 1ª ficha.
--  * Só vira 2ª, 3ª... depois que a pessoa JÁ TEM um Pix pago antes deste.
--  * Recalcula sozinho quando entra pedido novo ou quando um pedido muda de status.
-- Rode isto no Supabase (SQL Editor). Pode rodar de novo sem problema.
-- ===========================================================================
alter table public.pedidos add column if not exists ordem_cliente int;

create or replace function public._recalc_ordem_cliente(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user is null then return; end if;
  perform pg_advisory_xact_lock(hashtext(p_user::text));
  update public.pedidos p
     set ordem_cliente = x.n
    from (
      select q.id,
             1 + coalesce(count(*) filter (where q.status = 'pago') over (
                   order by q.created_at, q.id rows between unbounded preceding and 1 preceding), 0) as n
        from public.pedidos q
       where q.user_id = p_user and coalesce(q.metodo, '') <> 'deposito'
    ) x
   where p.id = x.id and p.ordem_cliente is distinct from x.n;
end; $$;
revoke execute on function public._recalc_ordem_cliente(uuid) from public, anon, authenticated;

-- O gatilho antigo (antes do insert, contava todo Pix) sai.
drop trigger if exists trg_pedido_ordem_cliente on public.pedidos;

create or replace function public._pedido_ordem_recalc()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.metodo, '') <> 'deposito' then perform public._recalc_ordem_cliente(new.user_id); end if;
  return null;
end; $$;

drop trigger if exists trg_pedido_ordem_recalc_ins on public.pedidos;
create trigger trg_pedido_ordem_recalc_ins
  after insert on public.pedidos
  for each row execute function public._pedido_ordem_recalc();

drop trigger if exists trg_pedido_ordem_recalc_upd on public.pedidos;
create trigger trg_pedido_ordem_recalc_upd
  after update of status on public.pedidos
  for each row when (old.status is distinct from new.status)
  execute function public._pedido_ordem_recalc();

-- Recalcula todo mundo agora.
do $$ declare u uuid; begin
  for u in select distinct user_id from public.pedidos where user_id is not null loop
    perform public._recalc_ordem_cliente(u);
  end loop;
end $$;
