// Rota da NOSSA base pros sorteios/ganhadores. Em vez do navegador bater direto na
// API oficial do Viva Sorte (frágil: se cair/bloquear/mudar, o site quebra), o servidor
// puxa de lá, guarda um SNAPSHOT no Supabase (configuracoes.sorteios_snapshot) e serve
// isso — com cache de 10 min e fallback pro último snapshot bom se a API oficial falhar.
//   GET  /api/sorteios  → { raffles, results, updated_at }  (auto-atualiza se estiver velho)
//   POST /api/sorteios  → força atualização agora (botão do /admin)

const API_BASE = 'https://api.vivasorteoficial.com.br/v1'
const SNAP_KEY = 'sorteios_snapshot'
const STALE_MS = 10 * 60 * 1000 // 10 min

const supa = () => ({
  url: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  srk: process.env.SUPABASE_SERVICE_ROLE_KEY,
})

async function lerSnapshot() {
  const { url, srk } = supa()
  if (!url || !srk) return null
  try {
    const r = await fetch(`${url}/rest/v1/configuracoes?chave=eq.${SNAP_KEY}&select=valor`, {
      headers: { apikey: srk, Authorization: `Bearer ${srk}` },
    })
    const rows = await r.json().catch(() => [])
    const v = rows?.[0]?.valor
    return v ? JSON.parse(v) : null
  } catch {
    return null
  }
}

async function salvarSnapshot(snap) {
  const { url, srk } = supa()
  if (!url || !srk) return
  try {
    await fetch(`${url}/rest/v1/configuracoes`, {
      method: 'POST',
      headers: {
        apikey: srk,
        Authorization: `Bearer ${srk}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({ chave: SNAP_KEY, valor: JSON.stringify(snap) }),
    })
  } catch {
    /* ignore */
  }
}

// Puxa da API oficial (sorteios ativos + resultados). Se os sorteios ativos falharem,
// retorna null (não sobrescreve o snapshot bom com dado vazio).
async function puxarDaApi() {
  const [ativosR, resultsR] = await Promise.allSettled([
    fetch(`${API_BASE}/raffles/active`).then((r) => (r.ok ? r.json() : null)),
    fetch(`${API_BASE}/raffles/results`).then((r) => (r.ok ? r.json() : null)),
  ])
  const ativos = ativosR.status === 'fulfilled' ? ativosR.value : null
  const raffles = ativos && Array.isArray(ativos.raffles) ? ativos.raffles : null
  if (!raffles) return null
  const results = resultsR.status === 'fulfilled' ? resultsR.value : null
  return { raffles, results, updated_at: new Date().toISOString() }
}

export default async function handler(req, res) {
  // Força atualização agora (botão do /admin).
  if (req.method === 'POST') {
    const fresh = await puxarDaApi()
    if (!fresh) {
      const snap = await lerSnapshot()
      return res.status(502).json({
        ok: false,
        error: 'Não consegui puxar da API oficial agora. Tente de novo em instantes.',
        updated_at: snap?.updated_at || null,
      })
    }
    await salvarSnapshot(fresh)
    return res.status(200).json({ ok: true, updated_at: fresh.updated_at, count: fresh.raffles.length })
  }

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  // Serve o snapshot; atualiza se estiver velho (ou não existir). Se a API oficial
  // falhar, mantém o último snapshot bom (site não quebra).
  let snap = await lerSnapshot()
  const velho = !snap || !snap.updated_at || Date.now() - new Date(snap.updated_at).getTime() > STALE_MS
  if (velho) {
    const fresh = await puxarDaApi()
    if (fresh) {
      snap = fresh
      await salvarSnapshot(fresh)
    }
  }
  if (!snap) return res.status(200).json({ raffles: [], results: null, updated_at: null })
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=600')
  return res.status(200).json(snap)
}
