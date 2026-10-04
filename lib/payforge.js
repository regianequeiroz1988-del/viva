// Helpers da PayForge — gateway de Pix.
//
// ⚠️ A API mudou: a doc pública (pay.payforge.uk/docs) está DESATUALIZADA. A URL real
// é uma Supabase Edge Function, e a autenticação virou Basic Auth.
//  - Base:      https://hqfvpukbnqnnbebyoyrg.supabase.co/functions/v1/pix-api
//  - Auth:      Authorization: Basic base64(CLIENT_ID:CLIENT_SECRET)
//  - Criar Pix: POST /pix/charges       (amount em REAIS, mínimo R$ 2,00)
//  - Status:    GET  /pix/charges/{id}  (pago quando status === 'approved')
//  - Saldo:     GET  /balance
//
// Roda atrás do Cloudflare: SEM User-Agent de navegador a resposta pode vir em HTML.
// As credenciais ficam no Supabase (config payforge_*), lidas pelo backend via service role.
//   payforge_public_key → CLIENT ID     (pf_live_ck_…)
//   payforge_secret_key → CLIENT SECRET (pf_live_sk_…)

export const PAYFORGE_BASE = 'https://hqfvpukbnqnnbebyoyrg.supabase.co/functions/v1/pix-api'

// Piso TÉCNICO da adquirente: abaixo disso ela devolve 502 "Falha na adquirente".
export const PAYFORGE_MIN_CENTAVOS = 200

// Piso COMERCIAL padrão. A PayForge cobra 6% + R$ 1,50 FIXO por transação, então
// ticket baixo fica inviável (em R$ 2,00 a taxa come 81% da venda). Ajustável sem
// deploy pela config `payforge_valor_minimo_centavos` no /admin.
export const PAYFORGE_MIN_PADRAO_CENTAVOS = 500

// Valor mínimo efetivo: o configurado, nunca abaixo do piso técnico da adquirente.
export async function valorMinimoPayforge() {
  const bruto = await lerConfig('payforge_valor_minimo_centavos')
  const n = Number(String(bruto || '').trim())
  const escolhido = Number.isFinite(n) && n > 0 ? Math.round(n) : PAYFORGE_MIN_PADRAO_CENTAVOS
  return Math.max(escolhido, PAYFORGE_MIN_CENTAVOS)
}

const PAYFORGE_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const supaUrl = () => process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const supaKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY

// Lê um valor da tabela `configuracoes` (service role ignora RLS).
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

// Gateway ativo escolhido no /admin (default: pagarme).
export async function gatewayAtivo() {
  return (await lerConfig('gateway_ativo')) || 'pagarme'
}

// Credenciais da PayForge. `publicKey` = CLIENT ID; `secretKey` = CLIENT SECRET.
// Os nomes das configs continuam os mesmos para não quebrar o /admin.
export async function credenciaisPayforge() {
  const [dbSecret, dbPublic, dbWebhookSecret] = await Promise.all([
    lerConfig('payforge_secret_key'),
    lerConfig('payforge_public_key'),
    lerConfig('payforge_webhook_key'),
  ])
  const secretKey = dbSecret || process.env.PAYFORGE_SECRET_KEY
  const publicKey = dbPublic || process.env.PAYFORGE_PUBLIC_KEY
  const webhookSecret = dbWebhookSecret || process.env.PAYFORGE_WEBHOOK_SECRET
  return {
    secretKey: String(secretKey || '').trim(),
    publicKey: String(publicKey || '').trim(),
    webhookSecret: String(webhookSecret || '').trim(),
  }
}

// Headers padrão: Basic Auth + User-Agent de navegador (exigido pelo Cloudflare).
export const payforgeHeaders = (publicKey, secretKey, extra = {}) => ({
  Authorization: 'Basic ' + Buffer.from(`${publicKey}:${secretKey}`).toString('base64'),
  'Content-Type': 'application/json',
  Accept: 'application/json',
  'User-Agent': PAYFORGE_UA,
  ...extra,
})

// Normaliza a resposta de criar/consultar → { id, status, qrCode, qrCodeUrl, expiresAt }.
// A API mistura camelCase e snake_case na MESMA resposta, então lemos as duas formas.
export function extrairPixPayforge(resp) {
  const t = resp || {}
  const copiaCola = t.qrCode ?? t.qr_code ?? t.copyPaste ?? t.copy_paste ?? ''
  const base64 = t.qrCodeBase64 ?? t.qr_code_base64 ?? ''
  // qrCodeBase64 vem null com frequência; nesse caso o front gera o QR do copia-e-cola.
  const qrCodeUrl = base64
    ? (String(base64).startsWith('data:') ? String(base64) : `data:image/png;base64,${base64}`)
    : ''
  const exp = t.expiresAt ?? t.expires_at
  let expiresAt = exp ? new Date(String(exp).replace(' ', 'T')).getTime() : NaN
  if (Number.isNaN(expiresAt)) expiresAt = Date.now() + 30 * 60 * 1000
  return {
    id: t.id != null ? String(t.id) : '',
    status: t.status || '',
    qrCode: String(copiaCola || ''),
    qrCodeUrl,
    expiresAt,
  }
}

// Banco do PAGADOR. A PayForge NÃO devolve dados do pagador (nome, CPF, banco) —
// só o e2eId do Pix. Mantido com a mesma assinatura para não quebrar os handlers.
export function extrairBancoPayforge(resp) {
  const t = resp?.transaction || resp?.data || resp || {}
  return {
    pix_banco: null,
    pix_ispb: null,
    pix_e2e: t.e2eId ?? t.e2e_id ?? t.endToEndId ?? t.end_to_end_id ?? null,
  }
}

// É "pago"? Na API nova o estado final de sucesso é 'approved'.
// 'paid'/'completed' seguem aceitos por segurança (respostas legadas).
export const payforgePago = (t) => {
  const status = String(t?.status || '').toLowerCase()
  return status === 'approved' || status === 'paid' || status === 'completed'
}

// Consulta uma cobrança por id.
export async function buscarTransacaoPayforge(id, publicKey, secretKey) {
  if (!id || !publicKey || !secretKey) return null
  try {
    const r = await fetch(
      `${PAYFORGE_BASE}/pix/charges/${encodeURIComponent(id)}`,
      { headers: payforgeHeaders(publicKey, secretKey) }
    )
    return r.ok ? await r.json() : null
  } catch {
    return null
  }
}
