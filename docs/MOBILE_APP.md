# Mobile com cara de app de iPhone — o que mudou e como

> **Status no Viva Sorte: aplicado.** Todo o CSS novo fica num bloco só no fim do
> `src/styles/global.css` (“MOBILE COM CARA DE APP”), fácil de copiar pra outro projeto.

Guia do que muda no mobile e **como**, com código pronto pra copiar.
Escrito pro Viva Sorte, mas genérico: num outro projeto troque só os nomes de
classe (`adm__*`, `ger__*`, `ligp__*`) pelos de lá.

Breakpoint usado em tudo: **`860px`** (abaixo disso = celular/tablet em pé).

---

## 0. O que está ruim hoje (diagnóstico)

| # | Onde | Problema | Causa |
|---|------|----------|-------|
| 1 | Admin — menu | No celular o menu lateral vira uma faixa horizontal **só de ícones**, sem nome. São 10 itens + logo + rodapé numa linha só: estoura a tela e não dá pra saber o que é cada ícone. | `@media (max-width: 860px)` faz `.adm__link span { display: none }` e `overflow-x: auto` na `.adm__side`. |
| 2 | Admin — abas internas (Pedidos: *Pedidos / Exportados / Enviados / Somente Cadastros / Cadastros Exportados*) | As últimas abas ficam **fora da tela** e não dá pra chegar nelas. | `.adm__tabs` é `display:flex` sem `overflow-x` e sem `white-space: nowrap`. |
| 3 | Painel do gerente — abas (Fichas / Acessos / Transmissões) | Mesma coisa: centralizadas, sem rolagem. | `.ger__abas { justify-content: center }` sem overflow. |
| 4 | Campos de texto (busca, login, código do prêmio, observação) | Ao tocar, o **iPhone dá zoom** na página e não volta sozinho. | `font-size` dos inputs < 16px (`0.82rem`–`0.9rem`). O Safari dá zoom em qualquer campo menor que 16px. |
| 5 | Modais (detalhe do pedido, cadastro) | Caixa centralizada pequena, rolagem dentro de rolagem, a página de trás rola junto. | `.admmodal__box` é um card central com `max-height: 88vh`; não há trava de scroll do body. |
| 6 | Barra de ações em lote (Exportar / Enviar para… / Enviar) | Quebra em várias linhas e cobre os cards no topo. | `.adm__bulkbar` é `sticky; top: 8px` com `flex-wrap`. |
| 7 | Tabelas (Visão geral, Resumo, Usuários) | Rolagem lateral dentro da tabela; difícil de ler. | `.adm__table { min-width: 560px }`. |
| 8 | Geral | Botões pequenos (< 44px), “flash” cinza ao tocar, sem resposta visual ao toque, sem respeitar o notch / barra do iPhone. | Falta de base mobile no CSS. |
| 9 | “Adicionar à Tela de Início” | Abre como site comum (com barra do Safari). | Não existe `manifest.webmanifest` nem `apple-touch-icon`. |

---

## 1. Base global (vale pro site todo)

### 1.1 `index.html`
Já tem `viewport-fit=cover` e `apple-mobile-web-app-capable`. **Adicionar**:

```html
<link rel="manifest" href="/manifest.webmanifest" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
```

> `apple-mobile-web-app-status-bar-style` fica em `default`. Com `black-translucent` o
> conteúdo passa por baixo da barra de status, e aí **todo** header fixo do site
> precisa somar `env(safe-area-inset-top)`. Só troque se fizer isso no site inteiro.

`public/manifest.webmanifest`:

```json
{
  "name": "Viva Sorte+",
  "short_name": "Viva Sorte+",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#f4f6fb",
  "theme_color": "#1e3fcf",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

> Ícones: PNG quadrado, fundo sólido. `apple-touch-icon.png` = 180×180.
> Pro admin abrir direto no painel, dá pra ter um segundo manifest com `"start_url": "/admin"` só na rota do admin (opcional).

### 1.2 CSS base (topo do `global.css`)

```css
html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
body { -webkit-tap-highlight-color: transparent; }
button, a, [role="button"], label, select { touch-action: manipulation; } /* tira o atraso de 300ms do toque */

/* iPhone: campo com menos de 16px dá zoom ao focar */
@media (max-width: 860px) {
  input, select, textarea { font-size: 16px !important; }
}

/* Resposta ao toque (só em tela de toque) */
@media (hover: none) and (pointer: coarse) {
  button:not(:disabled):active,
  .adm__pcard:active { transform: scale(0.97); transition: transform 0.08s ease; }
}

/* Alvo mínimo de toque */
@media (max-width: 860px) {
  .adm__btn, .adm__tab, .ligc__acoes button, .ligc__premio-salvar { min-height: 44px; }
}

/* Variáveis de área segura (notch e barra de gestos) */
:root {
  --safe-top: env(safe-area-inset-top, 0px);
  --safe-bottom: env(safe-area-inset-bottom, 0px);
  --appbar-h: 52px;
  --tabbar-h: 62px;
  --ease-ios: cubic-bezier(0.2, 0.8, 0.2, 1);
}
```

**Regra de fluidez:** animar só `transform` e `opacity` (nunca `height`, `top`,
`width`, `box-shadow` em loop). Sempre ter `@media (prefers-reduced-motion: reduce)`
desligando as animações novas.

---

## 2. Admin: barra de cima + barra de abas embaixo (igual app de iPhone)

No celular a sidebar **some** e entram:
- **Barra superior** fixa e translúcida com o **nome da tela atual**.
- **Barra de abas inferior** com 4 atalhos principais + **“Mais”**.
- **“Mais”** abre uma folha (bottom sheet) com **todas** as telas **com nome**, o
  contador de notificações, “Ver site” e “Sair”.

Desktop continua exatamente como está.

### 2.1 `src/pages/admin/AdminLayout.jsx`

```jsx
// atalhos que ficam na barra de baixo; o resto vai pro "Mais"
const PRINCIPAIS = ['/admin', '/admin/pedidos', '/admin/notificacoes', '/admin/ligadores']

// dentro do componente:
const [maisAberto, setMaisAberto] = useState(false)
useEffect(() => setMaisAberto(false), [pathname])          // fecha ao trocar de tela
useTravaScroll(maisAberto)                                  // ver seção 5.2

const atual = itens.find((i) => ativo(i.to, i.end))
const principais = itens.filter((i) => PRINCIPAIS.includes(i.to))
const maisAtivo = !!atual && !PRINCIPAIS.includes(atual.to)
```

JSX (dentro de `<div className="adm">`, antes do `<main>`):

```jsx
<header className="adm__appbar">
  <span className="adm__brand-mark">VS</span>
  <h1 className="adm__appbar-tit">{atual?.label || 'Painel'}</h1>
</header>

<nav className="adm__tabbar" aria-label="Navegação">
  {principais.map((i) => {
    const Icon = i.icon
    return (
      <button key={i.to} type="button" className={ativo(i.to, i.end) ? 'is-active' : ''} onClick={() => navigate(i.to)}>
        <span className="adm__tabbar-ic"><Icon size={22} />{i.badge && notif > 0 && <em>{notif}</em>}</span>
        <span>{i.to === '/admin' ? 'Início' : i.label}</span>
      </button>
    )
  })}
  <button type="button" className={maisAtivo || maisAberto ? 'is-active' : ''} onClick={() => setMaisAberto(true)}>
    <span className="adm__tabbar-ic"><Menu size={22} /></span>
    <span>Mais</span>
  </button>
</nav>

{maisAberto && (
  <div className="adm__sheet-fundo" onClick={() => setMaisAberto(false)}>
    <div className="adm__sheet" role="dialog" aria-label="Menu" onClick={(e) => e.stopPropagation()}>
      <span className="adm__sheet-alca" />
      {itens.map((i) => {
        const Icon = i.icon
        return (
          <button key={i.to} type="button" className={`adm__sheet-item ${ativo(i.to, i.end) ? 'is-active' : ''}`} onClick={() => navigate(i.to)}>
            <Icon size={20} /><span>{i.label}</span>
            {i.badge && notif > 0 && <em className="adm__link-badge">{notif}</em>}
          </button>
        )
      })}
      <hr />
      <button type="button" className="adm__sheet-item" onClick={() => navigate('/')}><ExternalLink size={20} /><span>Ver site</span></button>
      <button type="button" className="adm__sheet-item is-perigo" onClick={logout}><Logout size={20} /><span>Sair</span></button>
    </div>
  </div>
)}
```

> `Menu` = ícone de 3 linhas (adicionar em `components/Icons.jsx` se não existir).

### 2.2 CSS — substitui o bloco “sidebar vira barra superior compacta”

```css
.adm__appbar, .adm__tabbar { display: none; }

@media (max-width: 860px) {
  .adm { flex-direction: column; }
  .adm__side { display: none; }

  .adm__appbar {
    display: flex; align-items: center; gap: 10px;
    position: sticky; top: 0; z-index: 60;
    height: calc(var(--appbar-h) + var(--safe-top));
    padding: var(--safe-top) 16px 0;
    background: rgba(255, 255, 255, 0.82);
    -webkit-backdrop-filter: saturate(180%) blur(18px);
    backdrop-filter: saturate(180%) blur(18px);
    border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  }
  .adm__appbar .adm__brand-mark { width: 30px; height: 30px; font-size: 0.75rem; }
  .adm__appbar-tit { font-size: 1.05rem; font-weight: 800; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .adm__main { padding: 16px 16px calc(var(--tabbar-h) + var(--safe-bottom) + 24px); }
  .adm__pagehead h1 { display: none; }            /* o título já está na barra de cima */

  .adm__tabbar {
    display: grid; grid-template-columns: repeat(5, 1fr);
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 60;
    padding: 6px 4px calc(6px + var(--safe-bottom));
    background: rgba(255, 255, 255, 0.9);
    -webkit-backdrop-filter: saturate(180%) blur(18px);
    backdrop-filter: saturate(180%) blur(18px);
    border-top: 1px solid rgba(0, 0, 0, 0.06);
  }
  .adm__tabbar button {
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px;
    min-height: 48px; font-size: 0.66rem; font-weight: 700; color: #8a8fa3;
  }
  .adm__tabbar button > span:last-child { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .adm__tabbar button.is-active { color: var(--blue); }
  .adm__tabbar-ic { position: relative; display: grid; place-items: center; }
  .adm__tabbar-ic em {
    position: absolute; top: -4px; right: -10px; min-width: 18px; height: 18px; padding: 0 5px;
    border-radius: 999px; background: #e23b4a; color: #fff; font-style: normal; font-size: 0.66rem;
    display: grid; place-items: center; border: 2px solid #fff;
  }

  /* Folha "Mais" */
  .adm__sheet-fundo { position: fixed; inset: 0; z-index: 80; background: rgba(14, 17, 36, 0.4); animation: admFade 0.2s ease; }
  .adm__sheet {
    position: absolute; left: 0; right: 0; bottom: 0;
    max-height: 85dvh; overflow-y: auto; overscroll-behavior: contain;
    background: var(--surface); border-radius: 20px 20px 0 0;
    padding: 8px 12px calc(16px + var(--safe-bottom));
    animation: sheetUp 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .adm__sheet-alca { display: block; width: 40px; height: 5px; border-radius: 3px; background: #d6d9e4; margin: 4px auto 10px; }
  .adm__sheet-item {
    display: flex; align-items: center; gap: 14px; width: 100%;
    min-height: 52px; padding: 0 14px; border-radius: 12px;
    font-size: 1rem; font-weight: 600; color: var(--text); text-align: left;
  }
  .adm__sheet-item span { flex: 1; }
  .adm__sheet-item.is-active { background: var(--blue-light); color: var(--blue); }
  .adm__sheet-item.is-perigo { color: #d23b4a; }
  .adm__sheet hr { border: 0; border-top: 1px solid var(--border); margin: 8px 0; }
}

@keyframes sheetUp { from { transform: translateY(100%); } to { transform: none; } }
@media (prefers-reduced-motion: reduce) { .adm__sheet, .adm__sheet-fundo { animation: none; } }
```

---

## 3. Abas internas que rolam pro lado (Pedidos, Ligador, Gerente)

Vale pra `.adm__tabs` (Pedidos, Painel do Ligador) e `.ger__abas` (Painel do Gerente).

### 3.1 CSS

```css
.adm__tabs, .ger__abas {
  display: flex; flex-wrap: nowrap;
  overflow-x: auto; overscroll-behavior-x: contain;
  scroll-snap-type: x proximity; scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}
.adm__tabs::-webkit-scrollbar, .ger__abas::-webkit-scrollbar { display: none; }
.adm__tab, .ger__abas button { flex: none; white-space: nowrap; scroll-snap-align: start; }

@media (max-width: 860px) {
  .ger__abas { justify-content: flex-start; }
  /* encosta nas bordas e fica grudada embaixo da barra de cima */
  .adm__tabs {
    margin: 0 -16px 14px; padding: 0 16px;
    position: sticky; top: calc(var(--appbar-h) + var(--safe-top)); z-index: 40;
    background: var(--bg);
    /* esmaece as bordas pra mostrar que tem mais aba pro lado */
    -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 14px, #000 calc(100% - 28px), transparent);
            mask-image: linear-gradient(90deg, transparent 0, #000 14px, #000 calc(100% - 28px), transparent);
  }
  .adm__tab { padding: 12px 14px; }
}
```

> No painel do ligador/gerente não existe a barra de cima do admin: lá use
> `top: 0` (ou a altura do `.ligp__top` se ele ficar grudado — ver seção 6).

### 3.2 Aba ativa sempre visível — `src/lib/useAbaVisivel.js`

```js
import { useEffect } from 'react'

// Rola a barra de abas até a aba ativa (ex.: abriu direto em "Somente Cadastros").
// Não usa scrollIntoView porque ele também rolaria a página na vertical.
export function useAbaVisivel(ref, aba) {
  useEffect(() => {
    const barra = ref.current
    const el = barra?.querySelector('[aria-selected="true"], .is-active')
    if (!barra || !el || barra.scrollWidth <= barra.clientWidth) return
    const dx = el.getBoundingClientRect().left - barra.getBoundingClientRect().left
    barra.scrollTo({ left: barra.scrollLeft + dx - (barra.clientWidth - el.offsetWidth) / 2, behavior: 'smooth' })
  }, [ref, aba])
}
```

Uso (AdminPedidos, LigadorPainel, GerentePainel):

```jsx
const abasRef = useRef(null)
useAbaVisivel(abasRef, aba)
<div className="adm__tabs" role="tablist" ref={abasRef}>…</div>
```

---

## 4. Tela de Pedidos (toolbar, seleção, ações em lote)

### 4.1 Busca e filtros
```css
@media (max-width: 860px) {
  .adm__toolbar { flex-direction: column; align-items: stretch; gap: 10px; }
  .adm__searchwrap { max-width: none; min-width: 0; }
  .adm__search { height: 46px; border-radius: 12px; }
  .adm__selrow { gap: 10px; }
  .adm__selall input[type="checkbox"] { width: 22px; height: 22px; }
}
```

### 4.2 Barra de ações em lote vira barra de baixo
Quando tem item selecionado, a barra sai do topo e fica **fixa logo acima da
barra de abas**, como a barra de ações do app Fotos.

```css
@media (max-width: 860px) {
  .adm__bulkbar {
    position: fixed; top: auto; left: 8px; right: 8px; z-index: 55;
    bottom: calc(var(--tabbar-h) + var(--safe-bottom) + 8px);
    margin: 0; border-radius: 16px;
    box-shadow: 0 10px 30px rgba(14, 17, 36, 0.22);
    flex-direction: column; align-items: stretch; gap: 8px;
    animation: sheetUp 0.25s cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  /* cada ação ocupa a linha toda; "Enviar para…" divide a linha com o botão "Enviar" */
  .adm__bulkbar-actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .adm__bulkbar-actions > * { flex: 1 1 100%; justify-content: center; min-height: 44px; }
  .adm__bulkbar-actions .adm__ligsel { flex: 1 1 0; min-width: 0; width: auto; max-width: none; }
  .adm__bulkbar-actions .adm__ligsel + .adm__btn { flex: 0 0 auto; padding: 0 18px; }
  /* espaço pra última ficha não ficar escondida atrás da barra */
  .adm__main:has(.adm__bulkbar) { padding-bottom: calc(var(--tabbar-h) + var(--safe-bottom) + 170px); }
}
```

### 4.3 Cards dos pedidos
```css
@media (max-width: 860px) {
  .adm__pcard { border-radius: 16px; padding: 14px; }
  .adm__pcard-grid { grid-template-columns: auto 1fr; font-size: 0.9rem; }
  .adm__pcard-grid dd { overflow-wrap: anywhere; }
}
```

---

## 5. Modais viram “folha” que sobe de baixo

### 5.1 CSS
```css
@media (max-width: 640px) {
  .admmodal { align-items: flex-end; padding: 0; }
  .admmodal__box {
    max-width: none; max-height: 92dvh; overscroll-behavior: contain;
    border-radius: 20px 20px 0 0;
    padding: 12px 16px calc(20px + var(--safe-bottom));
    animation: sheetUp 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .admmodal__box::before {
    content: ""; display: block; width: 40px; height: 5px; border-radius: 3px;
    background: #d6d9e4; margin: 0 auto 12px;
  }
  /* botões de ação do modal ficam grudados no fim da folha, um por linha */
  .admmodal__foot {
    position: sticky; bottom: calc(-20px - var(--safe-bottom)); z-index: 1;
    margin: 18px -16px 0; padding: 12px 16px calc(12px + var(--safe-bottom));
    background: var(--surface);
    display: grid; grid-template-columns: 1fr; justify-content: stretch; gap: 8px;
  }
  .admmodal__foot > * { width: 100%; justify-content: center; min-height: 48px; }
}
```
> `grid-template-columns: 1fr` é obrigatório: se o rodapé tiver `justify-content: flex-end`
> no desktop, sem ele os botões ficam encolhidos à direita.

### 5.2 Travar a página de trás — `src/lib/useTravaScroll.js`
```js
import { useEffect } from 'react'

// Enquanto `ativo`, a página de trás não rola (inclusive no iOS).
export function useTravaScroll(ativo) {
  useEffect(() => {
    if (!ativo) return
    const y = window.scrollY
    const s = document.body.style
    Object.assign(s, { position: 'fixed', top: `-${y}px`, left: '0', right: '0', width: '100%' })
    return () => {
      Object.assign(s, { position: '', top: '', left: '', right: '', width: '' })
      window.scrollTo(0, y)
    }
  }, [ativo])
}
```
Chamar em cada modal: `useTravaScroll(!!sel)` (AdminPedidos), no “Mais” do
AdminLayout e em qualquer outro overlay.

### 5.3 Botão “voltar” do celular fecha o modal (Android / gesto do iPhone)
No mesmo arquivo `useTravaScroll.js`:
```js
export function useVoltarFecha(aberto, fechar) {
  useEffect(() => {
    if (!aberto) return
    let fechouPeloVoltar = false
    history.pushState({ ...history.state, overlay: true }, '')
    const onPop = () => { fechouPeloVoltar = true; fechar() }
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      if (!fechouPeloVoltar && history.state?.overlay) history.back()
    }
  }, [aberto]) // eslint-disable-line react-hooks/exhaustive-deps
}
```
Uso: dentro do componente do modal (montado só quando aberto)
`useTravaScroll(true); useVoltarFecha(true, onClose)`; ou na página
`useVoltarFecha(!!sel, () => setSel(null))`.

> Cuidado: se um item do overlay **navega** pra outra rota, navegue com
> `navigate(to, { replace: true })` enquanto o overlay está aberto. Isso substitui a
> entrada extra do histórico, senão o “voltar” cai duas vezes na mesma tela.

---

## 6. Painéis do Ligador e do Gerente

```css
@media (max-width: 860px) {
  .ligp__top {
    position: sticky; top: 0; z-index: 50;
    padding: calc(10px + var(--safe-top)) 16px 10px;
  }
  .ligp__top-acoes { gap: 6px; }
  .ligp__top-acoes .adm__btn span { display: none; }      /* botões do topo só com ícone */
  .ligp__top-acoes .adm__btn { width: 40px; height: 40px; padding: 0; justify-content: center; }

  .ger__abas, .ligp .adm__tabs { top: var(--ligp-top-h, 60px); }   /* gruda embaixo do topo */

  .ligc__acoes { display: grid; grid-template-columns: 1fr 1fr 56px; gap: 8px; }
  .ligc__acoes button { min-height: 48px; font-size: 0.95rem; }
  .ligc__obs { min-height: 88px; }
  .ligc__premio-row { flex-wrap: wrap; }
  .ligc__premio-input { min-height: 44px; }
}
```

> Os botões do topo precisam ter o texto dentro de `<span>` pra regra
> “só ícone” funcionar; manter `aria-label` / `title` com o nome.

---

## 7. Tabelas viram lista de cards (Visão geral, Resumo, Usuários)

### 7.1 CSS
```css
@media (max-width: 640px) {
  .adm__table--cards { min-width: 0; }
  .adm__table--cards thead { display: none; }
  .adm__table--cards tbody tr {
    display: grid; grid-template-columns: 1fr 1fr; gap: 8px 12px;
    padding: 14px 16px; border-bottom: 1px solid var(--border);
  }
  .adm__table--cards td { padding: 0; border: 0; white-space: normal; }
  .adm__table--cards td[data-label]::before {
    content: attr(data-label); display: block;
    font-size: 0.7rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.3px;
  }
  /* nome, linhas "carregando/vazio" e a coluna de ações ocupam a linha toda */
  .adm__table--cards td:first-child, .adm__table--cards td[colspan], .adm__table--cards .adm__td-acoes { grid-column: 1 / -1; }
  .adm__table--cards td:first-child:not([data-label]) { font-weight: 700; }
}
```

### 7.2 JSX
```jsx
<table className="adm__table adm__table--cards">
  …
  <td data-label="Cliente">{nome}</td>
  <td data-label="Total">{formatBRL(total)}</td>
  <td data-label="Status"><StatusPill status={status} /></td>
</table>
```

---

## 8. Fluidez (sensação de app)

1. **Sem salto de layout:** skeleton com a mesma altura do conteúdo final (o admin já
   tem `.adm__skel` — usar em todas as listas).
2. **Listas longas** (Pedidos, Usuários, Acessos): `content-visibility: auto;
   contain-intrinsic-size: 220px;` em cada card. O navegador só desenha o que está
   na tela, e a rolagem fica lisa mesmo com centenas de itens.
3. **Polling sem piscar:** ao recarregar a cada 15s, só trocar o estado se os dados
   mudaram (comparar `JSON.stringify` ou `updated_at`), pra não redesenhar a lista
   e perder a posição do dedo.
4. **`backdrop-filter`** só nas barras fixas (cima/baixo). Em cards e modais isso
   pesa em celular fraco.
5. **Rolagem dentro de folha/modal:** `overscroll-behavior: contain` pra rolagem não
   “vazar” pra página de trás.
6. **Busca:** filtrar com `useDeferredValue(busca)` pra digitação não travar em
   listas grandes.
7. **Transições:** 200–300ms, curva `cubic-bezier(0.2, 0.8, 0.2, 1)` (a do iOS),
   só `transform`/`opacity`.

---

## 9. Ordem de implementação (arquivos)

| Passo | Arquivo(s) | O que |
|-------|-----------|-------|
| 1 | `index.html`, `public/manifest.webmanifest`, ícones | Seção 1.1 |
| 2 | `src/styles/global.css` (topo) | Seção 1.2 |
| 3 | `src/lib/useTravaScroll.js`, `src/lib/useAbaVisivel.js` | Seções 5.2 e 3.2 |
| 4 | `src/components/Icons.jsx` | Ícone `Menu` |
| 5 | `src/pages/admin/AdminLayout.jsx` + CSS | Seção 2 (resolve “não consigo ir nas abas do admin”) |
| 6 | `global.css` + `AdminPedidos.jsx`, `LigadorPainel.jsx`, `GerentePainel.jsx` | Seção 3 (resolve “não vejo Somente Cadastros”) |
| 7 | `global.css` + `AdminPedidos.jsx` | Seções 4 e 5 |
| 8 | `global.css` | Seção 6 |
| 9 | `AdminDashboard.jsx`, `AdminResumo.jsx`, `AdminUsuarios.jsx` | Seção 7 |
| 10 | Listas | Seção 8 |

---

## 10. Como testar

- Navegador em **375×812** (iPhone SE/13 mini), **390×844** (iPhone 14/15) e **430×932** (Pro Max).
- **iPhone de verdade no Safari** (o zoom em campo e o notch só aparecem lá) e
  também “Adicionar à Tela de Início” → abrir pelo ícone.
- Checklist:
  - [ ] Do celular dá pra chegar em **todas** as 10 telas do admin, e cada uma mostra o nome.
  - [ ] Em Pedidos dá pra rolar as abas e abrir **Somente Cadastros** e **Cadastros Exportados**.
  - [ ] Tocar em qualquer campo **não dá zoom**.
  - [ ] Nada fica escondido atrás do notch ou da barra de gestos.
  - [ ] Modal sobe de baixo, a página de trás não rola e o “voltar” fecha o modal.
  - [ ] Selecionar fichas mostra a barra de ações embaixo, e a última ficha continua visível.
  - [ ] Nenhuma página rola pro lado (`document.documentElement.scrollWidth === innerWidth`).
  - [ ] Teclado aberto não cobre o botão Salvar (dados do cliente, código do prêmio).
  - [ ] Celular deitado (paisagem) continua utilizável.
