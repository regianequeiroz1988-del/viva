// Helpers da Sharpify — gateway de Pix (docs: https://docs.sharpify.com.br).
//  - Base:      https://sharpify-pay.com
//  - Auth:      headers x-sharpify-client-id e x-sharpify-client-secret
//  - Criar Pix: POST /api/v1/gateway/payment/create-paymnet  (amount em REAIS, gatewayMethod "PIX")
//  - Status:    GET  /api/v1/gateway/payment/get-payment?paymentLinkId=ID  (status APPROVED = pago)
//  - Webhook:   POST no callbackURL enviado na criação. Não é assinado: o status só vale
//               depois da reconsulta autenticada (get-payment).

export const SHARPIFY_BASE = 'https://sharpify-pay.com'

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
export async function credenciaisSharpify() {
  const [dbId, dbSecret, dbWebhook] = await Promise.all([
    lerConfig('sharpify_client_id_key'),
    lerConfig('sharpify_client_secret_key'),
    lerConfig('sharpify_webhook_key'),
  ])
  return {
    clientId: String(dbId || process.env.SHARPIFY_CLIENT_ID || '').trim(),
    clientSecret: String(dbSecret || process.env.SHARPIFY_CLIENT_SECRET || '').trim(),
    webhookSecret: String(dbWebhook || process.env.SHARPIFY_WEBHOOK_SECRET || '').trim(),
  }
}

export const sharpifyHeaders = (clientId, clientSecret) => ({
  'x-sharpify-client-id': clientId,
  'x-sharpify-client-secret': clientSecret,
  'Content-Type': 'application/json',
  Accept: 'application/json',
})

const desembrulhar = (resp) => (resp && typeof resp === 'object' && resp.data && typeof resp.data === 'object' ? resp.data : resp || {})

const pareceCopiaECola = (s) => /^000201/.test(String(s || ''))
const pareceImagem = (s) => /^(data:|https?:)/.test(s) || /^[A-Za-z0-9+/=]{100,}$/.test(s)

// Normaliza a criação → { id, qrCode (copia-e-cola), qrCodeUrl, expiresAt }.
export function extrairPixSharpify(resp) {
  const link = desembrulhar(resp)
  const gw = link.payment?.gateway?.data && typeof link.payment.gateway.data === 'object' ? link.payment.gateway.data : {}
  const textos = [gw.code, gw.qrCode, gw.copyPaste, gw.emv].filter((x) => typeof x === 'string' && x)
  const qrCode = textos.find(pareceCopiaECola) || ''
  const imagem = textos.find((x) => !pareceCopiaECola(x) && pareceImagem(x)) || ''
  const qrCodeUrl = imagem
    ? (/^(data:|https?:)/.test(imagem) ? imagem : `data:image/png;base64,${imagem}`)
    : ''
  const exp = link.payment?.gateway?.expirationDate ?? gw.expirationDate
  let expiresAt = exp ? new Date(exp).getTime() : NaN
  if (Number.isNaN(expiresAt)) expiresAt = Date.now() + 30 * 60 * 1000
  return {
    id: link.id != null ? String(link.id) : '',
    status: link.status || '',
    qrCode,
    qrCodeUrl,
    expiresAt,
  }
}

export const sharpifyPago = (link) => String(desembrulhar(link)?.status || '').toUpperCase() === 'APPROVED'

// Valor total do link em centavos (pricing.total vem em reais).
export function totalCentavosSharpify(link) {
  const d = desembrulhar(link)
  const reais = Number(d.pricing?.total ?? d.payment?.amount)
  return Number.isFinite(reais) ? Math.round(reais * 100) : NaN
}

// Devolve o link (já fora do envelope) ou null.
export async function buscarLinkSharpify(id, clientId, clientSecret) {
  if (!id || !clientId || !clientSecret) return null
  try {
    const r = await fetch(
      `${SHARPIFY_BASE}/api/v1/gateway/payment/get-payment?paymentLinkId=${encodeURIComponent(id)}`,
      { headers: sharpifyHeaders(clientId, clientSecret) }
    )
    if (!r.ok) return null
    const j = await r.json().catch(() => null)
    const link = desembrulhar(j)
    return link && link.id != null ? link : null
  } catch {
    return null
  }
}
