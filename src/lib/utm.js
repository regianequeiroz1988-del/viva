// Captura e guarda as UTMs (origem do tráfego) para enviar à UTMify junto com o
// pedido. O script da UTMify no index.html também captura UTMs, mas aqui fazemos
// a NOSSA própria captura para ter controle total do que é gravado no pedido e
// repassado ao backend.
//
// Estratégia: ao abrir o site com UTMs na URL, guardamos no localStorage. Se a
// pessoa voltar por outra campanha, atualizamos os campos novos (last-touch).
// No checkout, lemos de volta com getUtms().
//
// Quando o link do anúncio NÃO vem etiquetado com utm_*, ainda assim tentamos
// descobrir a origem por dois sinais reais que chegam na própria requisição:
//   1) o ID de clique da plataforma (fbclid/gclid/...) — só existe se veio de lá;
//   2) o referrer — de qual site a pessoa saiu.
// Isso NÃO inventa campanha: recupera só a ORIGEM. Nome de campanha continua
// dependendo de o anúncio ser etiquetado com utm_campaign.

const KEY = 'vs_utm'
const CAMPOS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'src', 'sck']

// IDs de clique: a plataforma anexa sozinha ao link do anúncio. Se está na URL,
// o clique veio de lá — é prova, não estimativa. Por isso vira 'cpc' (pago).
const IDS_DE_CLIQUE = [
  { param: 'fbclid', source: 'facebook' },
  { param: 'gclid', source: 'google' },
  { param: 'gbraid', source: 'google' },
  { param: 'wbraid', source: 'google' },
  { param: 'ttclid', source: 'tiktok' },
  { param: 'msclkid', source: 'bing' },
  { param: 'twclid', source: 'twitter' },
]

// Último recurso: domínio de onde a pessoa veio. Vira 'referral' (não pago),
// porque um referrer sozinho não distingue anúncio de post orgânico.
const REFERRERS = [
  { re: /(^|\.)facebook\.com$/i, source: 'facebook' },
  { re: /(^|\.)instagram\.com$/i, source: 'instagram' },
  { re: /(^|\.)google\./i, source: 'google' },
  { re: /(^|\.)tiktok\.com$/i, source: 'tiktok' },
  { re: /(^|\.)youtube\.com$/i, source: 'youtube' },
  { re: /(^|\.)whatsapp\.com$/i, source: 'whatsapp' },
  { re: /(^|\.)t\.co$/i, source: 'twitter' },
  { re: /(^|\.)bing\.com$/i, source: 'bing' },
]

/** Devolve as UTMs guardadas (objeto vazio se não houver / sem localStorage). */
export function getUtms() {
  if (typeof window === 'undefined') return {}
  try {
    return JSON.parse(window.localStorage.getItem(KEY) || '{}') || {}
  } catch {
    return {}
  }
}

/** Origem deduzida do referrer. Ignora navegação dentro do próprio site. */
function sourceDoReferrer() {
  try {
    const ref = document.referrer
    if (!ref) return ''
    const host = new URL(ref).hostname
    if (!host || host === window.location.hostname) return ''
    const achado = REFERRERS.find((r) => r.re.test(host))
    return achado ? achado.source : host.replace(/^www\./i, '')
  } catch {
    return ''
  }
}

/** Lê as UTMs da URL atual e, se houver alguma, persiste no localStorage. */
export function captureUtms() {
  if (typeof window === 'undefined') return
  try {
    const q = new URLSearchParams(window.location.search)
    const achadas = {}
    for (const c of CAMPOS) {
      const v = q.get(c)
      if (v) achadas[c] = v
    }

    // UTM explícita SEMPRE vence: só deduzimos quando não veio utm_source.
    if (!achadas.utm_source) {
      const clique = IDS_DE_CLIQUE.find((c) => q.get(c.param))
      if (clique) {
        achadas.utm_source = clique.source
        if (!achadas.utm_medium) achadas.utm_medium = 'cpc'
      }
    }
    if (!achadas.utm_source) {
      const origem = sourceDoReferrer()
      if (origem) {
        achadas.utm_source = origem
        if (!achadas.utm_medium) achadas.utm_medium = 'referral'
      }
    }

    if (Object.keys(achadas).length > 0) {
      window.localStorage.setItem(KEY, JSON.stringify({ ...getUtms(), ...achadas }))
    }
  } catch {
    /* localStorage indisponível (aba privada) — ignora */
  }
}
