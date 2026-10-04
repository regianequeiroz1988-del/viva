# Clube de Pontos / Sorteios — Template (React + Vite)

Template de site **inspirado na estrutura** de um clube de pontos + catálogo de
sorteios. Todo o conteúdo é **placeholder** (textos genéricos, sem logo nem
imagens da marca original) — pensado pra você plugar a **sua** identidade.

> ⚠️ Conteúdo de exemplo. Substitua textos, cores, imagens e a marca pelos seus
> antes de publicar.

## ▶️ Como rodar localmente

Você precisa do **Node.js 18+** instalado (https://nodejs.org).

```bash
# 1. entrar na pasta
cd viva-sorte-clone

# 2. instalar dependências
npm install

# 3. subir o servidor de desenvolvimento
npm run dev
```

Abra o endereço que aparecer no terminal (normalmente **http://localhost:5173**).

Para gerar a versão de produção:

```bash
npm run build      # gera a pasta dist/
npm run preview    # pré-visualiza o build
```

## 🗂️ Estrutura de pastas

```
viva-sorte-clone/
├─ index.html
├─ package.json
├─ vite.config.js
├─ public/
│  └─ favicon.svg
└─ src/
   ├─ main.jsx                 # ponto de entrada
   ├─ App.jsx                  # monta as seções na ordem
   ├─ data/
   │  └─ content.js            # 👈 TODOS os textos/itens (edite aqui!)
   ├─ context/
   │  └─ CartContext.jsx       # carrinho simples (estado global)
   ├─ utils/
   │  └─ format.js             # formata moeda (R$)
   ├─ styles/
   │  └─ global.css            # 👈 todo o estilo, organizado por seção
   └─ components/
      ├─ Header.jsx            # menu fixo + dropdowns + menu mobile + carrinho
      ├─ Hero.jsx              # banner (carrossel) + painel de compra
      ├─ Sorteios.jsx          # carrossel de cards de sorteio
      ├─ AdBanners.jsx         # faixa de banners
      ├─ Ganhadores.jsx        # cards de ganhadores
      ├─ Parceiros.jsx         # grid de parceiros/descontos
      ├─ Instituicao.jsx       # instituição beneficiada
      ├─ Footer.jsx            # rodapé
      ├─ BackToTop.jsx         # botão voltar ao topo
      └─ Icons.jsx             # ícones SVG inline
```

## ✏️ Como personalizar

- **Textos e itens:** edite `src/data/content.js` (um lugar só pra tudo).
- **Cores e fontes:** edite as variáveis no topo de `src/styles/global.css`
  (`--blue`, `--green`, `--yellow`, etc.). A fonte é a Lexend (trocável no `index.html`).
- **Imagens/logo:** os blocos `[ IMAGEM ]` / `[ LOGO ]` usam a classe `.ph`.
  Troque por `<img src="..." />` quando tiver os seus arquivos.
- **Seções:** adicione/remova/reordene em `src/App.jsx`.

## ✅ O que já funciona (JavaScript)

- Header fixo que ganha sombra ao rolar
- Menu mobile (hambúrguer) com submenus
- Carrossel do hero (automático + setas + dots)
- Carrossel horizontal de sorteios (setas)
- Seletores de quantidade (− / +)
- Carrinho funcional (soma total e contador no topo)
- Botão "voltar ao topo"
- Layout 100% responsivo (desktop / tablet / celular)

## 🔌 Próximos passos (quando você quiser)

- **GitHub:** versionar o código.
- **Vercel:** publicar online (detecta Vite automaticamente).
- **Supabase:** login de usuários e banco de dados (cadastro, sorteios, carrinho real).

É só pedir que eu te guio em cada integração.
