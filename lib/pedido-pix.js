const dataIso = (valor) => {
  if (!valor) return null
  const numero = Number(valor)
  const data = Number.isFinite(numero) ? new Date(numero) : new Date(valor)
  return Number.isNaN(data.getTime()) ? null : data.toISOString()
}

export function validarSaidaPix(out = {}, agora = Date.now()) {
  const chargeId = String(out.chargeId || out.orderId || '').trim()
  const qrCode = String(out.qrCode || '').trim()
  const expiraEm = Number(out.expiresAt)
  if (!chargeId || !qrCode || !Number.isFinite(expiraEm) || expiraEm <= Number(agora) + 30_000) {
    const erro = new Error('O gateway respondeu sem um Pix utilizável. Aguarde um instante e confira o pedido antes de tentar novamente.')
    erro.statusCode = 502
    // A resposta 2xx pode ter criado uma cobrança mesmo incompleta; não roda outra gate.
    erro.stopFailover = true
    throw erro
  }
  return out
}

export function urlWebhookPublica(caminho, segredo = '') {
  const configurada = process.env.PUBLIC_SITE_URL
    || process.env.SITE_URL
    || process.env.VERCEL_PROJECT_PRODUCTION_URL
    || process.env.VERCEL_URL
    || ''
  if (!configurada) return undefined
  try {
    const origem = /^https?:\/\//i.test(configurada) ? configurada : `https://${configurada}`
    const url = new URL(caminho, origem.endsWith('/') ? origem : `${origem}/`)
    if (segredo) url.searchParams.set('secret', segredo)
    return url.toString()
  } catch {
    return undefined
  }
}

export function montarPersistenciaPix({
  out = {},
  customer = {},
  agora = new Date(),
} = {}) {
  const geradoAt = dataIso(agora) || new Date().toISOString()
  const expiraEm = dataIso(out.expiresAt)
  const pix = String(out.qrCode || '').trim()

  const colunas = {
    pix_copia_cola: pix,
    pix_gerado_at: geradoAt,
    pix_expira_em: expiraEm,
  }

  const pagador = {
    nome: customer.name,
    cpf: customer.cpf,
    email: customer.email,
    telefone: customer.phone,
    pix_copia_cola: pix,
    pix_gerado_at: geradoAt,
    pix_expira_em: expiraEm,
  }

  return { colunas, pagador }
}
