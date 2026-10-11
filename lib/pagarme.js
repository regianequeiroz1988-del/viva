// Credenciais do Pagar.me — lidas do /admin (tabela `configuracoes` no Supabase)
// OU das variáveis de ambiente da Vercel. Mesmo padrão das outras gates: permite
// configurar a chave pelo /admin sem depender de env var na Vercel.
//  - Config tem PRIORIDADE; env é fallback.
//  - As chaves de config terminam em '_key' de propósito: a RLS (config_leitura_publica)
//    só oculta chaves que terminam em '%key'/'%token', então elas NÃO vazam pro navegador.

export const PAGARME_BASE = 'https://api.pagar.me/core/v5'

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

// Credenciais do Pagar.me. Config (banco/admin) tem prioridade; env é fallback.
export async function credenciaisPagarme() {
  const [dbSecret, dbWebhook] = await Promise.all([
    lerConfig('pagarme_secret_key'),
    lerConfig('pagarme_webhook_key'),
  ])
  const secretKey = String(dbSecret || process.env.PAGARME_SECRET_KEY || '').trim()
  const webhookSecret = String(dbWebhook || process.env.PAGARME_WEBHOOK_SECRET || '').trim()
  return { secretKey, webhookSecret }
}

// Header de auth Basic do Pagar.me a partir da secret key.
export const pagarmeAuth = (secretKey) =>
  'Basic ' + Buffer.from(String(secretKey || '') + ':').toString('base64')
