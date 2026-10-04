-- Pagamento com créditos precificado pelo catálogo salvo no servidor.
-- Execute uma vez no SQL Editor do Supabase, DEPOIS de whatsapp_cobranca_setup.sql
-- e antes de publicar o front novo.

begin;

create or replace function public.pagar_com_creditos(
  p_itens      jsonb,
  p_metodo     text  default 'creditos',
  p_utm        jsonb default '{}'::jsonb,
  p_visitor_id text  default null,
  p_pagador    jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid                 uuid := auth.uid();
  v_snapshot_text       text;
  v_snapshot            jsonb;
  v_agora               timestamptz := clock_timestamp();
  v_updated_at          timestamptz;
  v_draw_at             timestamptz;
  v_item                jsonb;
  v_raffle              jsonb;
  v_id                  text;
  v_ref                 text;
  v_edicao              text;
  v_qty                 bigint;
  v_numeros             bigint;
  v_preco_item_cent     bigint;
  v_preco_catalogo_cent bigint;
  v_subtotal_cent       bigint;
  v_total_cent          bigint := 0;
  v_itens_canonicos     jsonb := '[]'::jsonb;
  v_tem_sorteio         boolean := false;
  v_tem_upsell          boolean := false;
  v_total               numeric(12,2);
  v_saldo               numeric(12,2);
  v_pagador_canonico    jsonb;
  v_pedido              uuid;
begin
  if v_uid is null then
    raise exception 'nao autenticado';
  end if;
  if p_metodo is distinct from 'creditos' then
    raise exception 'metodo invalido';
  end if;
  if jsonb_typeof(p_itens) is distinct from 'array' then
    raise exception 'itens invalidos';
  end if;
  if jsonb_array_length(p_itens) = 0
     or jsonb_array_length(p_itens) > 100 then
    raise exception 'itens invalidos';
  end if;

  select valor into v_snapshot_text
  from public.configuracoes
  where chave = 'sorteios_snapshot';

  begin
    v_snapshot := v_snapshot_text::jsonb;
  exception when others then
    raise exception 'catalogo indisponivel';
  end;
  if jsonb_typeof(v_snapshot -> 'raffles') is distinct from 'array' then
    raise exception 'catalogo indisponivel';
  end if;
  if jsonb_array_length(v_snapshot -> 'raffles') = 0 then
    raise exception 'catalogo indisponivel';
  end if;
  begin
    v_updated_at := nullif(v_snapshot ->> 'updated_at', '')::timestamptz;
  exception when others then
    raise exception 'catalogo desatualizado';
  end;
  if v_updated_at is null
     or v_updated_at > v_agora + interval '5 minutes' then
    raise exception 'catalogo desatualizado';
  end if;

  for v_item in select value from jsonb_array_elements(p_itens)
  loop
    if jsonb_typeof(v_item) is distinct from 'object' then
      raise exception 'item invalido';
    end if;

    v_id := coalesce(v_item ->> 'id', '');
    if length(v_id) > 200 then
      raise exception 'item invalido';
    end if;

    if v_id = 'upsell-dia-da-sorte' then
      if jsonb_typeof(v_item -> 'qty') is distinct from 'number'
         or jsonb_typeof(v_item -> 'numeros') is distinct from 'number'
         or jsonb_typeof(v_item -> 'price') is distinct from 'number'
         or v_tem_upsell
         or coalesce(v_item ->> 'qty', '') <> '1'
         or coalesce(v_item ->> 'numeros', '') <> '20'
         or coalesce(v_item ->> 'price', '') !~ '^[0-9]+(\.[0-9]{1,4})?$'
         or round((v_item ->> 'price')::numeric * 100)::bigint <> 899 then
        raise exception 'oferta adicional invalida';
      end if;

      v_tem_upsell := true;
      v_total_cent := v_total_cent + 899;
      v_itens_canonicos := v_itens_canonicos || jsonb_build_array(jsonb_build_object(
        'id', 'upsell-dia-da-sorte',
        'title', 'Hoje é seu dia de sorte 🍀',
        'qty', 1,
        'price', 8.99,
        'numeros', 20
      ));
      continue;
    end if;

    if jsonb_typeof(v_item -> 'qty') is distinct from 'number'
       or coalesce(v_item ->> 'qty', '') !~ '^[0-9]+$' then
      raise exception 'quantidade invalida';
    end if;
    v_qty := (v_item ->> 'qty')::bigint;
    if v_qty < 1 or v_qty > 1000000 then
      raise exception 'quantidade invalida';
    end if;

    if v_item ? 'numeros' then
      if jsonb_typeof(v_item -> 'numeros') is distinct from 'number'
         or coalesce(v_item ->> 'numeros', '') !~ '^[0-9]+$' then
        raise exception 'numeros invalidos';
      end if;
      v_numeros := (v_item ->> 'numeros')::bigint;
    else
      v_numeros := v_qty;
    end if;
    if v_numeros <> v_qty then
      raise exception 'numeros invalidos';
    end if;

    if jsonb_typeof(v_item -> 'price') is distinct from 'number'
       or coalesce(v_item ->> 'price', '') !~ '^[0-9]+(\.[0-9]{1,4})?$' then
      raise exception 'preco invalido';
    end if;
    v_preco_item_cent := round((v_item ->> 'price')::numeric * 100)::bigint;

    v_edicao := coalesce(v_item ->> 'edition', '');
    if length(v_edicao) > 100 then
      raise exception 'edicao invalida';
    end if;
    v_raffle := null;

    if v_id ~ '^hero-[0-9]+$' and v_edicao <> '' then
      select raffle into v_raffle
      from jsonb_array_elements(v_snapshot -> 'raffles') as raffle
      where coalesce(raffle ->> 'edition', '') = v_edicao
        and (coalesce(raffle #>> '{category,slug}', '') = 'viva-sorte'
             or upper(coalesce(raffle ->> 'kind', '')) = 'MAIN')
      limit 1;
    elsif v_id ~ '^raffle-.+' then
      v_ref := substring(v_id from 8);
      select raffle into v_raffle
      from jsonb_array_elements(v_snapshot -> 'raffles') as raffle
      where (coalesce(raffle ->> 'uuid', '') = v_ref
             or coalesce(raffle ->> 'edition', '') = v_ref)
        and (v_edicao = '' or coalesce(raffle ->> 'edition', '') = v_edicao)
      limit 1;
    else
      raise exception 'sorteio invalido';
    end if;

    if v_raffle is null then
      raise exception 'sorteio indisponivel';
    end if;
    begin
      v_draw_at := nullif(v_raffle ->> 'drawDate', '')::timestamptz;
    exception when others then
      raise exception 'sorteio indisponivel';
    end;
    if v_draw_at is null or v_draw_at <= v_agora + interval '30 minutes' then
      raise exception 'sorteio encerrado';
    end if;
    if jsonb_typeof(v_raffle -> 'price') is distinct from 'number'
       or coalesce(v_raffle ->> 'price', '') !~ '^[0-9]+(\.[0-9]{1,4})?$' then
      raise exception 'preco do catalogo invalido';
    end if;
    v_preco_catalogo_cent := round((v_raffle ->> 'price')::numeric * 100)::bigint;
    if v_preco_catalogo_cent <= 0 or v_preco_item_cent <> v_preco_catalogo_cent then
      raise exception 'preco divergente';
    end if;

    v_subtotal_cent := v_preco_catalogo_cent * v_qty;
    if v_subtotal_cent <= 0 or v_total_cent > 999999999999 - v_subtotal_cent then
      raise exception 'total invalido';
    end if;
    v_total_cent := v_total_cent + v_subtotal_cent;
    v_tem_sorteio := true;
    v_itens_canonicos := v_itens_canonicos || jsonb_build_array(jsonb_build_object(
      'id', v_id,
      'title', coalesce(nullif(v_raffle ->> 'title', ''), 'Título Viva Sorte'),
      'qty', v_qty,
      'price', v_preco_catalogo_cent::numeric / 100,
      'numeros', v_qty,
      'edition', coalesce(v_raffle ->> 'edition', '')
    ));
  end loop;

  if not v_tem_sorteio then
    raise exception 'a oferta adicional precisa acompanhar um sorteio';
  end if;
  if v_total_cent <= 0 or v_total_cent > 999999999999 then
    raise exception 'total invalido';
  end if;
  v_total := v_total_cent::numeric / 100;

  select
    creditos_nao_sacaveis,
    jsonb_build_object(
      'nome', coalesce(nullif(nome_social, ''), nome, ''),
      'cpf', coalesce(cpf, ''),
      'email', coalesce(email, ''),
      'telefone', coalesce(telefone, '')
    )
  into v_saldo, v_pagador_canonico
  from public.profiles
  where id = v_uid
  for update;

  if v_saldo is null or v_saldo < v_total then
    raise exception 'saldo insuficiente';
  end if;

  update public.profiles
  set creditos_nao_sacaveis = creditos_nao_sacaveis - v_total
  where id = v_uid;

  insert into public.pedidos (user_id, total, status, itens, metodo, utm, visitor_id, pagador)
  values (
    v_uid,
    v_total,
    'pago',
    v_itens_canonicos,
    'creditos',
    case when jsonb_typeof(p_utm) = 'object' then p_utm else '{}'::jsonb end,
    left(p_visitor_id, 200),
    coalesce(v_pagador_canonico, '{}'::jsonb)
  )
  returning id into v_pedido;

  return v_pedido;
end;
$$;

revoke all on function public.pagar_com_creditos(jsonb, text, jsonb, text, jsonb) from public;
grant execute on function public.pagar_com_creditos(jsonb, text, jsonb, text, jsonb) to authenticated;

comment on function public.pagar_com_creditos(jsonb, text, jsonb, text, jsonb) is
  'Debita créditos e cria o pedido de forma atômica, precificando itens pelo sorteios_snapshot.';

-- Garante que o navegador não consiga adulterar o snapshot canônico depois que o
-- backend o selar. O cliente pode criar/ler o pendente e limpar apenas uma tentativa
-- que ainda não recebeu ID de cobrança; UPDATE continua exclusivo do admin/backend.
drop policy if exists "pedidos_proprios" on public.pedidos;
drop policy if exists "pedidos_select_proprio" on public.pedidos;
drop policy if exists "pedidos_insert_pendente" on public.pedidos;
drop policy if exists "pedidos_delete_pendente" on public.pedidos;

create policy "pedidos_select_proprio" on public.pedidos
  for select using (auth.uid() = user_id);

create policy "pedidos_insert_pendente" on public.pedidos
  for insert with check (
    auth.uid() = user_id
    and status = 'pendente'
    and pagarme_order_id is null
    and pagarme_charge_id is null
    and creditado = false
    and pix_e2e is null
    and pix_ispb is null
    and pix_banco is null
    and pix_copia_cola is null
    and pix_gerado_at is null
    and pix_expira_em is null
    and whatsapp_lembrete_at is null
    and whatsapp_lembrete_status is null
    and whatsapp_lembrete_admin_id is null
    and whatsapp_lembrete_atendimento is null
    and whatsapp_lembrete_destino is null
    and whatsapp_lembrete_modelo is null
    and exportado = false
    and exportado_at is null
    and ligador_id is null
    and ligador_status is null
    and ligador_obs is null
    and ligador_at is null
    and not (coalesce(pagador, '{}'::jsonb) ?| array[
      'pix_copia_cola', 'pix_gerado_at', 'pix_expira_em',
      'whatsapp_lembrete_at', 'whatsapp_lembrete_status',
      'whatsapp_lembrete_admin_id', 'whatsapp_lembrete_atendimento',
      'whatsapp_lembrete_destino', 'whatsapp_lembrete_modelo'
    ])
  );

create policy "pedidos_delete_pendente" on public.pedidos
  for delete using (
    auth.uid() = user_id
    and status = 'pendente'
    and pagarme_charge_id is null
    and public.pedido_sem_tentativa_pix(id)
  );

commit;
