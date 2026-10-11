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
    -- NÃO grava o e-mail SINTÉTICO do login por CPF ({cpf}@cpf.vivasorte.app):
    -- ele é só do Supabase Auth, não é o e-mail da pessoa. Só e-mail REAL entra;
    -- sem e-mail real → NULL (campo fica vazio no /admin e no perfil).
    case when new.email like '%@cpf.vivasorte.app' then null else new.email end,
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
-- Guardado por CPF (não por pedido/cadastro) porque o /ganhador é anônimo.
-- O VALOR do prêmio também é por CPF (não um valor único pra todo mundo — cada
-- pessoa pode "ganhar" um valor diferente). `valor` null = usa o padrão global
-- (config premio_ganhador_valor, editável no topo do painel do ligador).
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
