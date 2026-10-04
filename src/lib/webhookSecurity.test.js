import test from 'node:test'
import assert from 'node:assert/strict'
import pagarmeWebhook from '../../api/pagarme/webhook.js'
import { webhookHandler as payforgeWebhook } from '../../lib/payforge-handlers.js'
import { payforgePago } from '../../lib/payforge.js'

const respostaJson = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
})

function respostaExpress() {
  const saida = { status: 200, body: null }
  return {
    saida,
    res: {
      status(status) {
        saida.status = status
        return this
      },
      json(body) {
        saida.body = body
        return body
      },
    },
  }
}

function guardarEnv(chaves) {
  return Object.fromEntries(chaves.map((chave) => [chave, process.env[chave]]))
}

function restaurarEnv(valores) {
  for (const [chave, valor] of Object.entries(valores)) {
    if (valor === undefined) delete process.env[chave]
    else process.env[chave] = valor
  }
}

test('Pagar.me não aceita charge.paid do body quando a API confirma pendente', async () => {
  const fetchOriginal = globalThis.fetch
  const env = guardarEnv(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'PAGARME_SECRET_KEY', 'PAGARME_WEBHOOK_SECRET'])
  process.env.SUPABASE_URL = 'https://supabase.test'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test'
  process.env.PAGARME_SECRET_KEY = 'sk_test'
  delete process.env.PAGARME_WEBHOOK_SECRET
  const patches = []

  globalThis.fetch = async (url, options = {}) => {
    const endereco = String(url)
    if (endereco.includes('/rest/v1/configuracoes')) return respostaJson([])
    if (endereco.includes('/charges/ch_forjada')) {
      return respostaJson({ id: 'ch_forjada', status: 'pending', payment_method: 'pix', amount: 1000 })
    }
    if (options.method === 'PATCH') patches.push(endereco)
    return respostaJson([])
  }

  try {
    const { res, saida } = respostaExpress()
    await pagarmeWebhook({
      method: 'POST',
      query: {},
      body: { type: 'charge.paid', data: { id: 'ch_forjada', status: 'paid' } },
    }, res)
    assert.equal(saida.status, 200)
    assert.deepEqual(patches, [])
  } finally {
    globalThis.fetch = fetchOriginal
    restaurarEnv(env)
  }
})

test('PayForge não usa status do body nem trata ok como pagamento liquidado', async () => {
  const fetchOriginal = globalThis.fetch
  const env = guardarEnv([
    'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
    'PAYFORGE_PUBLIC_KEY', 'PAYFORGE_SECRET_KEY', 'PAYFORGE_WEBHOOK_SECRET',
  ])
  process.env.SUPABASE_URL = 'https://supabase.test'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test'
  process.env.PAYFORGE_PUBLIC_KEY = 'public-test'
  process.env.PAYFORGE_SECRET_KEY = 'secret-test'
  delete process.env.PAYFORGE_WEBHOOK_SECRET
  const patches = []

  globalThis.fetch = async (url, options = {}) => {
    const endereco = String(url)
    if (endereco.includes('/rest/v1/configuracoes')) return respostaJson([])
    if (endereco.includes('/pix/charges')) {
      return respostaJson({ id: 'tx_forjada', status: 'pending', amount: 10, externalId: 'pedido-1' })
    }
    if (options.method === 'PATCH') patches.push(endereco)
    return respostaJson([])
  }

  try {
    const { res, saida } = respostaExpress()
    await payforgeWebhook({
      method: 'POST',
      query: {},
      body: { transaction: { id: 'tx_forjada', status: 'paid' } },
    }, res)
    assert.equal(saida.status, 200)
    assert.equal(payforgePago({ status: 'ok' }), false)
    assert.deepEqual(patches, [])
  } finally {
    globalThis.fetch = fetchOriginal
    restaurarEnv(env)
  }
})

