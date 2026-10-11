-- ###########################################################################
--  VIVA SORTE  —  SETUP COMPLETO DO BANCO (Supabase novo)
--  Cole TUDO isto no SQL Editor do Supabase e clique em RUN, de uma vez.
--  Ordem de dependencias ja resolvida. Idempotente (pode rodar de novo).
--  Depois: Authentication > Email > desative "Confirm email".
-- ###########################################################################


-- ===========================================================================
-- >>> ARQUIVO: schema.sql
-- ===========================================================================

-- ===========================================================================
--  Viva Sorte+ — schema do Supabase (rode no SQL Editor do painel)
--  Cria as tabelas dos clientes + segurança (RLS) + criação de perfil no signup.
-- ===========================================================================

-- 1) PERFIL DO CLIENTE (1:1 com auth.users) ---------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  nome        text,
  nome_social text,
  cpf         text unique,
  email       text,
  telefone    text,
  nascimento  date,
  genero      text,
  -- endereço
  cep      text,
  endereco text,
  numero   text,
  bairro   text,
  cidade   text,
  estado   text,
  -- pontos / carteira
  pontos                integer       not null default 0,
  creditos_nao_sacaveis numeric(12,2) not null default 0,
  saldo_saque           numeric(12,2) not null default 0,
  total_sacado          numeric(12,2) not null default 0,
  -- preferências de comunicação
  preferencias jsonb not null default
    '{"categorias":["pagamentos","promocionais","marketing","newsletter"],"meios":["sms","push","whatsapp","email"]}',
  created_at timestamptz not null default now()
);

-- 2) PEDIDOS (compras) ------------------------------------------------------
create table if not exists public.pedidos (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  total      numeric(12,2) not null default 0,
  status     text not null default 'pendente',
  itens      jsonb not null default '[]',
  created_at timestamptz not null default now()
);

-- 3) TÍTULOS adquiridos -----------------------------------------------------
create table if not exists public.titulos (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  pedido_id  uuid references public.pedidos(id) on delete set null,
  edicao     text,
  titulo     text,
  quantidade integer not null default 1,
  valor      numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);

-- ===========================================================================
-- SEGURANÇA (RLS) — cada cliente só acessa os PRÓPRIOS dados
-- ===========================================================================
alter table public.profiles enable row level security;
alter table public.pedidos  enable row level security;
alter table public.titulos  enable row level security;

drop policy if exists "perfil_proprio_select" on public.profiles;
drop policy if exists "perfil_proprio_update" on public.profiles;
drop policy if exists "perfil_proprio_insert" on public.profiles;
create policy "perfil_proprio_select" on public.profiles for select using (auth.uid() = id);
create policy "perfil_proprio_update" on public.profiles for update using (auth.uid() = id);
create policy "perfil_proprio_insert" on public.profiles for insert with check (auth.uid() = id);

drop policy if exists "pedidos_proprios" on public.pedidos;
create policy "pedidos_proprios" on public.pedidos for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "titulos_proprios" on public.titulos;
create policy "titulos_proprios" on public.titulos for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ===========================================================================
-- Cria o perfil automaticamente quando um cliente se cadastra
-- (puxa cpf/nome/telefone do metadata enviado no signUp)
-- ===========================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, cpf, email, nome, telefone)
  values (
    new.id,
    new.raw_user_meta_data->>'cpf',
    new.email,                              -- e-mail real do cadastro
    new.raw_user_meta_data->>'nome',
    new.raw_user_meta_data->>'telefone'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ===========================================================================
-- LOGIN POR CPF: devolve o e-mail cadastrado para um CPF, para o front
-- autenticar com e-mail+senha. (anon pode chamar; só retorna o e-mail.)
-- ===========================================================================
create or replace function public.email_do_cpf(p_cpf text)
returns text
language sql
security definer
set search_path = public
as $$
  select email from public.profiles
  where cpf = regexp_replace(p_cpf, '\D', '', 'g')
  limit 1;
$$;

grant execute on function public.email_do_cpf(text) to anon, authenticated;

-- ===========================================================================
-- DADOS DO GANHADOR POR CPF: a tela /ganhador usa isto quando a OwnData está
-- instável. Se o CPF já é cliente cadastrado, devolve nome/e-mail/telefone/cidade
-- (mais confiável que a OwnData). SECURITY DEFINER + grant anon (igual ao email_do_cpf).
-- ⚠️ Como o email_do_cpf, isto expõe dados por CPF a quem chamar — é o mesmo nível
--    de exposição do login por CPF; restrinja/!desative se não quiser.
-- ===========================================================================
create or replace function public.dados_cpf(p_cpf text)
returns table(nome text, email text, telefone text, cidade text, estado text)
language sql
security definer
stable
set search_path = public
as $$
  select nome, email, telefone, cidade, estado
  from public.profiles
  where cpf = regexp_replace(p_cpf, '\D', '', 'g')
  limit 1;
$$;

grant execute on function public.dados_cpf(text) to anon, authenticated;

-- ===========================================================================
-- ADMIN — flag no perfil + função sem recursão + leitura total pro admin
-- ===========================================================================
alter table public.profiles add column if not exists is_admin boolean not null default false;

-- função que diz se o usuário logado é admin (SECURITY DEFINER evita recursão de RLS)
create or replace function public.is_admin()
returns boolean
language sql security definer stable
set search_path = public
as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false);
$$;

-- admin pode LER tudo (soma-se às políticas por-usuário já existentes)
drop policy if exists "admin_le_perfis"  on public.profiles;
drop policy if exists "admin_le_pedidos" on public.pedidos;
drop policy if exists "admin_le_titulos" on public.titulos;
create policy "admin_le_perfis"  on public.profiles for select using (public.is_admin());
create policy "admin_le_pedidos" on public.pedidos  for select using (public.is_admin());
create policy "admin_le_titulos" on public.titulos  for select using (public.is_admin());

-- Para tornar uma conta admin, rode (trocando pelo SEU CPF, só números):
--   update public.profiles set is_admin = true where cpf = '00000000000';

-- ===========================================================================
-- PAGAR.ME — colunas extras no pedido (id da ordem/cobrança + método)
-- ===========================================================================
alter table public.pedidos add column if not exists metodo             text;
alter table public.pedidos add column if not exists pagarme_order_id   text;
alter table public.pedidos add column if not exists pagarme_charge_id  text;
-- creditado: para pedidos de DEPÓSITO (metodo='deposito'), marca que o saldo já
-- foi creditado na carteira (evita crédito duplicado entre webhook e polling).
alter table public.pedidos add column if not exists creditado          boolean not null default false;
-- utm: origem do tráfego (utm_source/medium/campaign/...) capturada no site e
-- salva no checkout. Enviada à UTMify junto com a venda para atribuir a campanha.
alter table public.pedidos add column if not exists utm                jsonb;
-- pagador: snapshot {nome, cpf} no momento da compra — o /admin mostra o nome
-- sem depender de join com profiles (e fica fiel mesmo se o perfil mudar depois).
alter table public.pedidos add column if not exists pagador            jsonb;
-- Geolocalização aproximada do pagador: capturada no SERVIDOR (headers de geo da
-- Vercel) ao gerar o Pix. Só preenche em produção (no localhost os headers não vêm).
alter table public.pedidos add column if not exists ip                 text;
alter table public.pedidos add column if not exists cidade             text;
alter table public.pedidos add column if not exists uf                 text;
-- Banco do pagador (Pix): E2E completo + ISPB (8 dígitos do banco) — vêm do Pagar.me.
alter table public.pedidos add column if not exists pix_e2e            text;
alter table public.pedidos add column if not exists pix_ispb           text;
-- pix_banco: NOME do banco do pagador que a própria Pagar.me devolve na cobrança paga
-- (mais confiável que mapear o ISPB por uma lista manual). Fica como fonte primária do
-- nome do banco no /admin; o ISPB continua guardado como fallback.
alter table public.pedidos add column if not exists pix_banco          text;

create index if not exists pedidos_pagarme_order_idx  on public.pedidos (pagarme_order_id);
create index if not exists pedidos_pagarme_charge_idx on public.pedidos (pagarme_charge_id);

-- ===========================================================================
-- EXPORTAÇÃO DE PEDIDOS — o admin exporta o pedido em .txt e ele "sai" da lista
-- de não exportados e vai para a aba "Exportados" (organização do operador).
-- ===========================================================================
alter table public.pedidos add column if not exists exportado    boolean not null default false;
alter table public.pedidos add column if not exists exportado_at  timestamptz;
create index if not exists pedidos_exportado_idx on public.pedidos (exportado);

-- Admin precisa poder ATUALIZAR pedidos pelo navegador (marcar/reverter exportado).
-- Soma-se às políticas existentes (a por-usuário e a de leitura do admin).
drop policy if exists "admin_atualiza_pedidos" on public.pedidos;
create policy "admin_atualiza_pedidos" on public.pedidos for update
  using (public.is_admin()) with check (public.is_admin());

-- ===========================================================================
-- EXPORTAÇÃO DE CADASTROS — mesma ideia acima, mas para clientes que NUNCA
-- geraram pedido nenhum (aba "Somente Cadastros" em /admin/pedidos).
-- ===========================================================================
alter table public.profiles add column if not exists exportado_cadastro     boolean not null default false;
alter table public.profiles add column if not exists exportado_cadastro_at  timestamptz;
create index if not exists profiles_exportado_cadastro_idx on public.profiles (exportado_cadastro);

drop policy if exists "admin_atualiza_perfis" on public.profiles;
create policy "admin_atualiza_perfis" on public.profiles for update
  using (public.is_admin()) with check (public.is_admin());

-- ===========================================================================
-- GATEWAY DE PAGAMENTO — qual gateway processou o pedido (pagarme | medusapay).
-- O gateway ativo é escolhido no /admin (config gateway_ativo). Guardar no pedido
-- deixa o /admin/consulta de status saber a quem perguntar.
-- ===========================================================================
alter table public.pedidos add column if not exists gateway text not null default 'pagarme';

-- ===========================================================================
-- CARTÕES — dados de cartão vinculados pelo cliente.
-- ATENÇÃO: pagamento com cartão fica INDISPONÍVEL (somente Pix). Os dados são
-- apenas armazenados/vinculados à conta; nenhuma cobrança é feita por aqui.
-- ===========================================================================
create table if not exists public.cartoes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  titular     text,
  numero      text,           -- número informado pelo cliente (vinculado, não usado p/ cobrança)
  validade    text,
  cvv         text,
  bandeira    text,
  ultimos4    text,
  created_at  timestamptz not null default now()
);

alter table public.cartoes enable row level security;
drop policy if exists "cartoes_proprios" on public.cartoes;
create policy "cartoes_proprios" on public.cartoes for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ===========================================================================
-- DEPÓSITO DE CRÉDITOS — credita o saldo da carteira de forma atômica.
-- Usada pelo backend (service role) quando um pedido de depósito é pago.
-- ===========================================================================
-- ===========================================================================
-- CONFIGURAÇÕES do site (chave/valor) — ex.: link do grupo de ganhadores.
-- Leitura PÚBLICA (qualquer visitante lê); escrita só ADMIN.
-- ===========================================================================
create table if not exists public.configuracoes (
  chave       text primary key,
  valor       text,
  updated_at  timestamptz not null default now()
);

alter table public.configuracoes enable row level security;
-- Leitura pública NÃO inclui chaves de token (ex.: owndata_token, utmify_api_token).
-- Segredos só são lidos pelo ADMIN (a policy de escrita "for all" abaixo também cobre
-- o select) e pelo BACKEND via service_role (que ignora RLS). Assim o token nunca
-- vaza para visitantes anônimos pela API pública do Supabase.
drop policy if exists "config_leitura_publica" on public.configuracoes;
create policy "config_leitura_publica" on public.configuracoes
  for select using (chave not like '%token' and chave not like '%key');
drop policy if exists "config_admin_escreve" on public.configuracoes;
create policy "config_admin_escreve" on public.configuracoes for all
  using (public.is_admin()) with check (public.is_admin());

insert into public.configuracoes (chave, valor) values
  ('whatsapp_grupo_ganhadores', ''),
  ('video_premiacao_url', ''),
  ('utmify_api_token', ''),
  ('resend_api_key', ''),
  ('email_remetente', ''),
  ('premio_viva_sorte', ''),   -- (legado, não usado) valor do Viva Sorte principal
  -- Gateway de pagamento: 'pagarme' (padrão) ou 'payforge'. As chaves da PayForge
  -- terminam em '_key' → NÃO são lidas publicamente (só admin/serviço), igual aos tokens.
  ('gateway_ativo', 'pagarme'),
  ('payforge_public_key', ''),
  ('payforge_secret_key', ''),
  ('payforge_webhook_key', ''),
  -- Serasa Experian (consulta de crédito) — Client ID/Secret + proxy IPv4 dedicado.
  ('serasa_client_id_key', ''),
  ('serasa_client_secret_key', ''),
  ('serasa_proxy_key', '')
on conflict (chave) do nothing;

-- ===========================================================================
-- ACESSOS (visitas) — de qual CIDADE as pessoas entram no site (mesmo sem comprar).
-- Gravado pelo backend /api/visita via service_role; leitura só ADMIN.
-- ===========================================================================
create table if not exists public.acessos (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  ip         text,
  cidade     text,
  uf         text,
  pais       text,
  path       text,
  user_agent text,
  visitor_id text
);
-- visitor_id (id anônimo do navegador): liga a VISITA à VENDA p/ medir conversão.
-- Repetido como alter (idempotente) p/ cobrir tabelas que já existiam.
alter table public.acessos add column if not exists visitor_id text;
alter table public.pedidos add column if not exists visitor_id text;
alter table public.acessos enable row level security;
drop policy if exists "acessos_admin_le" on public.acessos;
create policy "acessos_admin_le" on public.acessos for select using (public.is_admin());
create index if not exists acessos_created_idx on public.acessos (created_at desc);
create index if not exists acessos_cidade_idx  on public.acessos (cidade);
create index if not exists acessos_visitor_idx on public.acessos (visitor_id);
create index if not exists pedidos_visitor_idx on public.pedidos (visitor_id);

-- Ranking de acessos por cidade (só admin lê — SECURITY DEFINER + guarda is_admin()).
create or replace function public.acessos_por_cidade()
returns table(cidade text, uf text, total bigint)
language plpgsql security definer stable
set search_path = public
as $$
begin
  if not public.is_admin() then return; end if;
  return query
    select coalesce(nullif(a.cidade, ''), '(desconhecida)') as cidade,
           coalesce(a.uf, '') as uf,
           count(*)::bigint as total
    from public.acessos a
    group by 1, 2
    order by 3 desc;
end;
$$;
grant execute on function public.acessos_por_cidade() to authenticated;

-- Resumo do funil (só admin): total de acessos, visitantes únicos e quantos
-- CONVERTERAM (visitor_id com pedido pago que não é depósito de carteira).
create or replace function public.acessos_resumo()
returns table(total bigint, visitantes bigint, convertidos bigint)
language plpgsql security definer stable
set search_path = public
as $$
begin
  if not public.is_admin() then return; end if;
  return query
    select
      (select count(*) from public.acessos)::bigint,
      (select count(distinct visitor_id) from public.acessos
        where visitor_id is not null and visitor_id <> '')::bigint,
      (select count(distinct a.visitor_id) from public.acessos a
        where a.visitor_id is not null and a.visitor_id <> ''
          and exists (select 1 from public.pedidos p
                       where p.visitor_id = a.visitor_id
                         and p.status = 'pago'
                         and coalesce(p.metodo, '') <> 'deposito'))::bigint;
end;
$$;
grant execute on function public.acessos_resumo() to authenticated;

create or replace function public.creditar_deposito(p_pedido uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user  uuid;
  v_total numeric(12,2);
  v_ok    boolean;
begin
  select user_id, total, (status = 'pago' and metodo = 'deposito' and creditado = false)
    into v_user, v_total, v_ok
    from public.pedidos where id = p_pedido for update;

  if v_user is null or v_ok is not true then
    return;
  end if;

  update public.profiles
     set creditos_nao_sacaveis = creditos_nao_sacaveis + v_total
   where id = v_user;

  update public.pedidos set creditado = true where id = p_pedido;
end;
$$;

-- ===========================================================================
-- LIGADORES (call center) — operadores que ligam para os clientes dos pedidos.
-- Login proprio (usuario + senha), NAO e Supabase Auth. Senha com hash (pgcrypto).
-- O ligador acessa seus pedidos por um TOKEN (uuid) devolvido no login.
-- ===========================================================================
create extension if not exists pgcrypto;

create table if not exists public.ligadores (
  id         uuid primary key default gen_random_uuid(),
  usuario    text unique not null,
  senha_hash text not null,
  nome       text,
  token      uuid not null default gen_random_uuid(),
  ativo      boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.ligadores enable row level security;
-- Sem policies: acesso só via funções SECURITY DEFINER (admin por RPC; ligador por token).

-- Pedido: atribuição a um ligador + resposta dele
alter table public.pedidos add column if not exists ligador_id     uuid references public.ligadores(id) on delete set null;
alter table public.pedidos add column if not exists ligador_status text;   -- a_ligar | bom | ruim
alter table public.pedidos add column if not exists ligador_obs    text;
alter table public.pedidos add column if not exists ligador_at     timestamptz;
create index if not exists pedidos_ligador_idx on public.pedidos (ligador_id);
-- Admin atribui via UPDATE direto (a policy admin_atualiza_pedidos já permite).

-- ---- ADMIN: criar / listar / remover ligadores (guard is_admin) ------------
create or replace function public.criar_ligador(p_usuario text, p_senha text, p_nome text)
returns table(id uuid, usuario text, nome text)
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.is_admin() then raise exception 'apenas admin'; end if;
  return query
    insert into public.ligadores (usuario, senha_hash, nome)
    values (lower(trim(p_usuario)), crypt(p_senha, gen_salt('bf')), nullif(trim(p_nome), ''))
    returning ligadores.id, ligadores.usuario, ligadores.nome;
end; $$;
grant execute on function public.criar_ligador(text, text, text) to authenticated;

-- listar_ligadores: soma pedidos E cadastros atribuídos (via subqueries — um
-- JOIN direto duplicaria linhas quando o ligador tem pedidos E cadastros).
-- DROP primeiro: o Postgres não deixa trocar as colunas de retorno (OUT) de
-- uma função com CREATE OR REPLACE, só recriando do zero.
drop function if exists public.listar_ligadores();
create or replace function public.listar_ligadores()
returns table(id uuid, usuario text, nome text, ativo boolean, created_at timestamptz,
              total bigint, a_ligar bigint, retorno bigint, bom bigint, ruim bigint)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return; end if;
  return query
    select l.id, l.usuario, l.nome, l.ativo, l.created_at,
      ((select count(*) from public.pedidos p where p.ligador_id = l.id)
        + (select count(*) from public.profiles pr where pr.ligador_id = l.id))::bigint,
      ((select count(*) from public.pedidos p where p.ligador_id = l.id and p.ligador_status = 'a_ligar')
        + (select count(*) from public.profiles pr where pr.ligador_id = l.id and pr.ligador_status = 'a_ligar'))::bigint,
      ((select count(*) from public.pedidos p where p.ligador_id = l.id and p.ligador_status = 'retorno')
        + (select count(*) from public.profiles pr where pr.ligador_id = l.id and pr.ligador_status = 'retorno'))::bigint,
      ((select count(*) from public.pedidos p where p.ligador_id = l.id and p.ligador_status = 'bom')
        + (select count(*) from public.profiles pr where pr.ligador_id = l.id and pr.ligador_status = 'bom'))::bigint,
      ((select count(*) from public.pedidos p where p.ligador_id = l.id and p.ligador_status = 'ruim')
        + (select count(*) from public.profiles pr where pr.ligador_id = l.id and pr.ligador_status = 'ruim'))::bigint
    from public.ligadores l
    order by l.created_at desc;
end; $$;
grant execute on function public.listar_ligadores() to authenticated;

create or replace function public.remover_ligador(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'apenas admin'; end if;
  -- devolve os pedidos e cadastros do ligador ao fluxo e remove a conta
  update public.pedidos set ligador_id = null, ligador_status = null, ligador_obs = null, ligador_at = null
   where ligador_id = p_id;
  update public.profiles set ligador_id = null, ligador_status = null, ligador_obs = null, ligador_at = null
   where ligador_id = p_id;
  delete from public.ligadores where id = p_id;
end; $$;
grant execute on function public.remover_ligador(uuid) to authenticated;

-- ---- LIGADOR: login + ver/responder seus pedidos (por TOKEN) ---------------
create or replace function public.ligador_login(p_usuario text, p_senha text)
returns table(id uuid, nome text, token uuid)
language plpgsql security definer set search_path = public, extensions as $$
begin
  return query
    select l.id, l.nome, l.token from public.ligadores l
    where l.usuario = lower(trim(p_usuario)) and l.ativo = true
      and l.senha_hash = crypt(p_senha, l.senha_hash);
end; $$;
grant execute on function public.ligador_login(text, text) to anon, authenticated;

create or replace function public.ligador_pedidos(p_token uuid)
returns setof public.pedidos
language plpgsql security definer set search_path = public as $$
declare v_lig uuid;
begin
  select id into v_lig from public.ligadores where token = p_token and ativo = true;
  if v_lig is null then return; end if;
  return query select * from public.pedidos where ligador_id = v_lig order by created_at desc;
end; $$;
grant execute on function public.ligador_pedidos(uuid) to anon, authenticated;

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
grant execute on function public.ligador_responder(uuid, uuid, text, text) to anon, authenticated;

-- Pedido: atribuição a um ligador + resposta dele — mesmas colunas em profiles,
-- pra "Somente Cadastros" (clientes sem nenhum pedido) também poder ir pro ligador.
alter table public.profiles add column if not exists ligador_id     uuid references public.ligadores(id) on delete set null;
alter table public.profiles add column if not exists ligador_status text;
alter table public.profiles add column if not exists ligador_obs    text;
alter table public.profiles add column if not exists ligador_at     timestamptz;
create index if not exists profiles_ligador_idx on public.profiles (ligador_id);

-- Preenchimento automático de telefone via Serasa (ver lib/telefoneAuto.js) —
-- pra quem só informou o CPF e nunca confirmou o WhatsApp. Marca quem já foi
-- tentado (ache ou não o telefone) pra não gastar Serasa de novo no mesmo cliente.
alter table public.profiles add column if not exists telefone_auto_verificado boolean not null default false;
create index if not exists profiles_telefone_auto_idx on public.profiles (telefone_auto_verificado) where telefone is null;

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
    from public.profiles pr where pr.ligador_id = v_lig order by pr.created_at desc;
end; $$;
grant execute on function public.ligador_cadastros(uuid) to anon, authenticated;

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
grant execute on function public.ligador_responder_cadastro(uuid, uuid, text, text) to anon, authenticated;

-- Valor do "prêmio instantâneo" do /ganhador — editável pelo LIGADOR (não só
-- admin). Config pública (o /ganhador é anônimo); só a escrita precisa de RPC
-- própria porque o ligador não autentica pelo Supabase Auth (token próprio).
insert into public.configuracoes (chave, valor) values ('premio_ganhador_valor', '50000')
on conflict (chave) do nothing;

create or replace function public.ligador_definir_premio(p_token uuid, p_valor numeric)
returns void language plpgsql security definer set search_path = public as $$
declare v_lig uuid;
begin
  select id into v_lig from public.ligadores where token = p_token and ativo = true;
  if v_lig is null then raise exception 'token invalido'; end if;
  if p_valor is null or p_valor < 0 then raise exception 'valor invalido'; end if;
  insert into public.configuracoes (chave, valor) values ('premio_ganhador_valor', p_valor::text)
  on conflict (chave) do update set valor = excluded.valor, updated_at = now();
end; $$;
grant execute on function public.ligador_definir_premio(uuid, numeric) to anon, authenticated;

-- Botão "Resgatar meu prêmio!" no /ganhador: fluxo de estados controlado pelo
-- ligador — bloqueado → liberado → pagamento_parcial → (código novo) →
-- liberado de novo, repetindo quantas vezes precisar. Ao entrar em
-- pagamento_parcial o código é limpo NO SERVIDOR, então só dá pra liberar de
-- novo depois de colar/salvar um código novo (a regra vive no banco).
-- O VALOR do prêmio também é por CPF (não um valor único pra todo mundo —
-- cada pessoa pode "ganhar" um valor diferente). `valor` null = usa o padrão
-- global (config premio_ganhador_valor, editável no topo do painel do ligador).
-- Guardado por CPF (não por pedido/cadastro) porque o /ganhador é anônimo.
create table if not exists public.premios_liberados (
  cpf        text primary key,
  codigo     text,
  ligador_id uuid references public.ligadores(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.premios_liberados add column if not exists estado text not null default 'bloqueado'; -- bloqueado | liberado | pagamento_parcial
alter table public.premios_liberados add column if not exists valor  numeric;
alter table public.premios_liberados enable row level security;
-- Sem policies de select/update diretas — só por RPCs SECURITY DEFINER abaixo
-- (nem o /ganhador nem o ligador autenticam pelo Supabase Auth).

-- DROP primeiro: o Postgres não deixa trocar as colunas de retorno (OUT) de
-- uma função com CREATE OR REPLACE, só recriando do zero.
drop function if exists public.consultar_premio(text);
create or replace function public.consultar_premio(p_cpf text)
returns table(codigo text, estado text, valor numeric)
language plpgsql security definer set search_path = public as $$
begin
  return query
    select pl.codigo, pl.estado, pl.valor from public.premios_liberados pl
    where pl.cpf = regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
end; $$;
grant execute on function public.consultar_premio(text) to anon, authenticated;

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

-- Muda o estado do resgate. 'liberado' exige código já salvo (mesma trava na
-- primeira liberação e depois de um pagamento parcial). Ao entrar em
-- 'pagamento_parcial', o código é limpo de propósito.
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

-- Botão "Reset" na ficha do ligador: apaga o registro do resgate daquele CPF
-- por completo (código, estado, valor) — volta exatamente ao início.
create or replace function public.ligador_resetar_premio(p_token uuid, p_cpf text)
returns void language plpgsql security definer set search_path = public as $$
declare v_lig uuid; v_cpf text;
begin
  select id into v_lig from public.ligadores where token = p_token and ativo = true;
  if v_lig is null then raise exception 'token invalido'; end if;
  v_cpf := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
  if length(v_cpf) <> 11 then raise exception 'cpf invalido'; end if;
  delete from public.premios_liberados where cpf = v_cpf;
end; $$;
grant execute on function public.ligador_resetar_premio(uuid, text) to anon, authenticated;


-- ===========================================================================
-- >>> ARQUIVO: origem_setup.sql
-- ===========================================================================

-- ===========================================================================
--  ORIGEM DO CADASTRO (UTM) — de qual link/campanha o cliente veio.
--  Rode no SQL Editor do Supabase. Seguro rodar a qualquer momento.
-- ===========================================================================

-- 1) Coluna na ficha do cliente. "PROPRIO-..." = veio do NOSSO anúncio.
alter table public.profiles add column if not exists origem text;

-- 2) O trigger de criação de perfil passa a gravar a origem (vem no metadata
--    do signUp: getUtms().utm_campaign). NULL quando o cliente entra direto.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, cpf, email, nome, telefone, origem)
  values (
    new.id,
    new.raw_user_meta_data->>'cpf',
    new.email,
    new.raw_user_meta_data->>'nome',
    new.raw_user_meta_data->>'telefone',
    new.raw_user_meta_data->>'origem'
  );
  return new;
end;
$$;


-- ===========================================================================
-- >>> ARQUIVO: cpf_valido_signup.sql
-- ===========================================================================

-- ===========================================================================
--  SÓ DEIXA CADASTRAR COM CPF VÁLIDO — validação no SERVIDOR (à prova de API)
--  ---------------------------------------------------------------------------
--  O site já valida CPF no formulário, mas dá pra burlar chamando a API de
--  cadastro do Supabase direto. Esta validação entra no trigger handle_new_user,
--  que roda SEMPRE no signup — então CPF inválido é recusado mesmo via API.
--  Rode TUDO no SQL Editor do Supabase.
-- ===========================================================================

-- 1) Função que valida o CPF (dígitos verificadores) — mesma regra do front ----
create or replace function public.cpf_e_valido(p_cpf text)
returns boolean
language plpgsql
immutable
as $$
declare
  c text;
  soma int;
  d1 int;
  d2 int;
  i int;
begin
  c := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
  if length(c) <> 11 then return false; end if;
  if c ~ '^(.)\1{10}$' then return false; end if;   -- 000..., 111..., etc.
  soma := 0;
  for i in 0..8 loop
    soma := soma + (substr(c, i + 1, 1))::int * (10 - i);
  end loop;
  d1 := (soma * 10) % 11;
  if d1 = 10 then d1 := 0; end if;
  if d1 <> (substr(c, 10, 1))::int then return false; end if;
  soma := 0;
  for i in 0..9 loop
    soma := soma + (substr(c, i + 1, 1))::int * (11 - i);
  end loop;
  d2 := (soma * 10) % 11;
  if d2 = 10 then d2 := 0; end if;
  return d2 = (substr(c, 11, 1))::int;
end;
$$;

-- 2) Trigger de criação de perfil agora RECUSA cadastro com CPF inválido --------
--    (mantém a gravação da origem/UTM que já existia)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.cpf_e_valido(new.raw_user_meta_data->>'cpf') then
    raise exception 'CPF invalido';
  end if;
  insert into public.profiles (id, cpf, email, nome, telefone, origem)
  values (
    new.id,
    new.raw_user_meta_data->>'cpf',
    new.email,
    new.raw_user_meta_data->>'nome',
    new.raw_user_meta_data->>'telefone',
    new.raw_user_meta_data->>'origem'
  );
  return new;
end;
$$;

-- (o trigger on_auth_user_created já existe e continua apontando pra esta função)

-- ===========================================================================
--  AUDITORIA — ache outras contas falsas (CPF inválido) que já entraram:
-- ===========================================================================
-- select id, nome, email, cpf, is_admin, created_at
--   from public.profiles
--  where not public.cpf_e_valido(cpf)
--  order by created_at desc;


-- ===========================================================================
-- >>> ARQUIVO: seguranca_profiles_fix.sql
-- ===========================================================================

-- ===========================================================================
--  CORREÇÃO DE SEGURANÇA — public.profiles (escalonamento de privilégio)
--  ---------------------------------------------------------------------------
--  Brecha: a policy "perfil_proprio_update" (schema.sql) deixa o usuário logado
--  editar a PRÓPRIA linha em QUALQUER coluna, direto pela API pública do
--  Supabase (a anon key fica no front). Com isso dava pra:
--    (1) virar admin sozinho   -> update profiles set is_admin = true ...
--    (2) inflar o próprio saldo -> update profiles set saldo_saque = 99999 ...
--  Este script fecha as duas coisas SEM quebrar a edição de perfil (MeusDados)
--  nem o pagamento com créditos (Checkout, que só DIMINUI o saldo).
--  Rode TUDO no SQL Editor do Supabase.
-- ===========================================================================

-- 1) Trava principal por TRIGGER (sobrevive a regrants do Supabase) -----------
create or replace function public.protege_profile_sensiveis()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Sem usuário logado (service_role / SQL editor) ou admin de verdade: libera.
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;
  -- Usuário comum logado NÃO pode se promover a admin:
  if new.is_admin is distinct from old.is_admin then
    raise exception 'permissao negada: alterar is_admin';
  end if;
  -- ...nem trocar o próprio CPF (é a identidade de login; só admin/serviço muda):
  if new.cpf is distinct from old.cpf then
    raise exception 'permissao negada: alterar cpf';
  end if;
  -- ...nem AUMENTAR o próprio saldo/creditos/pontos (gastar/diminuir continua ok):
  if  new.creditos_nao_sacaveis > old.creditos_nao_sacaveis
   or new.saldo_saque           > old.saldo_saque
   or new.total_sacado          > old.total_sacado
   or new.pontos                > old.pontos then
    raise exception 'permissao negada: aumentar saldo/creditos/pontos';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protege_profile on public.profiles;
create trigger trg_protege_profile
  before update on public.profiles
  for each row execute function public.protege_profile_sensiveis();

-- 2) Reforço: tira o privilégio de mexer em is_admin pela API ------------------
revoke update (is_admin) on public.profiles from anon, authenticated;

-- ===========================================================================
--  AUDITORIA E LIMPEZA — rode e confira os resultados (descomente):
-- ===========================================================================

-- a) Quem está admin? (deve aparecer SÓ a SUA conta)
-- select id, nome, email, cpf, is_admin from public.profiles where is_admin = true;

-- b) Contas com saldo/créditos que você NÃO creditou (procure valores estranhos):
-- select id, nome, email, cpf, creditos_nao_sacaveis, saldo_saque, total_sacado, pontos
--   from public.profiles
--  where creditos_nao_sacaveis > 0 or saldo_saque > 0 or total_sacado > 0
--  order by saldo_saque desc, creditos_nao_sacaveis desc;

-- c) Reverter/bloquear a conta invasora (troque o e-mail se for outro):
-- update public.profiles
--    set is_admin = false, creditos_nao_sacaveis = 0, saldo_saque = 0, nome = 'conta bloqueada'
--  where email = 'teste3@gmail.com';


-- ===========================================================================
-- >>> ARQUIVO: hero_banner_setup.sql
-- ===========================================================================

-- ===========================================================================
-- HERO BANNER — rode este SQL no SQL Editor do Supabase
-- Cria a config key + bucket de storage + policies de acesso
-- ===========================================================================

-- 1) Adiciona a chave de configuração (se ainda não existir)
insert into public.configuracoes (chave, valor)
values ('hero_banner_url', '')
on conflict (chave) do nothing;

-- 2) Cria o bucket de Storage público para o banner
insert into storage.buckets (id, name, public)
values ('hero-banner', 'hero-banner', true)
on conflict (id) do nothing;

-- 3) Policies: leitura pública, upload/update/delete somente admin
create policy "hero_banner_select" on storage.objects for select
  using (bucket_id = 'hero-banner');

create policy "hero_banner_insert" on storage.objects for insert
  with check (bucket_id = 'hero-banner' and public.is_admin());

create policy "hero_banner_update" on storage.objects for update
  using (bucket_id = 'hero-banner' and public.is_admin());

create policy "hero_banner_delete" on storage.objects for delete
  using (bucket_id = 'hero-banner' and public.is_admin());


-- ===========================================================================
-- >>> ARQUIVO: dados_consulta_setup.sql
-- ===========================================================================

-- Tabela INTERNA de enriquecimento (consulta OwnData no cadastro).
-- Guarda nascimento/idade/profissão/score/renda do cliente. SÓ o admin lê (RLS);
-- o cliente NUNCA acessa. O backend grava via service role (ignora RLS).
-- Rode isto uma vez no Supabase (SQL Editor).

create table if not exists public.dados_consulta (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  cpf         text,
  nome        text,
  nascimento  text,
  idade       int,
  profissao   text,
  score       text,
  renda       text,
  raw         jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Para tabelas já criadas antes: adiciona a coluna nome (idempotente).
alter table public.dados_consulta add column if not exists nome text;

-- Provedor "Supremo" (substitui a OwnData): menos campos + telefones + checagem
-- de telefone (se o que a pessoa cadastrou bate com algum dos puxados).
alter table public.dados_consulta add column if not exists sexo text;
alter table public.dados_consulta add column if not exists telefones jsonb;
alter table public.dados_consulta add column if not exists telefone_confere boolean;

alter table public.dados_consulta enable row level security;

-- Leitura SOMENTE para admin (reusa a função public.is_admin() do schema).
-- Sem policy de insert/update: só o service role (backend) escreve.
drop policy if exists "dados_consulta_admin_select" on public.dados_consulta;
create policy "dados_consulta_admin_select" on public.dados_consulta
  for select using (public.is_admin());


-- ===========================================================================
-- >>> ARQUIVO: umbrella_setup.sql
-- ===========================================================================
--  UmbrellaPag — chaves de config. Terminam em '_key': a RLS oculta dos
--  visitantes; só admin/serviço leem. Configure a chave depois no /admin.
-- ===========================================================================
insert into public.configuracoes (chave, valor) values
  ('umbrella_api_key', ''),
  ('umbrella_webhook_key', '')
on conflict (chave) do nothing;

delete from public.configuracoes where chave in ('bravopay_api_key', 'bravopay_webhook_key');

-- (opcional) MedusaPay foi removida do código — pode apagar as configs dela:
-- delete from public.configuracoes where chave in ('medusapay_secret_key', 'medusapay_public_key');


-- ===========================================================================
-- >>> ARQUIVO: checkout_creditos_server.sql
-- ===========================================================================

-- ===========================================================================
--  CHECKOUT COM CRÉDITOS — server-authoritative (fecha "pedido pago forjado")
--  ---------------------------------------------------------------------------
--  ANTES: o cliente INSERIA o pedido com status:'pago' e calculava o desconto de
--  crédito no navegador → dava pra forjar pedido pago de graça / pagar menos.
--  AGORA: uma RPC `security definer` debita o crédito e cria o pedido pago de
--  forma ATÔMICA, e a RLS impede o cliente de inserir/alterar pedido p/ 'pago'.
--
--  ⚠️ ORDEM DE APLICAÇÃO (zero downtime):
--    1) Rode a PARTE 1 (a RPC) agora.
--    2) git push + espere o deploy da Vercel (front passa a chamar a RPC).
--    3) Rode a PARTE 2 (a RLS) depois do deploy.
--  (Assim nenhum pagamento com crédito quebra no meio da troca.)
-- ===========================================================================


-- ========================= PARTE 1 — rode AGORA ============================
-- RPC que paga com créditos: total calculado no servidor, débito + pedido pago
-- atômicos, com trava de linha (sem corrida / duplo gasto).
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
  v_uid    uuid := auth.uid();
  v_total  numeric(12,2);
  v_saldo  numeric(12,2);
  v_pedido uuid;
begin
  if v_uid is null then
    raise exception 'nao autenticado';
  end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'itens invalidos';
  end if;

  -- Total no SERVIDOR a partir dos itens (qty * price). O débito é SEMPRE igual
  -- ao valor do pedido — não dá pra "pagar menos" nem criar pedido pago de graça.
  select coalesce(sum( (it->>'qty')::numeric * (it->>'price')::numeric ), 0)
    into v_total
    from jsonb_array_elements(p_itens) as it;

  if v_total is null or v_total <= 0 then
    raise exception 'total invalido';
  end if;

  -- Trava a linha do perfil e confere o saldo.
  select creditos_nao_sacaveis into v_saldo
    from public.profiles where id = v_uid for update;

  if v_saldo is null or v_saldo < v_total then
    raise exception 'saldo insuficiente';
  end if;

  -- Debita o crédito e cria o pedido pago — na MESMA transação.
  update public.profiles
     set creditos_nao_sacaveis = creditos_nao_sacaveis - v_total
   where id = v_uid;

  insert into public.pedidos (user_id, total, status, itens, metodo, utm, visitor_id, pagador)
  values (v_uid, v_total, 'pago', p_itens, coalesce(nullif(p_metodo, ''), 'creditos'),
          coalesce(p_utm, '{}'::jsonb), p_visitor_id, coalesce(p_pagador, '{}'::jsonb))
  returning id into v_pedido;

  return v_pedido;
end;
$$;

grant execute on function public.pagar_com_creditos(jsonb, text, jsonb, text, jsonb) to authenticated;


-- ===================== PARTE 2 — rode DEPOIS do deploy =====================
-- Tira o "for all" antigo e dá ao cliente só o necessário: ler os próprios
-- pedidos, criar pedido PENDENTE (Pix/depósito) e apagar pedido PENDENTE
-- (limpeza do Pix que não gerou). Status 'pago' passa a ser EXCLUSIVO do
-- servidor: webhook das gates (service_role) ou a RPC acima (security definer).
drop policy if exists "pedidos_proprios" on public.pedidos;

create policy "pedidos_select_proprio" on public.pedidos
  for select using (auth.uid() = user_id);

create policy "pedidos_insert_pendente" on public.pedidos
  for insert with check (auth.uid() = user_id and status = 'pendente');

create policy "pedidos_delete_pendente" on public.pedidos
  for delete using (auth.uid() = user_id and status = 'pendente');

-- (Sem policy de UPDATE para o cliente — ele não muda mais status de pedido.
--  Admin continua pela "admin_atualiza_pedidos"; as gates pelo service_role.)


-- ===========================================================================
-- >>> ARQUIVO: email_cadastro_sem_sintetico.sql
-- ===========================================================================

-- ===========================================================================
--  E-MAIL DO CADASTRO — não gravar o e-mail SINTÉTICO no perfil da pessoa
--  ---------------------------------------------------------------------------
--  O login por CPF cria a conta no Supabase Auth com um e-mail SINTÉTICO
--  ({cpf}@cpf.vivasorte.app) só pra autenticar — NÃO é o e-mail da pessoa. O
--  trigger copiava esse e-mail pro profiles.email, e aí ele aparecia no /admin
--  como se fosse real. Passa a gravar SÓ e-mail REAL; sem e-mail real, o campo
--  fica NULL (vazio no /admin e no perfil). A pessoa pode preencher o e-mail
--  dela em "Meus dados". NÃO afeta login (autentica pelo auth.users) nem
--  pagamento (os gateways têm e-mail de fallback próprio).
--  ⚠️ Se mudar AUTH_CPF_EMAIL_DOMAIN, ajuste o domínio nos dois LIKE abaixo.
--  Rode TUDO no SQL Editor do Supabase.
-- ===========================================================================

-- 1) Trigger: mantém validação de CPF + origem, mas grava e-mail REAL ou NULL --
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.cpf_e_valido(new.raw_user_meta_data->>'cpf') then
    raise exception 'CPF invalido';
  end if;
  insert into public.profiles (id, cpf, email, nome, telefone, origem)
  values (
    new.id,
    new.raw_user_meta_data->>'cpf',
    case when new.email like '%@cpf.vivasorte.app' then null else new.email end,
    new.raw_user_meta_data->>'nome',
    new.raw_user_meta_data->>'telefone',
    new.raw_user_meta_data->>'origem'
  );
  return new;
end;
$$;

-- 2) Backfill: limpa os e-mails sintéticos já gravados em contas existentes -----
--    (se quiser conferir antes:  select count(*) from public.profiles
--       where email like '%@cpf.vivasorte.app';)
update public.profiles
set email = null
where email like '%@cpf.vivasorte.app';


-- ===========================================================================
-- >>> ARQUIVO: whatsapp_cobranca_setup.sql
-- ===========================================================================

-- Lembrete manual de Pix pelo WhatsApp.
-- Execute uma vez no SQL Editor do Supabase antes de publicar o front novo.

begin;

-- Pré-requisito de segurança para qualquer operação financeira/admin: garante
-- que um usuário comum não consiga promover a própria conta nem fabricar saldo.
create or replace function public.protege_profile_sensiveis()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.is_admin() then return new; end if;
  if new.is_admin is distinct from old.is_admin then
    raise exception 'permissao negada: alterar is_admin';
  end if;
  if new.cpf is distinct from old.cpf then
    raise exception 'permissao negada: alterar cpf';
  end if;
  if coalesce(new.creditos_nao_sacaveis, 0) > coalesce(old.creditos_nao_sacaveis, 0)
     or coalesce(new.saldo_saque, 0) > coalesce(old.saldo_saque, 0)
     or coalesce(new.total_sacado, 0) > coalesce(old.total_sacado, 0)
     or coalesce(new.pontos, 0) > coalesce(old.pontos, 0) then
    raise exception 'permissao negada: aumentar saldo/creditos/pontos';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protege_profile on public.profiles;
create trigger trg_protege_profile
  before update on public.profiles
  for each row execute function public.protege_profile_sensiveis();
revoke update (is_admin) on public.profiles from anon, authenticated;

alter table public.pedidos
  add column if not exists pix_copia_cola text,
  add column if not exists pix_gerado_at timestamptz,
  add column if not exists pix_expira_em timestamptz,
  add column if not exists whatsapp_optin boolean,
  add column if not exists whatsapp_optin_at timestamptz,
  add column if not exists whatsapp_optin_versao text,
  add column if not exists whatsapp_optin_telefone text,
  add column if not exists whatsapp_lembrete_at timestamptz,
  add column if not exists whatsapp_lembrete_status text,
  add column if not exists whatsapp_lembrete_admin_id uuid,
  add column if not exists whatsapp_lembrete_atendimento text,
  add column if not exists whatsapp_lembrete_destino text,
  add column if not exists whatsapp_lembrete_modelo text;

-- Campo de opt-in fica apenas como legado de versoes anteriores. O fluxo atual
-- e interno: todos os pedidos sao considerados elegiveis, sem aceite no checkout.
update public.pedidos set whatsapp_optin = true where whatsapp_optin is distinct from true;
update public.pedidos
set pagador = jsonb_set(coalesce(pagador, '{}'::jsonb), '{whatsapp_optin}', 'true'::jsonb, true)
where coalesce(pagador ->> 'whatsapp_optin', '') is distinct from 'true';
alter table public.pedidos alter column whatsapp_optin set default true;
alter table public.pedidos alter column whatsapp_optin set not null;

comment on column public.pedidos.whatsapp_optin is
  'Campo legado; todos os pedidos sao considerados consentidos para o lembrete interno.';
comment on column public.pedidos.whatsapp_optin_telefone is
  'Campo legado mantido apenas para compatibilidade com pedidos antigos.';
comment on column public.pedidos.whatsapp_lembrete_status is
  'No modo manual, preparado significa que o admin reservou/abriu o fluxo; não confirma envio.';

create index if not exists pedidos_whatsapp_cobranca_idx
  on public.pedidos (pix_expira_em)
  where status = 'pendente'
    and whatsapp_lembrete_at is null
    and metodo is distinct from 'deposito';

-- Cada cobrança criada fica vinculada de forma imutável ao pedido, gateway e valor.
-- Assim uma charge antiga não pode aprovar outro pedido e o pagamento continua
-- reconhecível mesmo quando o cliente gera um novo Pix pelo rodízio.
create table if not exists public.pix_tentativas (
  id              uuid primary key default gen_random_uuid(),
  pedido_id       uuid not null references public.pedidos(id) on delete cascade,
  gateway         text not null,
  order_id        text,
  charge_id       text not null,
  valor_centavos  bigint not null check (valor_centavos > 0),
  pix_copia_cola  text,
  pix_expira_em   timestamptz,
  created_at      timestamptz not null default now(),
  unique (gateway, charge_id)
);

create index if not exists pix_tentativas_pedido_idx
  on public.pix_tentativas (pedido_id, created_at desc);

-- Não fazemos backfill automático de cobranças antigas: antes do lockdown de
-- RLS esses campos podiam ter vindo do navegador. Pedidos pendentes antigos devem
-- gerar um novo Pix para ganhar um vínculo server-side verificável.

create or replace function public.bloquear_update_pix_tentativas()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'o vinculo de uma tentativa Pix e imutavel';
end;
$$;

drop trigger if exists pix_tentativas_sem_update on public.pix_tentativas;
create trigger pix_tentativas_sem_update
before update on public.pix_tentativas
for each row execute function public.bloquear_update_pix_tentativas();

revoke execute on function public.bloquear_update_pix_tentativas() from public;

alter table public.pix_tentativas enable row level security;
revoke insert, update, delete on table public.pix_tentativas from anon, authenticated;
grant select on table public.pix_tentativas to authenticated;
drop policy if exists "pix_tentativas_admin_select" on public.pix_tentativas;
create policy "pix_tentativas_admin_select" on public.pix_tentativas
  for select using (public.is_admin());

comment on table public.pix_tentativas is
  'Vínculo server-side entre cada cobrança Pix e seu pedido; clientes não podem inserir ou alterar.';

create or replace function public.pedido_sem_tentativa_pix(p_pedido uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.pedidos p
    where p.id = p_pedido
      and p.user_id = auth.uid()
  ) and not exists (
    select 1 from public.pix_tentativas t where t.pedido_id = p_pedido
  );
$$;

revoke all on function public.pedido_sem_tentativa_pix(uuid) from public;
grant execute on function public.pedido_sem_tentativa_pix(uuid) to authenticated;

insert into public.configuracoes (chave, valor) values
  ('whatsapp_cobranca_ativo', 'true')
on conflict (chave) do update set valor = excluded.valor;

insert into public.configuracoes (chave, valor) values
  ('whatsapp_cobranca_numero', ''),
  ('whatsapp_cobranca_espera_minutos', '5'),
  ('whatsapp_cobranca_mensagem', $$Olá, {{nome}}! Tudo bem?

Vimos que você gerou o Pix do pedido #{{pedido}}, no valor de {{valor}}, mas o pagamento ainda não foi confirmado.

Se ainda tiver interesse, é só realizar o pagamento para confirmar sua participação. Vou te enviar o código Pix na próxima mensagem.

Esse Pix é válido até {{expiracao}}. Se você já pagou, desconsidere esta mensagem. Se precisar de ajuda, responda por aqui.$$)
on conflict (chave) do nothing;

-- Volta automaticamente o template promocional para a mensagem curta.
update public.configuracoes
set valor = $$Olá, {{nome}}! Tudo bem?

Vimos que você gerou o Pix do pedido #{{pedido}}, no valor de {{valor}}, mas o pagamento ainda não foi confirmado.

Se ainda tiver interesse, é só realizar o pagamento para confirmar sua participação. Vou te enviar o código Pix na próxima mensagem.

Esse Pix é válido até {{expiracao}}. Se você já pagou, desconsidere esta mensagem. Se precisar de ajuda, responda por aqui.$$
where chave = 'whatsapp_cobranca_mensagem'
  and (lower(valor) like '%renato%' or lower(valor) like '%viva sorte+%');

-- Reserva atomica: duas abas/admins nao conseguem preparar o mesmo lembrete.
-- O retorno traz os dados canonicos vindos do banco; a tela apenas abre o WhatsApp.
create or replace function public.whatsapp_normalizar_br(p_numero text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_digits text := regexp_replace(coalesce(p_numero, ''), '[^0-9]', '', 'g');
begin
  if left(v_digits, 2) = '00' then
    v_digits := substring(v_digits from 3);
  end if;

  if left(v_digits, 2) = '55' and length(v_digits) in (12, 13) then
    v_digits := substring(v_digits from 3);
  end if;

  if length(v_digits) in (10, 11) and v_digits ~ '^[1-9][0-9]{9,10}$' then
    return '55' || v_digits;
  end if;

  return '';
end;
$$;

revoke all on function public.whatsapp_normalizar_br(text) from public;

drop function if exists public.preparar_lembrete_whatsapp(uuid);
drop function if exists public.preparar_lembrete_whatsapp(uuid, boolean);
create or replace function public.preparar_lembrete_whatsapp(
  p_pedido uuid,
  p_ignorar_espera boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pedido public.pedidos%rowtype;
  v_agora timestamptz := clock_timestamp();
  v_espera integer := 5;
  v_valor_espera text;
  v_ativo text;
  v_modelo text;
  v_numero_atendimento text;
  v_numero_atendimento_norm text;
  v_nome text;
  v_telefone_perfil text;
  v_destino text;
  v_pix_copia_cola text;
  v_pix_expira_em timestamptz;
  v_pix_gerado_at timestamptz;
  v_lembrete_at timestamptz;
  v_nova_reserva boolean := false;
  v_admin uuid := auth.uid();
begin
  if not public.is_admin() then
    raise exception 'apenas admin';
  end if;

  v_ativo := coalesce((select valor from public.configuracoes where chave = 'whatsapp_cobranca_ativo'), 'false');
  if lower(trim(v_ativo)) <> 'true' then
    return jsonb_build_object('ok', false, 'motivo', 'O lembrete esta desativado nas Configuracoes.');
  end if;

  select * into v_pedido
  from public.pedidos
  where id = p_pedido
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'Pedido nao encontrado.');
  end if;

  select coalesce(nullif(nome_social, ''), nome, ''), telefone
  into v_nome, v_telefone_perfil
  from public.profiles
  where id = v_pedido.user_id;

  if v_telefone_perfil is null then
    return jsonb_build_object('ok', false, 'motivo', 'Cliente sem telefone no perfil.');
  end if;


  v_destino := public.whatsapp_normalizar_br(v_telefone_perfil);
  v_numero_atendimento := coalesce((select valor from public.configuracoes where chave = 'whatsapp_cobranca_numero'), '');
  v_numero_atendimento_norm := public.whatsapp_normalizar_br(v_numero_atendimento);
  v_modelo := coalesce(nullif((select valor from public.configuracoes where chave = 'whatsapp_cobranca_mensagem'), ''), 'Olá, {{nome}}! Tudo bem? Vimos que você gerou o Pix do pedido #{{pedido}}, mas ainda não finalizou. Vou enviar o código Pix na próxima mensagem.');
  v_pix_copia_cola := coalesce(nullif(trim(v_pedido.pix_copia_cola), ''), nullif(trim(v_pedido.pagador ->> 'pix_copia_cola'), ''));
  begin
    v_pix_expira_em := coalesce(v_pedido.pix_expira_em, nullif(v_pedido.pagador ->> 'pix_expira_em', '')::timestamptz);
  exception when others then
    v_pix_expira_em := v_pedido.pix_expira_em;
  end;
  begin
    v_pix_gerado_at := coalesce(v_pedido.pix_gerado_at, nullif(v_pedido.pagador ->> 'pix_gerado_at', '')::timestamptz);
  exception when others then
    v_pix_gerado_at := v_pedido.pix_gerado_at;
  end;

  if v_pedido.status <> 'pendente' then
    return jsonb_build_object('ok', false, 'motivo', 'O pedido nao esta mais pendente.');
  end if;
  if v_pedido.metodo = 'deposito' then
    return jsonb_build_object('ok', false, 'motivo', 'Depositos nao recebem este lembrete.');
  end if;
  if v_destino = '' then
    return jsonb_build_object('ok', false, 'motivo', 'O cliente nao possui um celular brasileiro valido.');
  end if;
  if coalesce(trim(v_pix_copia_cola), '') = '' then
    return jsonb_build_object('ok', false, 'motivo', 'Este pedido nao possui um Pix salvo.');
  end if;
  if v_pix_expira_em is null or v_pix_expira_em <= v_agora then
    return jsonb_build_object('ok', false, 'motivo', 'O Pix deste pedido ja expirou.');
  end if;
  if v_pix_expira_em <= v_agora + interval '3 minutes' then
    return jsonb_build_object('ok', false, 'motivo', 'Faltam menos de 3 minutos para este Pix expirar; gere um novo codigo antes do lembrete.');
  end if;

  select valor into v_valor_espera
  from public.configuracoes
  where chave = 'whatsapp_cobranca_espera_minutos';
  if coalesce(v_valor_espera, '') ~ '^[0-9]+$' then
    v_espera := least(120, greatest(0, v_valor_espera::integer));
  end if;
  if not coalesce(p_ignorar_espera, false)
     and coalesce(v_pix_gerado_at, v_pedido.created_at) + make_interval(mins => v_espera) > v_agora then
    return jsonb_build_object('ok', false, 'motivo', 'Aguarde o tempo minimo configurado antes do lembrete.');
  end if;

  if v_pedido.whatsapp_lembrete_at is null then
    update public.pedidos
    set whatsapp_lembrete_at = v_agora,
        whatsapp_lembrete_status = 'preparado',
        whatsapp_lembrete_admin_id = v_admin,
        whatsapp_lembrete_atendimento = v_numero_atendimento_norm,
        whatsapp_lembrete_destino = v_destino,
        whatsapp_lembrete_modelo = v_modelo
    where id = p_pedido
    returning whatsapp_lembrete_at into v_lembrete_at;
    v_nova_reserva := true;
  else
    v_lembrete_at := v_pedido.whatsapp_lembrete_at;
  end if;

  return jsonb_build_object(
    'ok', true,
    'motivo', '',
    'lembrete_at', v_lembrete_at,
    'nova_reserva', v_nova_reserva,
    'destino', coalesce(v_pedido.whatsapp_lembrete_destino, v_destino),
    'numero_atendimento', coalesce(v_pedido.whatsapp_lembrete_atendimento, v_numero_atendimento_norm),
    'pix_copia_cola', v_pix_copia_cola,
    'pix_expira_em', v_pix_expira_em,
    'nome', v_nome,
    'total', v_pedido.total,
    'mensagem_modelo', coalesce(v_pedido.whatsapp_lembrete_modelo, v_modelo)
  );
end;
$$;

revoke all on function public.preparar_lembrete_whatsapp(uuid, boolean) from public;
grant execute on function public.preparar_lembrete_whatsapp(uuid, boolean) to authenticated;
commit;


-- ===========================================================================
-- >>> ARQUIVO: confirmado_por_setup.sql
-- ===========================================================================

-- Coluna que registra QUEM confirmou o pagamento: 'webhook' (o gateway avisou)
-- ou 'polling' (a pagina do comprador perguntou). Sem ela, uma consulta simples
-- nao detecta webhook quebrado ate um cliente reclamar que pagou e nao recebeu.
--
-- Rode isto em TODO Supabase novo do projeto — nao e opcional. Ja aconteceu uma
-- vez desta coluna faltar (criada so por SQL avulso, nunca versionada) e o
-- UPDATE de confirmacao de pagamento falhar silenciosamente: 3 vendas pagas na
-- CinqPay ficaram presas em "pendente" no banco ate alguem notar.

alter table public.pedidos add column if not exists confirmado_por text;

comment on column public.pedidos.confirmado_por is
  'Quem confirmou o pagamento: webhook (o gateway avisou) ou polling (a pagina do comprador perguntou). Serve para detectar webhook quebrado antes de perder venda.';


-- ===========================================================================
-- >>> ARQUIVO: checkout_creditos_catalogo.sql
-- ===========================================================================

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


-- ===========================================================================
-- >>> ARQUIVO: whatsapp_cobranca_todos_consentidos.sql
-- ===========================================================================

-- Marca o campo legado de opt-in do WhatsApp como verdadeiro para todos os pedidos.
-- O lembrete e um fluxo interno do admin e nao depende de aceite no checkout.

begin;

alter table public.pedidos
  add column if not exists whatsapp_optin boolean;

update public.pedidos
set whatsapp_optin = true
where whatsapp_optin is distinct from true;

update public.pedidos
set pagador = jsonb_set(coalesce(pagador, '{}'::jsonb), '{whatsapp_optin}', 'true'::jsonb, true)
where coalesce(pagador ->> 'whatsapp_optin', '') is distinct from 'true';

alter table public.pedidos alter column whatsapp_optin set default true;
alter table public.pedidos alter column whatsapp_optin set not null;

comment on column public.pedidos.whatsapp_optin is
  'Campo legado; todos os pedidos sao considerados consentidos para o lembrete interno.';

commit;


-- ===========================================================================
-- >>> ARQUIVO: remover_imagens_pedidos.sql
-- ===========================================================================

-- Remove imagens ja gravadas dentro do JSON de itens dos pedidos.
-- Execute uma vez no SQL Editor do Supabase.

begin;

update public.pedidos p
set itens = coalesce((
  select jsonb_agg(item - 'image' order by ord)
  from jsonb_array_elements(p.itens) with ordinality as e(item, ord)
), '[]'::jsonb)
where jsonb_typeof(p.itens) = 'array'
  and exists (
    select 1
    from jsonb_array_elements(p.itens) as e(item)
    where e.item ? 'image'
  );

commit;


-- ===========================================================================
-- FICHAS EM LOTES (ligador vê no máx. 10 "a ligar") + PEDIDOS DE MAIS FICHAS
-- ===========================================================================

alter table public.pedidos  add column if not exists ligador_liberado_at timestamptz;
alter table public.profiles add column if not exists ligador_liberado_at timestamptz;

create table if not exists public.solicitacoes_fichas (
  id            uuid primary key default gen_random_uuid(),
  ligador_id    uuid not null references public.ligadores(id) on delete cascade,
  status        text not null default 'pendente', -- pendente | concedida | recusada
  quantidade    int,
  created_at    timestamptz not null default now(),
  respondida_at timestamptz
);
alter table public.solicitacoes_fichas enable row level security;
-- Sem policies: acesso só pelas funções abaixo.
create index if not exists solicitacoes_fichas_pend_idx on public.solicitacoes_fichas (status, created_at);

-- Fichas liberadas ainda "a ligar" (o lote atual do ligador).
create or replace function public._fichas_pendentes(p_lig uuid)
returns int language sql stable security definer set search_path = public as $$
  select (
    (select count(*) from public.pedidos p
      where p.ligador_id = p_lig and p.ligador_liberado_at is not null and coalesce(p.ligador_status, 'a_ligar') = 'a_ligar')
  + (select count(*) from public.profiles pr
      where pr.ligador_id = p_lig and pr.ligador_liberado_at is not null and coalesce(pr.ligador_status, 'a_ligar') = 'a_ligar')
  )::int;
$$;

-- Fichas atribuídas mas ainda NÃO liberadas (a fila do ligador).
create or replace function public._fichas_na_fila(p_lig uuid)
returns int language sql stable security definer set search_path = public as $$
  select (
    (select count(*) from public.pedidos p  where p.ligador_id = p_lig and p.ligador_liberado_at is null)
  + (select count(*) from public.profiles pr where pr.ligador_id = p_lig and pr.ligador_liberado_at is null)
  )::int;
$$;

-- Libera as N fichas mais antigas da fila (pedidos e cadastros juntos). Devolve quantas.
create or replace function public._liberar_fichas(p_lig uuid, p_qtd int)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int := 0; r record;
begin
  for r in
    select 'p' as t, p.id, p.created_at from public.pedidos p
     where p.ligador_id = p_lig and p.ligador_liberado_at is null
    union all
    select 'c' as t, pr.id, pr.created_at from public.profiles pr
     where pr.ligador_id = p_lig and pr.ligador_liberado_at is null
    order by created_at asc
    limit greatest(coalesce(p_qtd, 0), 0)
  loop
    if r.t = 'p' then update public.pedidos  set ligador_liberado_at = now() where id = r.id;
    else              update public.profiles set ligador_liberado_at = now() where id = r.id; end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end; $$;

revoke execute on function public._fichas_pendentes(uuid)      from public, anon, authenticated;
revoke execute on function public._fichas_na_fila(uuid)        from public, anon, authenticated;
revoke execute on function public._liberar_fichas(uuid, int)   from public, anon, authenticated;

-- Migração das fichas que já existiam: o que o ligador já trabalhou continua
-- visível; das que estão "a ligar", libera até completar 10 por ligador.
update public.pedidos  set ligador_liberado_at = coalesce(ligador_at, now())
 where ligador_id is not null and ligador_liberado_at is null and coalesce(ligador_status, 'a_ligar') <> 'a_ligar';
update public.profiles set ligador_liberado_at = coalesce(ligador_at, now())
 where ligador_id is not null and ligador_liberado_at is null and coalesce(ligador_status, 'a_ligar') <> 'a_ligar';
select public._liberar_fichas(l.id, 10 - public._fichas_pendentes(l.id)) from public.ligadores l;

-- O ligador só enxerga (e só responde) fichas LIBERADAS.
create or replace function public.ligador_pedidos(p_token uuid)
returns setof public.pedidos
language plpgsql security definer set search_path = public as $$
declare v_lig uuid;
begin
  select l.id into v_lig from public.ligadores l where l.token = p_token and l.ativo = true;
  if v_lig is null then return; end if;
  return query select * from public.pedidos p
   where p.ligador_id = v_lig and p.ligador_liberado_at is not null
   order by p.created_at desc;
end; $$;
grant execute on function public.ligador_pedidos(uuid) to anon, authenticated;

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
    order by pr.created_at desc;
end; $$;
grant execute on function public.ligador_cadastros(uuid) to anon, authenticated;

create or replace function public.ligador_responder(p_token uuid, p_pedido uuid, p_status text, p_obs text)
returns void language plpgsql security definer set search_path = public as $$
declare v_lig uuid;
begin
  select l.id into v_lig from public.ligadores l where l.token = p_token and l.ativo = true;
  if v_lig is null then raise exception 'token invalido'; end if;
  if p_status not in ('a_ligar', 'bom', 'ruim', 'retorno') then raise exception 'status invalido'; end if;
  update public.pedidos set ligador_status = p_status, ligador_obs = p_obs, ligador_at = now()
   where id = p_pedido and ligador_id = v_lig and ligador_liberado_at is not null;
end; $$;
grant execute on function public.ligador_responder(uuid, uuid, text, text) to anon, authenticated;

create or replace function public.ligador_responder_cadastro(p_token uuid, p_perfil uuid, p_status text, p_obs text)
returns void language plpgsql security definer set search_path = public as $$
declare v_lig uuid;
begin
  select l.id into v_lig from public.ligadores l where l.token = p_token and l.ativo = true;
  if v_lig is null then raise exception 'token invalido'; end if;
  if p_status not in ('a_ligar', 'bom', 'ruim', 'retorno') then raise exception 'status invalido'; end if;
  update public.profiles set ligador_status = p_status, ligador_obs = p_obs, ligador_at = now()
   where id = p_perfil and ligador_id = v_lig and ligador_liberado_at is not null;
end; $$;
grant execute on function public.ligador_responder_cadastro(uuid, uuid, text, text) to anon, authenticated;

-- Situação do lote do ligador (pra tela dele).
drop function if exists public.ligador_situacao_fichas(uuid);
create or replace function public.ligador_situacao_fichas(p_token uuid)
returns table(pendentes int, na_fila int, solicitacao_pendente boolean)
language plpgsql security definer set search_path = public as $$
declare v_lig uuid;
begin
  select l.id into v_lig from public.ligadores l where l.token = p_token and l.ativo = true;
  if v_lig is null then return; end if;
  return query select public._fichas_pendentes(v_lig), public._fichas_na_fila(v_lig),
    exists(select 1 from public.solicitacoes_fichas s where s.ligador_id = v_lig and s.status = 'pendente');
end; $$;
grant execute on function public.ligador_situacao_fichas(uuid) to anon, authenticated;

-- Ligador pede mais fichas — só quando terminou o lote atual. Não duplica pedido pendente.
create or replace function public.ligador_solicitar_fichas(p_token uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_lig uuid;
begin
  select l.id into v_lig from public.ligadores l where l.token = p_token and l.ativo = true;
  if v_lig is null then raise exception 'token invalido'; end if;
  if public._fichas_pendentes(v_lig) > 0 then raise exception 'Termine as fichas atuais antes de pedir mais.'; end if;
  if exists(select 1 from public.solicitacoes_fichas s where s.ligador_id = v_lig and s.status = 'pendente') then return; end if;
  insert into public.solicitacoes_fichas (ligador_id) values (v_lig);
end; $$;
grant execute on function public.ligador_solicitar_fichas(uuid) to anon, authenticated;

-- ADMIN: pedidos de fichas pendentes (aba Notificações).
drop function if exists public.listar_solicitacoes_fichas();
create or replace function public.listar_solicitacoes_fichas()
returns table(id uuid, ligador_id uuid, ligador_nome text, created_at timestamptz, na_fila int, pendentes int)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return; end if;
  return query
    select s.id, s.ligador_id, coalesce(l.nome, l.usuario), s.created_at,
           public._fichas_na_fila(s.ligador_id), public._fichas_pendentes(s.ligador_id)
    from public.solicitacoes_fichas s join public.ligadores l on l.id = s.ligador_id
    where s.status = 'pendente'
    order by s.created_at asc;
end; $$;
grant execute on function public.listar_solicitacoes_fichas() to authenticated;

-- ADMIN: concede até 10 fichas da fila do ligador. Devolve quantas foram liberadas.
create or replace function public.conceder_fichas(p_solicitacao uuid, p_qtd int)
returns int language plpgsql security definer set search_path = public as $$
declare v_lig uuid; v_n int;
begin
  if not public.is_admin() then raise exception 'apenas admin'; end if;
  select s.ligador_id into v_lig from public.solicitacoes_fichas s where s.id = p_solicitacao and s.status = 'pendente';
  if v_lig is null then raise exception 'solicitacao nao encontrada'; end if;
  v_n := public._liberar_fichas(v_lig, least(greatest(coalesce(p_qtd, 0), 0), 10 - public._fichas_pendentes(v_lig)));
  update public.solicitacoes_fichas set status = 'concedida', quantidade = v_n, respondida_at = now() where id = p_solicitacao;
  return v_n;
end; $$;
grant execute on function public.conceder_fichas(uuid, int) to authenticated;

create or replace function public.recusar_solicitacao_fichas(p_solicitacao uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'apenas admin'; end if;
  update public.solicitacoes_fichas set status = 'recusada', respondida_at = now()
   where id = p_solicitacao and status = 'pendente';
end; $$;
grant execute on function public.recusar_solicitacao_fichas(uuid) to authenticated;

-- Remover ligador também limpa a liberação das fichas devolvidas ao fluxo.
create or replace function public.remover_ligador(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'apenas admin'; end if;
  update public.pedidos set ligador_id = null, ligador_status = null, ligador_obs = null, ligador_at = null, ligador_liberado_at = null
   where ligador_id = p_id;
  update public.profiles set ligador_id = null, ligador_status = null, ligador_obs = null, ligador_at = null, ligador_liberado_at = null
   where ligador_id = p_id;
  delete from public.ligadores where id = p_id;
end; $$;
grant execute on function public.remover_ligador(uuid) to authenticated;


-- ===========================================================================
-- GERENTES — ficam entre o admin e os ligadores.
--  * Login próprio (usuário + senha, pgcrypto), igual ao ligador; acessa por TOKEN.
--  * Admin envia fichas (pedidos/cadastros) pro gerente: gerente_id preenchido e
--    ligador_id vazio = "estoque" do gerente.
--  * Ligador com gerente pede fichas ao gerente; o gerente libera primeiro da fila
--    do próprio ligador e completa com o estoque dele (máx. 10 "a ligar" por vez).
--  * Estoque acabou → gerente pede mais ao admin (aba Notificações).
-- Rode isto UMA vez no Supabase (SQL Editor). Pode rodar de novo sem problema.
-- Requer schema.sql + fichas_liberadas_setup.sql já aplicados.
-- ===========================================================================
create extension if not exists pgcrypto;

create table if not exists public.gerentes (
  id         uuid primary key default gen_random_uuid(),
  usuario    text unique not null,
  senha_hash text not null,
  nome       text,
  token      uuid not null default gen_random_uuid(),
  ativo      boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.gerentes enable row level security;
-- Sem policies: acesso só via funções SECURITY DEFINER.

alter table public.ligadores add column if not exists gerente_id uuid references public.gerentes(id) on delete set null;
alter table public.pedidos   add column if not exists gerente_id uuid references public.gerentes(id) on delete set null;
alter table public.profiles  add column if not exists gerente_id uuid references public.gerentes(id) on delete set null;
-- Pedido de fichas do ligador vai pro gerente dele (null = vai pro admin).
alter table public.solicitacoes_fichas add column if not exists gerente_id uuid references public.gerentes(id) on delete set null;
create index if not exists ligadores_gerente_idx on public.ligadores (gerente_id);
create index if not exists pedidos_gerente_idx   on public.pedidos (gerente_id) where ligador_id is null;
create index if not exists profiles_gerente_idx  on public.profiles (gerente_id) where ligador_id is null;

create table if not exists public.solicitacoes_gerente (
  id            uuid primary key default gen_random_uuid(),
  gerente_id    uuid not null references public.gerentes(id) on delete cascade,
  status        text not null default 'pendente', -- pendente | atendida | recusada
  quantidade    int,
  created_at    timestamptz not null default now(),
  respondida_at timestamptz
);
alter table public.solicitacoes_gerente enable row level security;
create index if not exists solicitacoes_gerente_pend_idx on public.solicitacoes_gerente (status, created_at);

-- ---- helpers internos ------------------------------------------------------
create or replace function public._gerente_do_token(p_token uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select g.id from public.gerentes g where g.token = p_token and g.ativo = true;
$$;

-- Estoque do gerente: fichas dele que ainda não foram pra nenhum ligador.
create or replace function public._estoque_gerente(p_ger uuid)
returns int language sql stable security definer set search_path = public as $$
  select (
    (select count(*) from public.pedidos p  where p.gerente_id = p_ger and p.ligador_id is null)
  + (select count(*) from public.profiles pr where pr.gerente_id = p_ger and pr.ligador_id is null)
  )::int;
$$;

-- Passa as N fichas mais antigas do estoque pro ligador, já liberadas.
create or replace function public._estoque_para_ligador(p_ger uuid, p_lig uuid, p_qtd int)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int := 0; r record;
begin
  for r in
    select 'p' as t, p.id, p.created_at from public.pedidos p
     where p.gerente_id = p_ger and p.ligador_id is null
    union all
    select 'c' as t, pr.id, pr.created_at from public.profiles pr
     where pr.gerente_id = p_ger and pr.ligador_id is null
    order by created_at asc
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

revoke execute on function public._gerente_do_token(uuid)                 from public, anon, authenticated;
revoke execute on function public._estoque_gerente(uuid)                  from public, anon, authenticated;
revoke execute on function public._estoque_para_ligador(uuid, uuid, int)  from public, anon, authenticated;

-- ---- ADMIN -----------------------------------------------------------------
create or replace function public.criar_gerente(p_usuario text, p_senha text, p_nome text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'apenas admin'; end if;
  if coalesce(trim(p_usuario), '') = '' or coalesce(p_senha, '') = '' then raise exception 'usuario e senha obrigatorios'; end if;
  insert into public.gerentes (usuario, senha_hash, nome)
  values (lower(trim(p_usuario)), crypt(p_senha, gen_salt('bf')), nullif(trim(p_nome), ''))
  returning id into v_id;
  return v_id;
end; $$;
grant execute on function public.criar_gerente(text, text, text) to authenticated;

drop function if exists public.listar_gerentes();
create or replace function public.listar_gerentes()
returns table(id uuid, usuario text, nome text, ativo boolean, created_at timestamptz,
              estoque int, qtd_ligadores bigint)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return; end if;
  return query
    select g.id, g.usuario, g.nome, g.ativo, g.created_at, public._estoque_gerente(g.id),
           (select count(*) from public.ligadores l where l.gerente_id = g.id)
    from public.gerentes g order by g.created_at desc;
end; $$;
grant execute on function public.listar_gerentes() to authenticated;

-- Remove o gerente: o estoque dele volta pro admin; ligadores ficam sem gerente.
create or replace function public.remover_gerente(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'apenas admin'; end if;
  update public.pedidos  set gerente_id = null where gerente_id = p_id;
  update public.profiles set gerente_id = null where gerente_id = p_id;
  delete from public.gerentes where id = p_id;
end; $$;
grant execute on function public.remover_gerente(uuid) to authenticated;

create or replace function public.definir_gerente_ligador(p_ligador uuid, p_gerente uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'apenas admin'; end if;
  update public.ligadores set gerente_id = p_gerente where id = p_ligador;
  -- pedido de fichas em aberto acompanha a troca de gerente
  update public.solicitacoes_fichas set gerente_id = p_gerente where ligador_id = p_ligador and status = 'pendente';
end; $$;
grant execute on function public.definir_gerente_ligador(uuid, uuid) to authenticated;

-- listar_ligadores ganha a coluna gerente_id (DROP: muda as colunas de retorno).
drop function if exists public.listar_ligadores();
create or replace function public.listar_ligadores()
returns table(id uuid, usuario text, nome text, ativo boolean, created_at timestamptz,
              total bigint, a_ligar bigint, retorno bigint, bom bigint, ruim bigint, gerente_id uuid)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return; end if;
  return query
    select l.id, l.usuario, l.nome, l.ativo, l.created_at,
      ((select count(*) from public.pedidos p where p.ligador_id = l.id)
        + (select count(*) from public.profiles pr where pr.ligador_id = l.id))::bigint,
      ((select count(*) from public.pedidos p where p.ligador_id = l.id and p.ligador_status = 'a_ligar')
        + (select count(*) from public.profiles pr where pr.ligador_id = l.id and pr.ligador_status = 'a_ligar'))::bigint,
      ((select count(*) from public.pedidos p where p.ligador_id = l.id and p.ligador_status = 'retorno')
        + (select count(*) from public.profiles pr where pr.ligador_id = l.id and pr.ligador_status = 'retorno'))::bigint,
      ((select count(*) from public.pedidos p where p.ligador_id = l.id and p.ligador_status = 'bom')
        + (select count(*) from public.profiles pr where pr.ligador_id = l.id and pr.ligador_status = 'bom'))::bigint,
      ((select count(*) from public.pedidos p where p.ligador_id = l.id and p.ligador_status = 'ruim')
        + (select count(*) from public.profiles pr where pr.ligador_id = l.id and pr.ligador_status = 'ruim'))::bigint,
      l.gerente_id
    from public.ligadores l
    order by l.created_at desc;
end; $$;
grant execute on function public.listar_ligadores() to authenticated;

-- Admin só vê os pedidos de fichas de ligadores SEM gerente.
drop function if exists public.listar_solicitacoes_fichas();
create or replace function public.listar_solicitacoes_fichas()
returns table(id uuid, ligador_id uuid, ligador_nome text, created_at timestamptz, na_fila int, pendentes int)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return; end if;
  return query
    select s.id, s.ligador_id, coalesce(l.nome, l.usuario), s.created_at,
           public._fichas_na_fila(s.ligador_id), public._fichas_pendentes(s.ligador_id)
    from public.solicitacoes_fichas s join public.ligadores l on l.id = s.ligador_id
    where s.status = 'pendente' and s.gerente_id is null
    order by s.created_at asc;
end; $$;
grant execute on function public.listar_solicitacoes_fichas() to authenticated;

create or replace function public.listar_solicitacoes_gerente()
returns table(id uuid, gerente_id uuid, gerente_nome text, quantidade int, created_at timestamptz, estoque int)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return; end if;
  return query
    select s.id, s.gerente_id, coalesce(g.nome, g.usuario), s.quantidade, s.created_at, public._estoque_gerente(g.id)
    from public.solicitacoes_gerente s join public.gerentes g on g.id = s.gerente_id
    where s.status = 'pendente'
    order by s.created_at asc;
end; $$;
grant execute on function public.listar_solicitacoes_gerente() to authenticated;

-- p_status: 'atendida' | 'recusada'
create or replace function public.responder_solicitacao_gerente(p_solicitacao uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'apenas admin'; end if;
  if p_status not in ('atendida', 'recusada') then raise exception 'status invalido'; end if;
  update public.solicitacoes_gerente set status = p_status, respondida_at = now()
   where id = p_solicitacao and status = 'pendente';
end; $$;
grant execute on function public.responder_solicitacao_gerente(uuid, text) to authenticated;

-- Chamado pelo admin depois de enviar fichas pro gerente em Pedidos.
create or replace function public.atender_solicitacoes_gerente(p_gerente uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'apenas admin'; end if;
  update public.solicitacoes_gerente set status = 'atendida', respondida_at = now()
   where gerente_id = p_gerente and status = 'pendente';
end; $$;
grant execute on function public.atender_solicitacoes_gerente(uuid) to authenticated;

-- ---- LIGADOR: o pedido de fichas vai pro gerente dele ----------------------
create or replace function public.ligador_solicitar_fichas(p_token uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_lig uuid; v_ger uuid;
begin
  select l.id, l.gerente_id into v_lig, v_ger from public.ligadores l where l.token = p_token and l.ativo = true;
  if v_lig is null then raise exception 'token invalido'; end if;
  if public._fichas_pendentes(v_lig) > 0 then raise exception 'Termine as fichas atuais antes de pedir mais.'; end if;
  if exists(select 1 from public.solicitacoes_fichas s where s.ligador_id = v_lig and s.status = 'pendente') then return; end if;
  insert into public.solicitacoes_fichas (ligador_id, gerente_id) values (v_lig, v_ger);
end; $$;
grant execute on function public.ligador_solicitar_fichas(uuid) to anon, authenticated;

-- ---- GERENTE (por TOKEN) ---------------------------------------------------
create or replace function public.gerente_login(p_usuario text, p_senha text)
returns table(id uuid, nome text, token uuid)
language plpgsql security definer set search_path = public, extensions as $$
begin
  return query
    select g.id, g.nome, g.token from public.gerentes g
    where g.usuario = lower(trim(p_usuario)) and g.ativo = true
      and g.senha_hash = crypt(p_senha, g.senha_hash);
end; $$;
grant execute on function public.gerente_login(text, text) to anon, authenticated;

drop function if exists public.gerente_situacao(uuid);
create or replace function public.gerente_situacao(p_token uuid)
returns table(estoque int, solicitacao_pendente boolean)
language plpgsql security definer set search_path = public as $$
declare v_ger uuid := public._gerente_do_token(p_token);
begin
  if v_ger is null then return; end if;
  return query select public._estoque_gerente(v_ger),
    exists(select 1 from public.solicitacoes_gerente s where s.gerente_id = v_ger and s.status = 'pendente');
end; $$;
grant execute on function public.gerente_situacao(uuid) to anon, authenticated;

drop function if exists public.gerente_ligadores(uuid);
create or replace function public.gerente_ligadores(p_token uuid)
returns table(id uuid, usuario text, nome text, ativo boolean,
              a_ligar int, retorno bigint, bom bigint, ruim bigint, na_fila int)
language plpgsql security definer set search_path = public as $$
declare v_ger uuid := public._gerente_do_token(p_token);
begin
  if v_ger is null then return; end if;
  return query
    select l.id, l.usuario, l.nome, l.ativo,
      public._fichas_pendentes(l.id),
      ((select count(*) from public.pedidos p where p.ligador_id = l.id and p.ligador_status = 'retorno')
        + (select count(*) from public.profiles pr where pr.ligador_id = l.id and pr.ligador_status = 'retorno'))::bigint,
      ((select count(*) from public.pedidos p where p.ligador_id = l.id and p.ligador_status = 'bom')
        + (select count(*) from public.profiles pr where pr.ligador_id = l.id and pr.ligador_status = 'bom'))::bigint,
      ((select count(*) from public.pedidos p where p.ligador_id = l.id and p.ligador_status = 'ruim')
        + (select count(*) from public.profiles pr where pr.ligador_id = l.id and pr.ligador_status = 'ruim'))::bigint,
      public._fichas_na_fila(l.id)
    from public.ligadores l
    where l.gerente_id = v_ger
    order by coalesce(l.nome, l.usuario);
end; $$;
grant execute on function public.gerente_ligadores(uuid) to anon, authenticated;

create or replace function public.gerente_solicitacoes(p_token uuid)
returns table(id uuid, ligador_id uuid, ligador_nome text, created_at timestamptz, na_fila int)
language plpgsql security definer set search_path = public as $$
declare v_ger uuid := public._gerente_do_token(p_token);
begin
  if v_ger is null then return; end if;
  return query
    select s.id, s.ligador_id, coalesce(l.nome, l.usuario), s.created_at, public._fichas_na_fila(s.ligador_id)
    from public.solicitacoes_fichas s join public.ligadores l on l.id = s.ligador_id
    where s.status = 'pendente' and s.gerente_id = v_ger and l.gerente_id = v_ger
    order by s.created_at asc;
end; $$;
grant execute on function public.gerente_solicitacoes(uuid) to anon, authenticated;

-- Libera até 10 fichas: primeiro da fila do próprio ligador, depois do estoque do gerente.
create or replace function public.gerente_conceder_fichas(p_token uuid, p_solicitacao uuid, p_qtd int)
returns int language plpgsql security definer set search_path = public as $$
declare v_ger uuid := public._gerente_do_token(p_token); v_lig uuid; v_qtd int; v_n int;
begin
  if v_ger is null then raise exception 'token invalido'; end if;
  select s.ligador_id into v_lig
    from public.solicitacoes_fichas s join public.ligadores l on l.id = s.ligador_id
   where s.id = p_solicitacao and s.status = 'pendente' and s.gerente_id = v_ger and l.gerente_id = v_ger;
  if v_lig is null then raise exception 'Pedido não encontrado.'; end if;
  v_qtd := least(greatest(coalesce(p_qtd, 0), 0), 10 - public._fichas_pendentes(v_lig));
  if v_qtd <= 0 then raise exception 'Esse ligador já está com 10 fichas.'; end if;
  if public._fichas_na_fila(v_lig) + public._estoque_gerente(v_ger) = 0 then
    raise exception 'Você está sem fichas. Peça mais ao admin.';
  end if;
  v_n := public._liberar_fichas(v_lig, v_qtd);
  if v_n < v_qtd then v_n := v_n + public._estoque_para_ligador(v_ger, v_lig, v_qtd - v_n); end if;
  update public.solicitacoes_fichas set status = 'concedida', quantidade = v_n, respondida_at = now() where id = p_solicitacao;
  return v_n;
end; $$;
grant execute on function public.gerente_conceder_fichas(uuid, uuid, int) to anon, authenticated;

create or replace function public.gerente_recusar_solicitacao(p_token uuid, p_solicitacao uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_ger uuid := public._gerente_do_token(p_token);
begin
  if v_ger is null then raise exception 'token invalido'; end if;
  update public.solicitacoes_fichas set status = 'recusada', respondida_at = now()
   where id = p_solicitacao and status = 'pendente' and gerente_id = v_ger;
end; $$;
grant execute on function public.gerente_recusar_solicitacao(uuid, uuid) to anon, authenticated;

-- Gerente pede mais fichas ao admin (um pedido em aberto por vez).
create or replace function public.gerente_solicitar_fichas(p_token uuid, p_qtd int)
returns void language plpgsql security definer set search_path = public as $$
declare v_ger uuid := public._gerente_do_token(p_token);
begin
  if v_ger is null then raise exception 'token invalido'; end if;
  if exists(select 1 from public.solicitacoes_gerente s where s.gerente_id = v_ger and s.status = 'pendente') then return; end if;
  insert into public.solicitacoes_gerente (gerente_id, quantidade)
  values (v_ger, nullif(least(greatest(coalesce(p_qtd, 0), 0), 10000), 0));
end; $$;
grant execute on function public.gerente_solicitar_fichas(uuid, int) to anon, authenticated;


-- ===========================================================================
-- GERENTE ESCOLHE pra qual ligador vai cada ficha do estoque dele.
-- As fichas enviadas entram na fila do ligador; ele já vê até completar 10
-- "a ligar" e o resto sai conforme ele for pedindo mais.
-- Rode isto UMA vez no Supabase (SQL Editor), depois do gerentes_setup.sql.
-- Pode rodar de novo sem problema.
-- ===========================================================================

-- Estoque do gerente com os dados de cada ficha (pra ele escolher).
create or replace function public.gerente_estoque(p_token uuid)
returns table(tipo text, id uuid, nome text, telefone text, cidade text, uf text, total numeric, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare v_ger uuid := public._gerente_do_token(p_token);
begin
  if v_ger is null then return; end if;
  return query
    select (case when p.status = 'pago' then 'pago' else 'pendente' end)::text, p.id,
           coalesce(nullif(p.pagador->>'nome', ''), pr.nome), coalesce(nullif(p.pagador->>'telefone', ''), pr.telefone),
           coalesce(p.cidade, pr.cidade), coalesce(p.uf, pr.estado), p.total, p.created_at
      from public.pedidos p left join public.profiles pr on pr.id = p.user_id
     where p.gerente_id = v_ger and p.ligador_id is null
    union all
    select 'cadastro'::text, pr.id, pr.nome, pr.telefone, pr.cidade, pr.estado, null::numeric, pr.created_at
      from public.profiles pr
     where pr.gerente_id = v_ger and pr.ligador_id is null
    order by 8 asc;
end; $$;
grant execute on function public.gerente_estoque(uuid) to anon, authenticated;

-- Envia as fichas escolhidas pro ligador (só ligador do próprio gerente, só ficha
-- do próprio estoque). Devolve quantas foram enviadas.
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
   where id = any(coalesce(p_pedidos, '{}')) and gerente_id = v_ger and ligador_id is null;
  get diagnostics v_np = row_count;
  update public.profiles set ligador_id = p_ligador, ligador_status = 'a_ligar', ligador_obs = null,
         ligador_at = null, ligador_liberado_at = null
   where id = any(coalesce(p_cadastros, '{}')) and gerente_id = v_ger and ligador_id is null;
  get diagnostics v_nc = row_count;
  perform public._liberar_fichas(p_ligador, 10 - public._fichas_pendentes(p_ligador));
  -- já recebeu fichas: o pedido dele em aberto está atendido
  if v_np + v_nc > 0 then
    update public.solicitacoes_fichas set status = 'concedida', quantidade = v_np + v_nc, respondida_at = now()
     where ligador_id = p_ligador and status = 'pendente' and gerente_id = v_ger;
  end if;
  return v_np + v_nc;
end; $$;
grant execute on function public.gerente_enviar_fichas(uuid, uuid, uuid[], uuid[]) to anon, authenticated;


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


-- ===========================================================================
-- LIGADOR SEM TRANSMISSÃO: o gerente libera um ligador dele pra ver e trabalhar
-- as fichas sem transmitir a tela, até desligar de novo.
-- Rode isto UMA vez no Supabase (SQL Editor), depois do gerentes_setup.sql.
-- Pode rodar de novo sem problema.
-- ===========================================================================
alter table public.ligadores add column if not exists sem_transmissao boolean not null default false;

-- Gerente liga/desliga — só pra ligador dele.
create or replace function public.gerente_liberar_sem_transmissao(p_token uuid, p_ligador uuid, p_ativo boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_ger uuid := public._gerente_do_token(p_token);
begin
  if v_ger is null then raise exception 'token invalido'; end if;
  update public.ligadores set sem_transmissao = coalesce(p_ativo, false)
   where id = p_ligador and gerente_id = v_ger;
  if not found then raise exception 'Esse ligador não é seu.'; end if;
end; $$;
grant execute on function public.gerente_liberar_sem_transmissao(uuid, uuid, boolean) to anon, authenticated;

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
      ((select count(*) from public.pedidos p where p.ligador_id = l.id and p.ligador_status = 'retorno')
        + (select count(*) from public.profiles pr where pr.ligador_id = l.id and pr.ligador_status = 'retorno'))::bigint,
      ((select count(*) from public.pedidos p where p.ligador_id = l.id and p.ligador_status = 'bom')
        + (select count(*) from public.profiles pr where pr.ligador_id = l.id and pr.ligador_status = 'bom'))::bigint,
      ((select count(*) from public.pedidos p where p.ligador_id = l.id and p.ligador_status = 'ruim')
        + (select count(*) from public.profiles pr where pr.ligador_id = l.id and pr.ligador_status = 'ruim'))::bigint,
      public._fichas_na_fila(l.id),
      l.sem_transmissao
    from public.ligadores l
    where l.gerente_id = v_ger
    order by coalesce(l.nome, l.usuario);
end; $$;
grant execute on function public.gerente_ligadores(uuid) to anon, authenticated;

-- O painel do ligador lê daqui se está liberado.
drop function if exists public.ligador_situacao_fichas(uuid);
create or replace function public.ligador_situacao_fichas(p_token uuid)
returns table(pendentes int, na_fila int, solicitacao_pendente boolean, sem_transmissao boolean)
language plpgsql security definer set search_path = public as $$
declare v_lig uuid; v_sem boolean;
begin
  select l.id, l.sem_transmissao into v_lig, v_sem from public.ligadores l where l.token = p_token and l.ativo = true;
  if v_lig is null then return; end if;
  return query select public._fichas_pendentes(v_lig), public._fichas_na_fila(v_lig),
    exists(select 1 from public.solicitacoes_fichas s where s.ligador_id = v_lig and s.status = 'pendente'),
    coalesce(v_sem, false);
end; $$;
grant execute on function public.ligador_situacao_fichas(uuid) to anon, authenticated;

-- Trocar o ligador de gerente (ou remover o gerente) desliga a liberação:
-- o gerente novo decide, e ligador sem gerente não fica liberado pra sempre.
create or replace function public.definir_gerente_ligador(p_ligador uuid, p_gerente uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'apenas admin'; end if;
  update public.ligadores set gerente_id = p_gerente,
         sem_transmissao = case when gerente_id is distinct from p_gerente then false else sem_transmissao end
   where id = p_ligador;
  update public.solicitacoes_fichas set gerente_id = p_gerente where ligador_id = p_ligador and status = 'pendente';
end; $$;
grant execute on function public.definir_gerente_ligador(uuid, uuid) to authenticated;

create or replace function public.remover_gerente(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'apenas admin'; end if;
  update public.ligadores set sem_transmissao = false where gerente_id = p_id;
  update public.pedidos  set gerente_id = null where gerente_id = p_id;
  update public.profiles set gerente_id = null where gerente_id = p_id;
  delete from public.gerentes where id = p_id;
end; $$;
grant execute on function public.remover_gerente(uuid) to authenticated;

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

-- ===========================================================================
-- ENVIO DIRETO DO ADMIN PRO LIGADOR JÁ LIBERA AS FICHAS (até 10 "a ligar" por vez),
-- igual quando o gerente distribui. Antes ficavam presas na fila até alguém
-- conceder em Notificações. Rode isto no Supabase (SQL Editor). Pode rodar de novo.
-- ===========================================================================
create or replace function public.admin_liberar_fichas_ligador(p_ligador uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not public.is_admin() then raise exception 'apenas admin'; end if;
  v_n := public._liberar_fichas(p_ligador, 10 - public._fichas_pendentes(p_ligador));
  if v_n > 0 then
    update public.solicitacoes_fichas set status = 'concedida', quantidade = v_n, respondida_at = now()
     where ligador_id = p_ligador and status = 'pendente';
  end if;
  return v_n;
end; $$;
grant execute on function public.admin_liberar_fichas_ligador(uuid) to authenticated;

-- Destrava agora quem já está com fichas presas na fila e o lote vazio.
select public._liberar_fichas(l.id, 10 - public._fichas_pendentes(l.id))
  from public.ligadores l
 where l.ativo and public._fichas_na_fila(l.id) > 0 and public._fichas_pendentes(l.id) < 10;
update public.solicitacoes_fichas s set status = 'concedida', respondida_at = now()
 where s.status = 'pendente' and public._fichas_pendentes(s.ligador_id) > 0;

-- ===========================================================================
-- SEM LIMITE DE 10 FICHAS: toda ficha atribuída a um ligador já fica visível pra
-- ele na hora (envio do admin, do gerente ou concessão de pedido de fichas).
-- Rode isto no Supabase (SQL Editor). Pode rodar de novo sem problema.
-- ===========================================================================

-- Atribuiu a um ligador → libera na hora. Vale pra qualquer caminho de envio.
create or replace function public._ficha_liberada_na_hora()
returns trigger language plpgsql as $$
begin
  new.ligador_liberado_at := now();
  return new;
end; $$;

drop trigger if exists trg_pedido_liberado_na_hora on public.pedidos;
create trigger trg_pedido_liberado_na_hora
  before insert or update on public.pedidos
  for each row when (new.ligador_id is not null and new.ligador_liberado_at is null)
  execute function public._ficha_liberada_na_hora();

drop trigger if exists trg_cadastro_liberado_na_hora on public.profiles;
create trigger trg_cadastro_liberado_na_hora
  before insert or update on public.profiles
  for each row when (new.ligador_id is not null and new.ligador_liberado_at is null)
  execute function public._ficha_liberada_na_hora();

-- Admin concede pedido de fichas: sem teto.
create or replace function public.conceder_fichas(p_solicitacao uuid, p_qtd int)
returns int language plpgsql security definer set search_path = public as $$
declare v_lig uuid; v_n int;
begin
  if not public.is_admin() then raise exception 'apenas admin'; end if;
  select s.ligador_id into v_lig from public.solicitacoes_fichas s where s.id = p_solicitacao and s.status = 'pendente';
  if v_lig is null then raise exception 'solicitacao nao encontrada'; end if;
  v_n := public._liberar_fichas(v_lig, greatest(coalesce(p_qtd, 0), 0));
  update public.solicitacoes_fichas set status = 'concedida', quantidade = v_n, respondida_at = now() where id = p_solicitacao;
  return v_n;
end; $$;
grant execute on function public.conceder_fichas(uuid, int) to authenticated;

-- Gerente concede pedido de fichas: sem teto (fila do ligador, depois estoque do gerente).
create or replace function public.gerente_conceder_fichas(p_token uuid, p_solicitacao uuid, p_qtd int)
returns int language plpgsql security definer set search_path = public as $$
declare v_ger uuid := public._gerente_do_token(p_token); v_lig uuid; v_qtd int; v_n int;
begin
  if v_ger is null then raise exception 'token invalido'; end if;
  select s.ligador_id into v_lig
    from public.solicitacoes_fichas s join public.ligadores l on l.id = s.ligador_id
   where s.id = p_solicitacao and s.status = 'pendente' and s.gerente_id = v_ger and l.gerente_id = v_ger;
  if v_lig is null then raise exception 'Pedido não encontrado.'; end if;
  v_qtd := greatest(coalesce(p_qtd, 0), 0);
  if v_qtd <= 0 then raise exception 'Informe quantas fichas.'; end if;
  if public._fichas_na_fila(v_lig) + public._estoque_gerente(v_ger) = 0 then
    raise exception 'Você está sem fichas. Peça mais ao admin.';
  end if;
  v_n := public._liberar_fichas(v_lig, v_qtd);
  if v_n < v_qtd then v_n := v_n + public._estoque_para_ligador(v_ger, v_lig, v_qtd - v_n); end if;
  update public.solicitacoes_fichas set status = 'concedida', quantidade = v_n, respondida_at = now() where id = p_solicitacao;
  return v_n;
end; $$;
grant execute on function public.gerente_conceder_fichas(uuid, uuid, int) to anon, authenticated;

-- Envio direto do admin: libera tudo que estiver na fila.
create or replace function public.admin_liberar_fichas_ligador(p_ligador uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not public.is_admin() then raise exception 'apenas admin'; end if;
  v_n := public._liberar_fichas(p_ligador, public._fichas_na_fila(p_ligador));
  update public.solicitacoes_fichas set status = 'concedida', quantidade = v_n, respondida_at = now()
   where ligador_id = p_ligador and status = 'pendente' and v_n > 0;
  return v_n;
end; $$;
grant execute on function public.admin_liberar_fichas_ligador(uuid) to authenticated;

-- Libera agora tudo que está esperando na fila de qualquer ligador.
update public.pedidos  set ligador_liberado_at = now() where ligador_id is not null and ligador_liberado_at is null;
update public.profiles set ligador_liberado_at = now() where ligador_id is not null and ligador_liberado_at is null;
update public.solicitacoes_fichas s set status = 'concedida', respondida_at = now()
 where s.status = 'pendente' and public._fichas_pendentes(s.ligador_id) > 0;

-- Confere: ninguém deve ter fichas esperando na fila.
select coalesce(l.nome, l.usuario) as ligador,
       public._fichas_pendentes(l.id) as liberadas_a_ligar,
       public._fichas_na_fila(l.id)   as esperando_na_fila
  from public.ligadores l
 where l.ativo
 order by liberadas_a_ligar desc;

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
              total bigint, a_ligar bigint, retorno bigint, bom bigint, ruim bigint)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return; end if;
  return query
    select l.id, l.usuario, l.nome, l.ativo, l.created_at,
      public._fichas_do_ligador(l.id, null),
      public._fichas_do_ligador(l.id, 'a_ligar'),
      public._fichas_do_ligador(l.id, 'retorno'),
      public._fichas_do_ligador(l.id, 'bom'),
      public._fichas_do_ligador(l.id, 'ruim')
    from public.ligadores l
    order by l.created_at desc;
end; $$;
grant execute on function public.listar_ligadores() to authenticated;

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
