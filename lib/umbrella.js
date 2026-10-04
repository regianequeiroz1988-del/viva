// Helpers da UmbrellaPag — gateway de Pix (docs: https://docs.umbrellapag.com).
//  - Base:      https://api-gateway.umbrellapag.com/api
//  - Auth:      header x-api-key + User-Agent UMBRELLAB2B/1.0 (obrigatório)
//  - Criar Pix: POST /user/transactions        (amount em CENTAVOS)
//  - Status:    GET  /user/transactions/{id}   (respostas no envelope { status, message, data })
//  - Webhook:   POST no postbackUrl enviado na criação → { objectId, data: { status } }
//    O webhook não é assinado: o status só vale depois de reconsultar a API.

export const UMBRELLA_BASE = 'https://api-gateway.umbrellapag.com/api'
const UMBRELLA_UA = 'UMBRELLAB2B/1.0'

const supaUrl = () => process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const supaKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY

async function lerConfig(chave) {
  const url = supaUrl()
  const key = supaKey()
  if (!url || !key) return ''
  try {
    const r = await fetch(
      `${url}/rest/v1/configuracoes?chave=eq.${encodeURIComponent(chave)}&select=valor`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    )
    const arr = await r.json().catch(() => [])
    return (Array.isArray(arr) && arr[0]?.valor) || ''
  } catch {
    return ''
  }
}

// Banco (/admin) tem prioridade sobre a env.
export async function credenciaisUmbrella() {
  const [dbApiKey, dbWebhook] = await Promise.all([
    lerConfig('umbrella_api_key'),
    lerConfig('umbrella_webhook_key'),
  ])
  return {
    apiKey: String(dbApiKey || process.env.UMBRELLA_API_KEY || '').trim(),
    webhookSecret: String(dbWebhook || process.env.UMBRELLA_WEBHOOK_SECRET || '').trim(),
  }
}

export const umbrellaHeaders = (apiKey) => ({
  'x-api-key': apiKey,
  'User-Agent': UMBRELLA_UA,
  'Content-Type': 'application/json',
  Accept: 'application/json',
})

const desembrulhar = (resp) => (resp && typeof resp === 'object' && resp.data && typeof resp.data === 'object' ? resp.data : resp || {})

// Normaliza a transação → { id, status, qrCode, qrCodeUrl, expiresAt }.
export function extrairPixUmbrella(resp) {
  const t = desembrulhar(resp)
  const pix = t.pix && typeof t.pix === 'object' ? t.pix : {}
  const copiaCola = t.qrCode ?? pix.qrcode ?? pix.qrCode ?? pix.copyPaste ?? pix.emv ?? ''
  const imagem = pix.qrcodeImage ?? pix.qrCodeImage ?? pix.qrCodeBase64 ?? pix.image ?? ''
  const qrCodeUrl = imagem
    ? (/^(data:|https?:)/.test(String(imagem)) ? String(imagem) : `data:image/png;base64,${imagem}`)
    : ''
  const exp = pix.expirationDate ?? pix.expiresAt ?? t.expiresAt
  let expiresAt = exp ? new Date(exp).getTime() : NaN
  if (Number.isNaN(expiresAt)) expiresAt = Date.now() + 30 * 60 * 1000
  return {
    id: t.id != null ? String(t.id) : '',
    status: t.status || '',
    qrCode: String(copiaCola || ''),
    qrCodeUrl,
    expiresAt,
  }
}

export const umbrellaPago = (t) => {
  const status = String(desembrulhar(t)?.status || '').toLowerCase()
  return status === 'paid' || status === 'approved'
}

export function extrairE2eUmbrella(t) {
  const d = desembrulhar(t)
  return d.endToEndId ?? d.pix?.endToEndId ?? d.pix?.end2EndId ?? null
}

// Devolve a transação (já fora do envelope) ou null.
export async function buscarTransacaoUmbrella(id, apiKey) {
  if (!id || !apiKey) return null
  try {
    const r = await fetch(`${UMBRELLA_BASE}/user/transactions/${encodeURIComponent(id)}`, {
      headers: umbrellaHeaders(apiKey),
    })
    if (!r.ok) return null
    const j = await r.json().catch(() => null)
    const t = desembrulhar(j)
    return t && t.id != null ? t : null
  } catch {
    return null
  }
}
