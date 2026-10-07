-- ===========================================================================
-- LIGADOR PREENCHE NOME E NASCIMENTO DO CLIENTE (quando a consulta de CPF falha).
-- Salva no perfil (profiles), no enriquecimento (dados_consulta) e no pagador dos
-- pedidos — então o login por CPF, "Meus dados" e o /ganhador já mostram na hora.
-- Rode isto UMA vez no Supabase (SQL Editor). Pode rodar de novo sem problema.
-- ===========================================================================

-- Cliente (user_id) do CPF, só se ele estiver numa ficha LIBERADA deste ligador.
create or replace function public._ligador_cliente_do_cpf(p_lig uuid, p_cpf text)
returns uuid language sql stable security definer set search_path = public as $$
  select pr.id from public.profiles pr
   where pr.cpf = regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g')
     and (
       (pr.ligador_id = p_lig and pr.ligador_liberado_at is not null)
       or exists (select 1 from public.pedidos p
                   where p.user_id = pr.id and p.ligador_id = p_lig and p.ligador_liberado_at is not null)
     )
   limit 1;
$$;
revoke execute on function public._ligador_cliente_do_cpf(uuid, text) from public, anon, authenticated;

-- Dados atuais (pra preencher o formulário da ficha).
create or replace function public.ligador_cliente(p_token uuid, p_cpf text)
returns table(nome text, nascimento date)
language plpgsql stable security definer set search_path = public as $$
declare v_lig uuid; v_uid uuid;
begin
  select l.id into v_lig from public.ligadores l where l.token = p_token and l.ativo = true;
  if v_lig is null then return; end if;
  v_uid := public._ligador_cliente_do_cpf(v_lig, p_cpf);
  if v_uid is null then return; end if;
  return query
    select coalesce(nullif(nullif(pr.nome, 'Cliente'), ''), nullif(dc.nome, '')),
           coalesce(pr.nascimento,
             case when dc.nascimento ~ '^\d{4}-\d{2}-\d{2}' then substr(dc.nascimento, 1, 10)::date
                  when dc.nascimento ~ '^\d{2}/\d{2}/\d{4}' then to_date(substr(dc.nascimento, 1, 10), 'DD/MM/YYYY') end)
      from public.profiles pr
      left join public.dados_consulta dc on dc.user_id = pr.id
     where pr.id = v_uid;
end; $$;
grant execute on function public.ligador_cliente(uuid, text) to anon, authenticated;

create or replace function public.ligador_atualizar_cliente(p_token uuid, p_cpf text, p_nome text, p_nascimento date)
returns void language plpgsql security definer set search_path = public as $$
declare v_lig uuid; v_uid uuid; v_nome text := nullif(btrim(regexp_replace(coalesce(p_nome, ''), '\s+', ' ', 'g')), '');
begin
  select l.id into v_lig from public.ligadores l where l.token = p_token and l.ativo = true;
  if v_lig is null then raise exception 'token invalido'; end if;
  v_uid := public._ligador_cliente_do_cpf(v_lig, p_cpf);
  if v_uid is null then raise exception 'Esse cliente não está nas suas fichas.'; end if;
  if v_nome is null then raise exception 'Informe o nome.'; end if;
  if length(v_nome) > 120 then raise exception 'Nome muito longo.'; end if;
  if p_nascimento is not null and (p_nascimento > current_date or p_nascimento < date '1900-01-01') then
    raise exception 'Data de nascimento inválida.';
  end if;

  update public.profiles set nome = v_nome, nascimento = coalesce(p_nascimento, nascimento) where id = v_uid;

  insert into public.dados_consulta (user_id, cpf, nome, nascimento, idade, updated_at)
  values (v_uid, regexp_replace(p_cpf, '\D', '', 'g'), v_nome,
          to_char(p_nascimento, 'DD/MM/YYYY'), extract(year from age(p_nascimento))::int, now())
  on conflict (user_id) do update set
    nome       = excluded.nome,
    nascimento = coalesce(excluded.nascimento, dados_consulta.nascimento),
    idade      = coalesce(excluded.idade, dados_consulta.idade),
    updated_at = now();

  update public.pedidos set pagador = coalesce(pagador, '{}'::jsonb) || jsonb_build_object('nome', v_nome)
   where user_id = v_uid;
end; $$;
grant execute on function public.ligador_atualizar_cliente(uuid, text, text, date) to anon, authenticated;

-- /ganhador: passa a devolver também a data de nascimento salva no banco.
drop function if exists public.dados_cpf(text);
create or replace function public.dados_cpf(p_cpf text)
returns table(nome text, email text, telefone text, cidade text, estado text, nascimento text)
language sql security definer stable set search_path = public as $$
  select coalesce(nullif(nullif(pr.nome, 'Cliente'), ''), nullif(dc.nome, '')),
         pr.email, pr.telefone, pr.cidade, pr.estado,
         coalesce(to_char(pr.nascimento, 'DD/MM/YYYY'), nullif(dc.nascimento, ''))
    from public.profiles pr
    left join public.dados_consulta dc on dc.user_id = pr.id
   where pr.cpf = regexp_replace(p_cpf, '\D', '', 'g')
   limit 1;
$$;
grant execute on function public.dados_cpf(text) to anon, authenticated;
