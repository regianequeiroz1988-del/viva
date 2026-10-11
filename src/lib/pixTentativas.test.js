import test from 'node:test'
import assert from 'node:assert/strict'
import { autorizarConsultaPix, buscarVinculoPix, registrarTentativaPix } from '../../lib/pix-tentativas.js'

const resposta = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
})

test('status exige sessão e uma tentativa server-side vinculada ao mesmo pedido e valor', async () => {
  const fetchOriginal = globalThis.fetch
  const envOriginal = {
    url: process.env.SUPABASE_URL,
    service: process.env.SUPABASE_SERVICE_ROLE_KEY,
    anon: process.env.SUPABASE_ANON_KEY,
  }
  process.env.SUPABASE_URL = 'https://supabase.test'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test'
  process.env.SUPABASE_ANON_KEY = 'anon-test'

  const pedido = {
    id: 'pedido-b',
    user_id: 'usuario-1',
    status: 'pendente',
    gateway: 'pagarme',
    pagarme_charge_id: 'charge-antiga',
    total: 100,
  }

  try {
    await assert.rejects(
      () => autorizarConsultaPix({ headers: {} }, pedido.id, 'pagarme'),
      (erro) => erro.statusCode === 401,
    )

    globalThis.fetch = async (url) => {
      const endereco = String(url)
      if (endereco.includes('/auth/v1/user')) return resposta({ id: 'usuario-1' })
      if (endereco.includes('/rest/v1/pedidos')) return resposta([pedido])
      if (endereco.includes('/rest/v1/pix_tentativas')) return resposta([])
      return resposta([])
    }
    await assert.rejects(
      () => autorizarConsultaPix(
        { headers: { authorization: 'Bearer sessao-valida' } },
        pedido.id,
        'pagarme',
      ),
      (erro) => erro.statusCode === 409,
    )

    globalThis.fetch = async (url) => {
      const endereco = String(url)
      if (endereco.includes('/auth/v1/user')) return resposta({ id: 'usuario-1' })
      if (endereco.includes('/rest/v1/pedidos')) return resposta([pedido])
      if (endereco.includes('/rest/v1/pix_tentativas')) {
        return resposta([{
          pedido_id: pedido.id,
          gateway: 'pagarme',
          charge_id: 'charge-antiga',
          order_id: 'order-antiga',
          valor_centavos: 10000,
        }])
      }
      return resposta([])
    }
    const autorizado = await autorizarConsultaPix(
      { headers: { authorization: 'Bearer sessao-valida' } },
      pedido.id,
      'pagarme',
    )
    assert.equal(autorizado.tentativa.charge_id, 'charge-antiga')
  } finally {
    globalThis.fetch = fetchOriginal
    if (envOriginal.url === undefined) delete process.env.SUPABASE_URL
    else process.env.SUPABASE_URL = envOriginal.url
    if (envOriginal.service === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY
    else process.env.SUPABASE_SERVICE_ROLE_KEY = envOriginal.service
    if (envOriginal.anon === undefined) delete process.env.SUPABASE_ANON_KEY
    else process.env.SUPABASE_ANON_KEY = envOriginal.anon
  }
})

test('webhook resolve cobrança antiga pela tabela imutável, não pelo charge atual do pedido', async () => {
  const fetchOriginal = globalThis.fetch
  const envOriginal = {
    url: process.env.SUPABASE_URL,
    service: process.env.SUPABASE_SERVICE_ROLE_KEY,
  }
  process.env.SUPABASE_URL = 'https://supabase.test'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test'

  globalThis.fetch = async (url) => {
    const endereco = String(url)
    if (endereco.includes('/rest/v1/pix_tentativas')) {
      return resposta([{
        pedido_id: 'pedido-1',
        gateway: 'pagarme',
        charge_id: 'charge-antiga',
        valor_centavos: 500,
      }])
    }
    if (endereco.includes('/rest/v1/pedidos')) {
      return resposta([{
        id: 'pedido-1',
        total: 5,
        status: 'pendente',
        gateway: 'sharpify',
        pagarme_charge_id: 'charge-mais-recente',
      }])
    }
    return resposta([])
  }

  try {
    const vinculo = await buscarVinculoPix('pagarme', 'charge-antiga')
    assert.equal(vinculo.pedido.id, 'pedido-1')
    assert.equal(vinculo.tentativa.valor_centavos, 500)
  } finally {
    globalThis.fetch = fetchOriginal
    if (envOriginal.url === undefined) delete process.env.SUPABASE_URL
    else process.env.SUPABASE_URL = envOriginal.url
    if (envOriginal.service === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY
    else process.env.SUPABASE_SERVICE_ROLE_KEY = envOriginal.service
  }
})

test('registro de tentativa nunca sobrescreve um charge já vinculado a outro pedido', async () => {
  const fetchOriginal = globalThis.fetch
  const envOriginal = {
    url: process.env.SUPABASE_URL,
    service: process.env.SUPABASE_SERVICE_ROLE_KEY,
  }
  process.env.SUPABASE_URL = 'https://supabase.test'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test'

  let prefer = ''
  globalThis.fetch = async (url, options = {}) => {
    if (options.method === 'POST') {
      prefer = options.headers?.Prefer || ''
      return resposta(null, 201)
    }
    if (String(url).includes('/rest/v1/pix_tentativas')) {
      return resposta([{
        pedido_id: 'outro-pedido',
        gateway: 'pagarme',
        order_id: 'order-1',
        charge_id: 'charge-1',
        valor_centavos: 1000,
      }])
    }
    return resposta([])
  }

  try {
    await assert.rejects(
      () => registrarTentativaPix({
        pedidoId: 'pedido-1',
        gateway: 'pagarme',
        totalCentavos: 1000,
        out: { orderId: 'order-1', chargeId: 'charge-1', qrCode: 'pix' },
      }),
      (erro) => erro.statusCode === 503 && erro.stopFailover === true,
    )
    assert.match(prefer, /ignore-duplicates/)
    assert.doesNotMatch(prefer, /merge-duplicates/)
  } finally {
    globalThis.fetch = fetchOriginal
    if (envOriginal.url === undefined) delete process.env.SUPABASE_URL
    else process.env.SUPABASE_URL = envOriginal.url
    if (envOriginal.service === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY
    else process.env.SUPABASE_SERVICE_ROLE_KEY = envOriginal.service
  }
})
