// Envio de WhatsApp pela S-API (self-hosted, na VPS).
// Envs: SAPI_URL (ex.: https://wa.seudominio.com), SAPI_INSTANCE, SAPI_TOKEN,
// SAPI_CLIENT_TOKEN (opcional, se ligou o Client-Token no painel).
const onlyDigits = (v) => String(v || '').replace(/\D/g, '')

export const sapiConfigurada = () => Boolean(process.env.SAPI_URL && process.env.SAPI_INSTANCE && process.env.SAPI_TOKEN)

// Telefone brasileiro → 55DDDNUMERO.
export function telefoneWhats(tel) {
  let d = onlyDigits(tel)
  if (d.startsWith('55') && d.length >= 12) return d
  if (d.length === 10 || d.length === 11) return `55${d}`
  return ''
}

export async function enviarTexto(telefone, mensagem) {
  if (!sapiConfigurada()) return { ok: false, erro: 'S-API não configurada (SAPI_URL/SAPI_INSTANCE/SAPI_TOKEN).' }
  const phone = telefoneWhats(telefone)
  if (!phone) return { ok: false, erro: 'Telefone inválido.' }
  const base = process.env.SAPI_URL.replace(/\/+$/, '')
  const url = `${base}/instances/${encodeURIComponent(process.env.SAPI_INSTANCE)}/token/${encodeURIComponent(process.env.SAPI_TOKEN)}/send-text`
  const headers = { 'Content-Type': 'application/json' }
  if (process.env.SAPI_CLIENT_TOKEN) headers['Client-Token'] = process.env.SAPI_CLIENT_TOKEN
  try {
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ phone, message: mensagem }), signal: AbortSignal.timeout(15000) })
    if (!r.ok) return { ok: false, erro: `S-API ${r.status}: ${(await r.text()).slice(0, 200)}` }
    return { ok: true }
  } catch (e) {
    return { ok: false, erro: e.message }
  }
}
