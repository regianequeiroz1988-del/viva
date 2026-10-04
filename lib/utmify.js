// Integração com a UTMify (API de Pedidos) — usada SOMENTE pelo backend (/api).
// Envia os pedidos para a UTMify rastrear conversões/vendas e atribuí-las às
// campanhas (UTMs). O token fica no servidor; NUNCA vai para o navegador.
//
// De onde vem o token (nesta ordem):
//   1) process.env.UTMIFY_API_TOKEN                    (reconhecido na Vercel)
//   2) tabela `configuracoes`, chave `utmify_api_token`  (campo no /admin → Configurações)
//
// O passo 2 precisa de SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY na Vercel.
// Docs UTMify: POST https://api.utmify.com.br/api-credentials/orders  (header x-api-token)

const UTMIFY_ORDERS_URL = 'https://api.utmify.com.br/api-credentials/orders'

const onlyDigits = (v) => String(v || '').replace(/\D/g, '')
const toCents = (v) => Math.round(Number(v || 0) * 100)

// Lê o token salvo no /admin (tabela configuracoes) usando a service_role.
async function tokenDoBanco() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const srk = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !srk) return ''
  try {
    const r = await fetch(
      `${url}/rest/v1/configuracoes?chave=eq.utmify_api_token&select=valor`,
      { headers: { apikey: srk, Authorization: `Bearer ${srk}` } }
    )
    if (!r.ok) return ''
    const rows = await r.json()
    return rows?.[0]?.valor || ''
  } catch {
    return ''
  }
}

/** Token da UTMify (env tem prioridade sobre o que foi salvo no /admin). */
export async function getUtmifyToken() {
  return process.env.UTMIFY_API_TOKEN || (await tokenDoBanco())
}

// Lê a lista de CPFs/e-mails de teste (config utmify_test_cpfs). Compras desses
// compradores vão pra UTMify como isTest:true → não contam nas métricas.
async function listaTeste() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const srk = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !srk) return []
  try {
    const r = await fetch(
      `${url}/rest/v1/configuracoes?chave=eq.utmify_test_cpfs&select=valor`,
      { headers: { apikey: srk, Authorization: `Bearer ${srk}` } }
    )
    if (!r.ok) return []
    const rows = await r.json()
    return String(rows?.[0]?.valor || '').split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean)
  } catch {
    return []
  }
}

// O comprador está na lista de teste? (CPF ou e-mail) → UTMify recebe isTest:true.
function ehCompradorTeste(customer, lista) {
  if (!Array.isArray(lista) || lista.length === 0) return false
  const cpf = onlyDigits(customer?.cpf)
  const email = String(customer?.email || '').trim().toLowerCase()
  return lista.some((item) => {
    const it = String(item).trim().toLowerCase()
    if (!it) return false
    const dig = it.replace(/\D/g, '')
    return (dig.length === 11 && dig === cpf) || (it.includes('@') && it === email)
  })
}

// O comprador é ADMIN? (profiles.is_admin = true, casando por e-mail OU CPF).
// Compras do admin NÃO vão pra UTMify (nem pendente, nem paga) — permite testar a
// gateway recebedora sem sujar o painel do gestor. Checagem no banco (não confia no front).
async function ehAdmin(customer) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const srk = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !srk) return false
  const email = String(customer?.email || '').trim().toLowerCase()
  const cpf = onlyDigits(customer?.cpf)
  if (!email && !cpf) return false
  try {
    // Admins são poucos — busca todos e compara em JS (evita filtro or() complexo).
    const r = await fetch(
      `${url}/rest/v1/profiles?is_admin=is.true&select=email,cpf`,
      { headers: { apikey: srk, Authorization: `Bearer ${srk}` } }
    )
    if (!r.ok) return false
    const rows = await r.json().catch(() => [])
    if (!Array.isArray(rows)) return false
    return rows.some((p) => {
      const pe = String(p.email || '').trim().toLowerCase()
      const pc = onlyDigits(p.cpf)
      return (email && pe && pe === email) || (cpf && pc && pc === cpf)
    })
  } catch {
    return false
  }
}

// Data no formato exigido pela UTMify: "YYYY-MM-DD HH:MM:SS" em UTC.
export function utmifyDate(d) {
  const date = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(date.getTime())) return null
  const p = (n) => String(n).padStart(2, '0')
  return (
    `${date.getUTCFullYear()}-${p(date.getUTCMonth() + 1)}-${p(date.getUTCDate())} ` +
    `${p(date.getUTCHours())}:${p(date.getUTCMinutes())}:${p(date.getUTCSeconds())}`
  )
}

// Normaliza as UTMs no formato do campo trackingParameters (null quando ausente).
function tracking(utm = {}) {
  const g = (k) => (utm?.[k] != null && utm[k] !== '' ? String(utm[k]) : null)
  return {
    src: g('src'),
    sck: g('sck'),
    utm_source: g('utm_source'),
    utm_campaign: g('utm_campaign'),
    utm_medium: g('utm_medium'),
    utm_content: g('utm_content'),
    utm_term: g('utm_term'),
  }
}

/**
 * Monta o corpo de um pedido para a API da UTMify.
 * @param {object} o
 *   orderId    - id único do pedido (o MESMO em waiting_payment e paid)
 *   status     - 'waiting_payment' | 'paid'
 *   total      - valor total em REAIS
 *   createdAt  - Date/string da criação do pedido
 *   approvedAt - Date/string da aprovação (só quando paid)
 *   customer   - { name, email, cpf, phone }
 *   items      - [{ id?, title, qty, price }]  (price em REAIS)
 *   utm        - { utm_source, utm_medium, ... }
 */
export function buildUtmifyOrder(o) {
  const items = Array.isArray(o.items) ? o.items : []
  const products = items.map((it, i) => ({
    id: String(it.id || it.code || `item-${i}`),
    name: String(it.title || 'Título Viva Sorte'),
    planId: null,
    planName: null,
    quantity: Number(it.qty) || 1,
    priceInCents: toCents(it.price),
  }))
  const totalInCents = toCents(o.total)
  return {
    orderId: String(o.orderId),
    platform: 'VivaSortePlus',
    paymentMethod: 'pix',
    status: o.status,
    createdAt: utmifyDate(o.createdAt || new Date()),
    approvedDate: o.status === 'paid' ? utmifyDate(o.approvedAt || new Date()) : null,
    refundedAt: null,
    customer: {
      name: String(o.customer?.name || 'Cliente Viva Sorte'),
      email: String(o.customer?.email || ''),
      phone: onlyDigits(o.customer?.phone) || null,
      document: onlyDigits(o.customer?.cpf) || null,
      country: 'BR',
      // A UTMify EXIGE customer.ip não-nulo (rejeita com 400 SCHEMA_VALIDATION_FAILED).
      // Usa o IP real do comprador quando temos; senão, um placeholder aceito pela API.
      ip: o.customer?.ip || '0.0.0.0',
    },
    products,
    trackingParameters: tracking(o.utm),
    commission: {
      totalPriceInCents: totalInCents,
      gatewayFeeInCents: 0,
      userCommissionInCents: totalInCents,
      currency: 'BRL',
    },
    isTest: o.isTest === true,
  }
}

/**
 * Envia um pedido para a UTMify. NÃO lança erro (fire-and-forget defensivo):
 * se a UTMify estiver fora do ar ou sem token, apenas devolve { ok:false } sem
 * quebrar o fluxo de pagamento. Sempre dê `await` antes de responder a request
 * (em serverless a função pode ser congelada após o res).
 */
export async function sendUtmifyOrder(o) {
  try {
    const token = await getUtmifyToken()
    if (!token) return { ok: false, skipped: 'sem-token' }
    if (!o?.orderId) return { ok: false, skipped: 'sem-orderId' }

    // Compra da conta do ADMIN: não envia NADA pra UTMify (nem pendente, nem paga).
    if (await ehAdmin(o.customer)) return { ok: false, skipped: 'admin' }

    // Compras de CPFs/e-mails de teste vão como isTest (não contam nas métricas).
    const isTest = o.isTest === true || ehCompradorTeste(o.customer, await listaTeste())

    const r = await fetch(UTMIFY_ORDERS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-token': token },
      body: JSON.stringify(buildUtmifyOrder({ ...o, isTest })),
    })
    if (!r.ok) {
      const error = await r.text().catch(() => '')
      return { ok: false, status: r.status, error }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e?.message || String(e) }
  }
}

/**
 * Busca o cliente do pedido (profiles via service_role) e envia o evento "paid"
 * à UTMify. A IDEMPOTÊNCIA é responsabilidade de quem chama: envie só na
 * TRANSIÇÃO pendente→pago (PATCH com status=neq.pago + return=representation),
 * pra não duplicar a venda quando o webhook é reentregue ou o polling corre junto.
 */
export async function enviarVendaPaga(pedido) {
  if (!pedido?.id) return { ok: false, skipped: 'sem-pedido' }
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const srk = process.env.SUPABASE_SERVICE_ROLE_KEY
  let customer = {}
  if (url && srk && pedido.user_id) {
    try {
      const r = await fetch(
        `${url}/rest/v1/profiles?id=eq.${encodeURIComponent(pedido.user_id)}&select=nome,email,cpf,telefone`,
        { headers: { apikey: srk, Authorization: `Bearer ${srk}` } }
      )
      const rows = await r.json().catch(() => [])
      const p = Array.isArray(rows) ? rows[0] : null
      if (p) customer = { name: p.nome, email: p.email, cpf: p.cpf, phone: p.telefone }
    } catch {
      /* segue sem dados do cliente */
    }
  }
  return sendUtmifyOrder({
    orderId: pedido.id,
    status: 'paid',
    total: pedido.total,
    createdAt: pedido.created_at,
    approvedAt: new Date(),
    customer: { ...customer, ip: pedido.ip || null },
    items: Array.isArray(pedido.itens) ? pedido.itens : [],
    utm: pedido.utm || {},
  })
}

/**
 * DIAGNÓSTICO: testa o token DE VERDADE contra a API da UTMify, fazendo um POST
 * real de um pedido de TESTE (isTest:true → não conta nas métricas) e devolvendo
 * o que a UTMify respondeu. Serve pra distinguir os 3 casos:
 *   - { hasToken:false }            → token não está salvo (env nem /admin)
 *   - { ok:false, status:401, ... } → token EXISTE mas é INVÁLIDO/expirado
 *   - { ok:true, status:200 }       → token funciona (o bug está noutro lugar)
 */
export async function pingUtmify() {
  const token = await getUtmifyToken()
  if (!token) return { ok: false, hasToken: false, skipped: 'sem-token' }
  const tokenLen = String(token).length
  try {
    const now = new Date()
    const r = await fetch(UTMIFY_ORDERS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-token': token },
      body: JSON.stringify(
        buildUtmifyOrder({
          orderId: `ping-${now.getTime()}`,
          status: 'waiting_payment',
          total: 1,
          createdAt: now,
          customer: { name: 'Teste UTMify', email: 'teste@vivasorte.com.br' },
          items: [{ id: 'ping', title: 'Teste de token', qty: 1, price: 1 }],
          utm: {},
          isTest: true, // diagnóstico não deve contar nas métricas da UTMify
        })
      ),
    })
    const body = await r.text().catch(() => '')
    return { ok: r.ok, hasToken: true, tokenLen, status: r.status, body: String(body).slice(0, 600) }
  } catch (e) {
    return { ok: false, hasToken: true, tokenLen, error: e?.message || String(e) }
  }
}
