# Integração Supabase — Viva Sorte+

O login/cadastro dos clientes e os dados deles (perfil, pontos, carteira, pedidos,
títulos, preferências) vão ficar no **Supabase**. Hoje o app roda com **login
simulado (mock)**; assim que as chaves abaixo forem configuradas, ele passa a usar
a autenticação e os dados reais — **sem mudar nenhuma tela**.

## Passo a passo (o que VOCÊ faz — eu não posso criar a conta nem digitar suas credenciais)

1. **Crie um projeto** grátis em https://supabase.com (New project). Guarde a senha do banco.
2. No projeto, abra **SQL Editor** → cole e rode o arquivo [`supabase/schema.sql`](../supabase/schema.sql).
   Isso cria as tabelas (`profiles`, `pedidos`, `titulos`), a segurança por linha (RLS)
   e o gatilho que cria o perfil automaticamente quando alguém se cadastra.
3. Em **Authentication → Sign In / Providers → Email**: **desative "Confirm email"**.
   (Usamos um e-mail "sintético" derivado do CPF, então não dá pra confirmar e-mail.)
4. Em **Project Settings → API**, copie:
   - **Project URL**
   - **anon public** key  ← (pode ir no front, é protegida pela RLS)
   - ⚠️ NÃO use/!compartilhe a chave **service_role** (essa é secreta).
5. Crie o arquivo **`.env`** (copie de `.env.example`) e cole:
   ```
   VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```
6. **Me avise** (pode colar a URL + a anon key aqui no chat — são públicas) e eu ligo
   o cadastro/login real e a leitura/gravação dos dados de cada cliente.

## Como o login por CPF funciona no Supabase

O Supabase Auth é por e-mail; o site é por **CPF**. Solução (já no código, em `src/lib/supabase.js`):
o cliente loga com **CPF + senha**, mas por baixo usamos um e-mail sintético
`{cpf}@cliente.vivasorte.local`. O e-mail real do cliente é guardado no perfil
(pra comunicações). Login e UX ficam iguais ao site oficial.

## O que já está pronto no código
- `@supabase/supabase-js` instalado.
- `src/lib/supabase.js` — cliente (fica em modo mock enquanto não há chaves).
- `supabase/schema.sql` — tabelas + RLS + gatilho de perfil.
- `.env.example` — modelo das variáveis.

## O que eu faço depois que você configurar
- Trocar o login simulado pela autenticação real (cadastro + login por CPF).
- Salvar o cadastro dos clientes (perfil) no banco.
- Ler pontos/carteira/pedidos/títulos reais nas páginas `/usuario/*`.
- Persistir o carrinho/compra no checkout (quando a gente fizer essa etapa).
