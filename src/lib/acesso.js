import { getVisitorId } from './visitante.js'

// Registra a visita do usuário (1x por sessão) chamando /api/visita, que grava a
// cidade aproximada (via geo da Vercel) na tabela `acessos`. Assim o /admin mostra
// de quais cidades as pessoas estão entrando — mesmo quem não compra — e, pelo
// visitor_id, se aquela visita converteu em venda depois.
// Só funciona no site publicado (no localhost o /api não roda; a chamada falha em
// silêncio, sem atrapalhar nada).
export function registrarAcesso() {
  if (typeof window === 'undefined') return
  try {
    if (window.sessionStorage.getItem('vs_acesso')) return // já contou nesta sessão
    window.sessionStorage.setItem('vs_acesso', '1')
  } catch {
    /* sessionStorage indisponível (aba privada) — segue e registra mesmo assim */
  }
  try {
    fetch('/api/visita', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: window.location.pathname, vid: getVisitorId() }),
      keepalive: true,
    }).catch(() => {})
  } catch {
    /* ignore */
  }
}
