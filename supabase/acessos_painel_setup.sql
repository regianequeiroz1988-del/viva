-- ===========================================================================
-- PAINEL DE ACESSOS (admin + gerente): visitas agrupadas por visitante.
-- Visitante = o aparelho (visitor_id do navegador); sem ele, o IP.
-- Rode isto UMA vez no Supabase (SQL Editor). Pode rodar de novo sem problema.
-- Requer gerentes_setup.sql (pra versão do gerente).
-- ===========================================================================
create index if not exists acessos_ip_idx on public.acessos (ip);

create or replace function public._acessos_painel(p_desde timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_desde timestamptz := greatest(coalesce(p_desde, now() - interval '1 day'), now() - interval '90 days');
  v_horas boolean := v_desde > now() - interval '36 hours';
  v_tz text := 'America/Sao_Paulo';
  v_res jsonb;
begin
  with a as (
    select x.*, coalesce(nullif(x.visitor_id, ''), 'ip:' || coalesce(nullif(x.ip, ''), '?')) as k
      from public.acessos x
     where x.created_at >= v_desde
  ),
  v as (
    select a.k,
           max(nullif(a.visitor_id, '')) as vid,
           count(*)::int as visitas,
           max(a.created_at) as ultima,
           (array_agg(a.ip order by a.created_at desc))[1] as ip,
           (array_agg(a.cidade order by a.created_at desc))[1] as cidade,
           (array_agg(a.uf order by a.created_at desc))[1] as uf,
           (array_agg(a.user_agent order by a.created_at desc))[1] as ua,
           count(distinct a.ip)::int as ips,
           (array_agg(jsonb_build_object('t', a.created_at, 'p', a.path, 'c', a.cidade, 'u', a.uf) order by a.created_at desc))[1:20] as linha
      from a group by a.k
  ),
  h as (
    select coalesce(nullif(x.visitor_id, ''), 'ip:' || coalesce(nullif(x.ip, ''), '?')) as k,
           count(*)::int as total, min(x.created_at) as primeira
      from public.acessos x
     where coalesce(nullif(x.visitor_id, ''), 'ip:' || coalesce(nullif(x.ip, ''), '?')) in (select k from v)
     group by 1
  ),
  p as (
    select pe.visitor_id as vid,
           bool_or(pe.status = 'pago' and coalesce(pe.metodo, '') <> 'deposito') as pagou,
           bool_or(pe.status <> 'pago') as gerou_pix,
           coalesce(sum(pe.total) filter (where pe.status = 'pago' and coalesce(pe.metodo, '') <> 'deposito'), 0) as valor_pago,
           (array_agg(coalesce(nullif(pe.pagador->>'nome', ''), pr.nome) order by pe.created_at desc))[1] as nome
      from public.pedidos pe left join public.profiles pr on pr.id = pe.user_id
     where pe.visitor_id in (select vid from v where vid is not null)
     group by pe.visitor_id
  ),
  vv as (
    select v.*, h.total, h.primeira, coalesce(p.pagou, false) as pagou, coalesce(p.gerou_pix, false) as gerou_pix,
           coalesce(p.valor_pago, 0) as valor_pago, p.nome
      from v join h on h.k = v.k left join p on p.vid = v.vid
  ),
  serie as (
    select g.b,
           (select count(distinct a.k) from a
             where date_trunc(case when v_horas then 'hour' else 'day' end, a.created_at at time zone v_tz) = g.b)::int as visitantes,
           (select count(*) from a
             where date_trunc(case when v_horas then 'hour' else 'day' end, a.created_at at time zone v_tz) = g.b)::int as acessos
      from generate_series(
             date_trunc(case when v_horas then 'hour' else 'day' end, v_desde at time zone v_tz),
             date_trunc(case when v_horas then 'hour' else 'day' end, now() at time zone v_tz),
             case when v_horas then interval '1 hour' else interval '1 day' end) as g(b)
  ),
  cid as (
    select coalesce(nullif(vv.cidade, ''), '(desconhecida)') as cidade, coalesce(vv.uf, '') as uf, count(*)::int as n
      from vv group by 1, 2 order by 3 desc limit 6
  )
  select jsonb_build_object(
    'agrupamento', case when v_horas then 'hora' else 'dia' end,
    'resumo', jsonb_build_object(
      'acessos', (select count(*) from a),
      'visitantes', (select count(*) from vv),
      'novos', (select count(*) from vv where vv.primeira >= v_desde),
      'voltaram', (select count(*) from vv where vv.total > 1),
      'online', (select count(*) from vv where vv.ultima > now() - interval '15 minutes'),
      'gerou_pix', (select count(*) from vv where vv.gerou_pix or vv.pagou),
      'pagaram', (select count(*) from vv where vv.pagou)
    ),
    'serie', coalesce((select jsonb_agg(jsonb_build_object('b', serie.b, 'v', serie.visitantes, 'a', serie.acessos) order by serie.b) from serie), '[]'),
    'cidades', coalesce((select jsonb_agg(jsonb_build_object('cidade', cid.cidade, 'uf', cid.uf, 'n', cid.n) order by cid.n desc) from cid), '[]'),
    'visitantes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'k', t.k, 'ip', t.ip, 'ips', t.ips, 'cidade', t.cidade, 'uf', t.uf, 'ua', t.ua,
        'visitas', t.visitas, 'total', t.total, 'primeira', t.primeira, 'ultima', t.ultima,
        'pagou', t.pagou, 'gerou_pix', t.gerou_pix, 'valor_pago', t.valor_pago, 'nome', t.nome,
        'linha', to_jsonb(t.linha)) order by t.ultima desc)
        from (select * from vv order by vv.ultima desc limit 300) t), '[]')
  ) into v_res;
  return v_res;
end; $$;
revoke execute on function public._acessos_painel(timestamptz) from public, anon, authenticated;

create or replace function public.acessos_painel(p_desde timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then return null; end if;
  return public._acessos_painel(p_desde);
end; $$;
grant execute on function public.acessos_painel(timestamptz) to authenticated;

create or replace function public.gerente_acessos(p_token uuid, p_desde timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if public._gerente_do_token(p_token) is null then return null; end if;
  return public._acessos_painel(p_desde);
end; $$;
grant execute on function public.gerente_acessos(uuid, timestamptz) to anon, authenticated;
