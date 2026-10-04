// GET /api/pagarme/health — diz ao painel /admin se a integração está pronta.
// NÃO expõe nenhuma chave; só devolve booleanos de "configurado/válido".
import { getUtmifyToken } from '../../lib/utmify.js'
import { credenciaisPagarme, pagarmeAuth } from '../../lib/pagarme.js'

export default async function handler(req, res) {
  // Lê do /admin (config) OU da env — assim o painel reflete as duas formas.
  const { secretKey, webhookSecret } = await credenciaisPagarme()
  const hasSecret = !!secretKey
  const hasService = !!process.env.SUPABASE_SERVICE_ROLE_KEY
  const hasSupaUrl = !!(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL)
  const hasWebhookSecret = !!webhookSecret
  // UTMify: token configurado (env OU /admin)? Não revela o valor, só se existe.
  const hasUtmify = !!(await getUtmifyToken())

  // Valida a chave do Pagar.me com uma chamada leve (lista 1 cliente)
  let pagarmeValid = null
  if (hasSecret) {
    try {
      const r = await fetch('https://api.pagar.me/core/v5/customers?size=1', {
        headers: { Authorization: pagarmeAuth(secretKey) },
      })
      pagarmeValid = r.ok
    } catch {
      pagarmeValid = false
    }
  }

  res.status(200).json({ hasSecret, hasService, hasSupaUrl, hasWebhookSecret, hasUtmify, pagarmeValid })
}
