import test from 'node:test'
import assert from 'node:assert/strict'
import pagarmeWebhook from '../../api/pagarme/webhook.js'
import { webhookHandler as sharpifyWebhook } from '../../lib/sharpify-handlers.js'
import { sharpifyPago } from '../../lib/sharpify.js'

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

test('Sharpify não usa status do body: só a reconsulta autenticada confirma', async () => {
  const fetchOriginal = globalThis.fetch
  const env = guardarEnv([
    'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
    'SHARPIFY_CLIENT_ID', 'SHARPIFY_CLIENT_SECRET', 'SHARPIFY_WEBHOOK_SECRET',
  ])
  process.env.SUPABASE_URL = 'https://supabase.test'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test'
  process.env.SHARPIFY_CLIENT_ID = 'id-test'
  process.env.SHARPIFY_CLIENT_SECRET = 'secret-test'
  delete process.env.SHARPIFY_WEBHOOK_SECRET
  const patches = []

  globalThis.fetch = async (url, options = {}) => {
    const endereco = String(url)
    if (endereco.includes('/rest/v1/configuracoes')) return respostaJson([])
    if (endereco.includes('get-payment')) {
      return respostaJson({ data: { id: 'link_forjado', status: 'PENDING', pricing: { total: 10 } } })
    }
    if (options.method === 'PATCH') patches.push(endereco)
    return respostaJson([])
  }

  try {
    const { res, saida } = respostaExpress()
    await sharpifyWebhook({
      method: 'POST',
      query: {},
      body: {
        event: { name: 'PAYMENT_LINK_APPROVED', contextId: 'link_forjado' },
        data: { id: 'link_forjado', status: 'APPROVED' },
      },
    }, res)
    assert.equal(saida.status, 200)
    assert.deepEqual(patches, [])
    assert.equal(sharpifyPago({ status: 'ok' }), false)
    assert.equal(sharpifyPago({ status: 'PENDING' }), false)
    assert.equal(sharpifyPago({ status: 'APPROVED' }), true)
  } finally {
    globalThis.fetch = fetchOriginal
    restaurarEnv(env)
  }
})
