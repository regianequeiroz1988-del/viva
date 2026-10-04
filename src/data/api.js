/**
 * ===========================================================================
 *  Integração com a API pública do Viva Sorte (sorteios ao vivo)
 *  GET https://api.vivasorteoficial.com.br/v1/raffles/active
 *  CORS liberado — consumível direto do navegador. Cache da API: ~60s.
 * ===========================================================================
 */
const API_BASE = 'https://api.vivasorteoficial.com.br/v1'

// Puxa os dados da NOSSA rota /api/sorteios (cache + snapshot no Supabase). O navegador
// NÃO bate mais direto na API oficial. Memoizado por carregamento de página: Hero,
// Sorteios e Ganhadores compartilham UMA chamada.
let _snapPromise = null
export function fetchSorteios(force = false) {
  if (!_snapPromise || force) {
    _snapPromise = fetch('/api/sorteios')
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}))
  }
  return _snapPromise
}

export async function fetchActiveRaffles() {
  const snap = await fetchSorteios()
  return snap.raffles || []
}

/**
 * Ganhadores recentes (home) — GET /raffles/results.
 * Retorna o ganhador-destaque de cada um dos sorteios mais recentes.
 * A API não traz foto (photoUrl costuma ser null) → usamos o avatar padrão.
 */
const fmtFullDate = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  timeZone: 'America/Sao_Paulo',
})

export async function fetchWinners(limit = 4) {
  const snap = await fetchSorteios()
  const data = snap.results
  if (!data) return { items: [], edition: '', date: '' }
  // A API devolve um objeto tipo-array ({0:..,1:..}); normalizamos p/ lista.
  const list = Array.isArray(data) ? data : Object.values(data)

  const items = []
  for (const raffle of list) {
    const prize = raffle.results?.[0]
    const winner = prize?.winners?.[0]
    if (!winner) continue
    items.push({
      id: 'winner-' + (raffle.uuid || raffle.edition),
      name: winner.name || 'Ganhador',
      value: prize.prize?.name || '',
      city: [winner.city, winner.state].filter(Boolean).join('/'),
      photo: winner.photoUrl || '/img/avatar.webp',
    })
    if (items.length >= limit) break
  }

  const latest = list[0]
  return {
    items,
    edition: latest ? String(latest.edition) : '',
    date: latest?.endedAt ? fmtFullDate.format(new Date(latest.endedAt)) : '',
  }
}

// Metadados dos grupos exibidos na home (chave = category.data.slug da API)
const GROUPS_META = {
  'hora-do-viva': {
    id: 'hora-do-viva',
    title: 'Hora do Viva',
    subtitle: 'Sorteios Filantropia Premiável',
    icon: '/img/icon-hora-do-viva.png',
  },
  vivasortedodia: {
    id: 'viva-sorte-do-dia',
    title: 'Viva Sorte do Dia',
    subtitle: 'Multiplique o valor pago em até 100.000x',
    icon: '/img/icon-viva-sorte-do-dia.png',
  },
}
const GROUP_ORDER = ['hora-do-viva', 'vivasortedodia']

// drawDate vem em UTC ("2026-06-08 15:30:00.000"); exibimos no fuso de SP.
const asUtcDate = (drawDate) => new Date(String(drawDate).replace(' ', 'T') + 'Z')

const fmtHora = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Sao_Paulo',
})
const fmtDia = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo',
})

function timeLabel(drawDate) {
  return 'ÀS ' + fmtHora.format(asUtcDate(drawDate))
}

function dayInfo(drawDate) {
  const dt = asUtcDate(drawDate)
  const now = new Date()
  const dia = fmtDia.format(dt)
  const hoje = fmtDia.format(now)
  const min = Math.round((dt - now) / 60000)
  let drawIn
  if (min < 60) drawIn = Math.max(1, min) + (min === 1 ? ' minuto' : ' minutos')
  else if (min < 60 * 24) {
    const h = Math.round(min / 60)
    drawIn = h + (h === 1 ? ' hora' : ' horas')
  } else {
    const d = Math.round(min / 60 / 24)
    drawIn = d + (d === 1 ? ' dia' : ' dias')
  }
  return { dayLabel: dia === hoje ? 'HOJE' : dia, drawIn }
}

// Formata a data do sorteio principal: "DOM, 14 JUN | 2026"
const fmtWeekday = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: 'America/Sao_Paulo' })
const fmtDayNum = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', timeZone: 'America/Sao_Paulo' })
const fmtMonth = new Intl.DateTimeFormat('pt-BR', { month: 'short', timeZone: 'America/Sao_Paulo' })
const fmtYear = new Intl.DateTimeFormat('pt-BR', { year: 'numeric', timeZone: 'America/Sao_Paulo' })
const limpaUpper = (s) => s.replace(/\./g, '').trim().toUpperCase()

/**
 * Sorteio PRINCIPAL (Viva Sorte semanal, "1 Milhão") para o Hero.
 * Vem na mesma lista /raffles/active com category.slug === 'viva-sorte' (kind MAIN).
 */
export function mainRaffleToCard(raffles) {
  const m = raffles.find((r) => r.category?.slug === 'viva-sorte' || r.kind === 'MAIN')
  if (!m) return null
  const dt = asUtcDate(m.drawDate)
  return {
    title: m.title, // ex.: "Viva Sorte - 14/06/2026"
    weekday: `${limpaUpper(fmtWeekday.format(dt))}, ${fmtDayNum.format(dt)} ${limpaUpper(fmtMonth.format(dt))} | ${fmtYear.format(dt)}`,
    edition: String(m.edition),
    unitPrice: Number(m.price) || 0.99,
    image: m.thumbnail,
    // Prêmio: kind/excerpt da API p/ calcular o prêmio máximo (sem OCR no banner).
    excerpt: m.excerpt || '',
    kind: m.kind || 'MAIN',
  }
}

/** Converte as raffles da API nos grupos/cards usados pela home. */
export function rafflesToGroups(raffles) {
  const byCat = {}
  for (const r of raffles) {
    const slug = r.category?.slug
    if (!GROUPS_META[slug]) continue
    ;(byCat[slug] ||= []).push(r)
  }

  const groups = []
  for (const slug of GROUP_ORDER) {
    const list = byCat[slug]
    if (!list || !list.length) continue
    groups.push({
      ...GROUPS_META[slug],
      items: list.map((r) => {
        const { dayLabel, drawIn } = dayInfo(r.drawDate)
        return {
          id: 'raffle-' + (r.uuid || r.edition),
          title: r.title,
          edition: String(r.edition),
          drawIn,
          dayLabel,
          time: timeLabel(r.drawDate),
          susep: 'Processo SUSEP: ' + r.susepProcess,
          price: Number(r.price) || 0,
          defaultQty: slug === 'vivasortedodia' ? 100 : 1,
          image: r.thumbnail,
          // Prêmio: kind/excerpt da API p/ calcular o prêmio máximo (sem OCR no banner).
          excerpt: r.excerpt || '',
          kind: r.kind || '',
        }
      }),
    })
  }
  return groups
}
