// Índice de prêmios dos sorteios para o /admin.
// buildIndicePremios() cruza /raffles/active (sorteios em aberto) + /raffles/results
// (sorteios já realizados) num índice por edição E por título. Assim o /admin acha o
// prêmio até de pedidos ANTIGOS (sem snapshot) e de sorteios que já passaram.
// (O valor do Viva Sorte PRINCIPAL não vem em texto — só está na arte do banner — e é
//  definido à mão em Configurações; veja CONFIG_KEYS.premioVivaSorte.)
const API_BASE = 'https://api.vivasorteoficial.com.br/v1'

export async function buildIndicePremios() {
  const idx = {}
  const add = (r, prizeName) => {
    const entry = {
      excerpt: r.excerpt || '',
      kind: r.kind || '',
      thumbnail: r.thumbnail || '',
      prizeName: prizeName || '',
      title: r.title || '',
    }
    if (r.edition != null) idx[String(r.edition)] = entry
    if (r.title) idx['t:' + String(r.title).toLowerCase()] = entry
  }

  try {
    const a = await fetch(`${API_BASE}/raffles/active`).then((r) => r.json())
    for (const r of a.raffles || []) add(r)
  } catch {
    /* segue sem os ativos */
  }
  try {
    const res = await fetch(`${API_BASE}/raffles/results`).then((r) => r.json())
    const list = Array.isArray(res) ? res : Object.values(res)
    for (const r of list || []) {
      // junta os nomes dos prêmios já sorteados (ex.: "R$ 2.000,00 - Valor líquido")
      const names = (r.results || []).map((p) => p?.prize?.name).filter(Boolean).join(' ')
      add(r, names)
    }
  } catch {
    /* segue sem os resultados */
  }
  return idx
}
