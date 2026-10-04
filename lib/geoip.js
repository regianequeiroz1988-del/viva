// Geolocalização por IP → { cidade, uf, pais }.
//
// Substitui os headers x-vercel-ip-city / x-vercel-ip-country-region / x-vercel-ip-country
// que SÓ a Vercel injeta automaticamente na requisição. Em qualquer outro host (Render,
// Railway, VPS...) esses headers simplesmente não existem — e como o código só lia
// `req.headers['x-vercel-ip-city']`, o campo ficava sempre vazio, SEM erro nenhum.
// Foi assim que "a cidade parou de vir" na migração para a Render passou despercebido.
//
// Usa a API pública ip-api.com (sem chave, ~45 req/min). Timeout curto e fallback
// silencioso: geolocalização é dado acessório — nunca deve atrasar nem quebrar
// o fluxo de pagamento ou o registro de visita por causa disso.

const TIMEOUT_MS = 1500

const VAZIO = { cidade: '', uf: '', pais: '' }

// IPs locais/privados não têm geolocalização real — evita gastar a requisição à toa
// (comum em teste local ou atrás de proxy mal configurado).
function ehIpPrivadoOuLocal(ip) {
  return !ip || ip === '::1' || /^127\.|^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(ip)
}

/** Resolve cidade/UF/país a partir de um IP público. Nunca lança — falha vira { cidade:'', uf:'', pais:'' }. */
export async function geolocalizarIp(ip) {
  const limpo = String(ip || '').trim()
  if (ehIpPrivadoOuLocal(limpo)) return { ...VAZIO }

  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    const r = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(limpo)}?fields=status,city,region,countryCode`,
      { signal: ctrl.signal }
    )
    clearTimeout(timer)
    if (!r.ok) return { ...VAZIO }
    const d = await r.json().catch(() => null)
    if (!d || d.status !== 'success') return { ...VAZIO }
    return {
      cidade: String(d.city || ''),
      uf: String(d.region || ''), // já vem como sigla (ex.: "SP"), igual ao header antigo da Vercel
      pais: String(d.countryCode || ''),
    }
  } catch {
    return { ...VAZIO }
  }
}
