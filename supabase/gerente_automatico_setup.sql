-- ===========================================================================
-- GERENTE AUTOMÁTICO: com o botão ligado, todo pedido novo (pendente ou pago)
-- já nasce no estoque desse gerente, sem passar pelo admin. Só 1 gerente por vez.
-- Depósito de carteira não é ficha: continua fora.
-- Rode isto UMA vez no Supabase (SQL Editor), depois do gerentes_setup.sql.
-- Pode rodar de novo sem problema.
-- ===========================================================================
alter table public.gerentes add column if not exists recebe_automatico boolean not null default false;
create unique index if not exists gerentes_um_automatico on public.gerentes (recebe_automatico) where recebe_automatico;

create or replace function public._pedido_para_gerente_automatico()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.metodo, '') = 'deposito' then
    new.gerente_id := null;
  else
    new.gerente_id := (select g.id from public.gerentes g where g.recebe_automatico and g.ativo limit 1);
  end if;
  return new;
end; $$;
revoke execute on function public._pedido_para_gerente_automatico() from public, anon, authenticated;

drop trigger if exists trg_pedido_gerente_automatico on public.pedidos;
create trigger trg_pedido_gerente_automatico
  before insert on public.pedidos
  for each row execute function public._pedido_para_gerente_automatico();

-- Liga/desliga. Ligar num gerente desliga o que estava ligado.
create or replace function public.definir_gerente_automatico(p_gerente uuid, p_ativo boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'apenas admin'; end if;
  if p_ativo then
    update public.gerentes set recebe_automatico = false where recebe_automatico and id <> p_gerente;
    update public.gerentes set recebe_automatico = true where id = p_gerente;
  else
    update public.gerentes set recebe_automatico = false where id = p_gerente;
  end if;
end; $$;
grant execute on function public.definir_gerente_automatico(uuid, boolean) to authenticated;

drop function if exists public.listar_gerentes();
create or replace function public.listar_gerentes()
returns table(id uuid, usuario text, nome text, ativo boolean, created_at timestamptz,
              estoque int, qtd_ligadores bigint, recebe_automatico boolean)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return; end if;
  return query
    select g.id, g.usuario, g.nome, g.ativo, g.created_at, public._estoque_gerente(g.id),
           (select count(*) from public.ligadores l where l.gerente_id = g.id), g.recebe_automatico
    from public.gerentes g order by g.created_at desc;
end; $$;
grant execute on function public.listar_gerentes() to authenticated;

drop function if exists public.gerente_situacao(uuid);
create or replace function public.gerente_situacao(p_token uuid)
returns table(estoque int, solicitacao_pendente boolean, recebe_automatico boolean)
language plpgsql security definer set search_path = public as $$
declare v_ger uuid := public._gerente_do_token(p_token);
begin
  if v_ger is null then return; end if;
  return query select public._estoque_gerente(v_ger),
    exists(select 1 from public.solicitacoes_gerente s where s.gerente_id = v_ger and s.status = 'pendente'),
    (select g.recebe_automatico from public.gerentes g where g.id = v_ger);
end; $$;
grant execute on function public.gerente_situacao(uuid) to anon, authenticated;
