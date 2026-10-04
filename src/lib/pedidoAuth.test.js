import test from 'node:test'
import assert from 'node:assert/strict'
import { validarPedidoPix } from '../../lib/pedido-auth.js'
import { precificarPedido } from '../../lib/pedido-catalogo.js'

const agoraTeste = Date.now()
const snapshot = {
  updated_at: new Date(agoraTeste).toISOString(),
  raffles: [{
    uuid: 'principal-1',
    edition: '26/07/2026',
    title: 'Viva Sorte',
    price: 1.04,
    kind: 'MAIN',
    category: { slug: 'viva-sorte' },
    thumbnail: '/principal.webp',
    drawDate: new Date(agoraTeste + 24 * 60 * 60 * 1000).toISOString(),
  }],
}

test('valida dono, valor e usa dados canônicos do pedido para gerar o Pix', async () => {
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
    id: 'pedido-1',
    user_id: 'usuario-1',
    total: '10.40',
    status: 'pendente',
    metodo: 'pix',
    itens: [{ id: 'hero-0', title: 'Nome recebido', qty: 10, price: 1.04, numeros: 10, edition: '26/07/2026' }],
    utm: { utm_source: 'origem-salva' },
    pagador: { nome: 'Cliente', cpf: '123', whatsapp_optin: true },
  }

  let pedidoSelado = null
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes('/auth/v1/user')) {
      return { ok: true, json: async () => ({ id: 'usuario-1' }) }
    }
    if (String(url).includes('/rest/v1/configuracoes')) {
      return { ok: true, json: async () => [{ valor: JSON.stringify(snapshot) }] }
    }
    if (String(url).includes('/rest/v1/profiles')) {
      return {
        ok: true,
        json: async () => [{
          nome: 'Nome do perfil',
          cpf: '12345678901',
          email: 'perfil@example.com',
          telefone: '21999998888',
        }],
      }
    }
    if (options.method === 'PATCH') {
      pedidoSelado = JSON.parse(options.body)
      return { ok: true, json: async () => [{ id: pedido.id }] }
    }
    return { ok: true, json: async () => [pedido] }
  }

  try {
    const resultado = await validarPedidoPix(
      { headers: { authorization: 'Bearer sessao-valida' } },
      'pedido-1',
      { amount: 1040, metodo: 'pix' },
    )
    assert.equal(resultado.usuario.id, 'usuario-1')
    assert.equal(resultado.totalCentavos, 1040)
    assert.equal(pedidoSelado.pagador.whatsapp_optin, undefined)
    assert.deepEqual(resultado.descricao, { sorteios: ['Viva Sorte'], numeros: 10 })
    assert.equal(resultado.utm.utm_source, 'origem-salva')
    assert.equal(pedidoSelado.itens[0].title, 'Viva Sorte')
    assert.equal(Object.hasOwn(pedidoSelado.itens[0], 'image'), false)
    assert.equal(pedidoSelado.pagador.nome, 'Nome do perfil')
    assert.equal(pedidoSelado.pagador.cpf, '12345678901')
    await assert.rejects(
      () => validarPedidoPix(
        { headers: { authorization: 'Bearer sessao-valida' } },
        'pedido-1',
        { amount: 1000, metodo: 'pix' },
      ),
      (erro) => erro.statusCode === 400,
    )
    await assert.rejects(
      () => validarPedidoPix({ headers: {} }, 'pedido-1', { amount: 1040, metodo: 'pix' }),
      (erro) => erro.statusCode === 401,
    )
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

test('admin pode gerar Pix para pedido de cliente usando dados do cliente', async () => {
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
    id: 'pedido-admin-1',
    user_id: 'cliente-1',
    total: '10.40',
    status: 'pendente',
    metodo: 'pix',
    itens: [{ id: 'hero-0', title: 'Nome recebido', qty: 10, price: 1.04, numeros: 10, edition: '26/07/2026' }],
    pagador: { nome: 'Snapshot antigo', cpf: '000' },
    pix_gerado_at: '2026-07-26T14:00:00Z',
  }

  let pedidoSelado = null
  globalThis.fetch = async (url, options = {}) => {
    const endereco = String(url)
    if (endereco.includes('/auth/v1/user')) {
      return { ok: true, json: async () => ({ id: 'admin-1', email: 'admin@example.com' }) }
    }
    if (endereco.includes('/rest/v1/configuracoes')) {
      return { ok: true, json: async () => [{ valor: JSON.stringify(snapshot) }] }
    }
    if (endereco.includes('/rest/v1/profiles') && endereco.includes('id=eq.admin-1')) {
      return { ok: true, json: async () => [{ is_admin: true }] }
    }
    if (endereco.includes('/rest/v1/profiles') && endereco.includes('id=eq.cliente-1')) {
      return {
        ok: true,
        json: async () => [{
          nome: 'Cliente Real',
          cpf: '98765432100',
          email: 'cliente@example.com',
          telefone: '21988887777',
        }],
      }
    }
    if (options.method === 'PATCH') {
      pedidoSelado = JSON.parse(options.body)
      return { ok: true, json: async () => [{ id: pedido.id }] }
    }
    return { ok: true, json: async () => [pedido] }
  }

  try {
    const resultado = await validarPedidoPix(
      { headers: { authorization: 'Bearer sessao-admin' } },
      'pedido-admin-1',
      { amount: 1040, metodo: 'pix' },
    )
    assert.equal(resultado.usuario.id, 'admin-1')
    assert.equal(resultado.pagador.nome, 'Cliente Real')
    assert.equal(resultado.pagador.email, 'cliente@example.com')
    assert.equal(resultado.pagador.cpf, '98765432100')
    assert.equal(pedidoSelado.pagador.nome, 'Cliente Real')
    assert.equal(resultado.regenerar, true)
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
test('recusa preço adulterado e números inflados mesmo quando o total da linha parece válido', () => {
  assert.throws(
    () => precificarPedido({
      total: 10.40,
      metodo: 'pix',
      itens: [{ id: 'hero-0', edition: '26/07/2026', qty: 100, price: 0.104, numeros: 100 }],
    }, snapshot),
    (erro) => erro.statusCode === 400 && /preço/.test(erro.message),
  )

  assert.throws(
    () => precificarPedido({
      total: 10.40,
      metodo: 'pix',
      itens: [{ id: 'hero-0', edition: '26/07/2026', qty: 10, price: 1.04, numeros: 1000 }],
    }, snapshot),
    (erro) => erro.statusCode === 400 && /números/.test(erro.message),
  )
})

test('aceita apenas a oferta adicional canônica e junto de um sorteio', () => {
  const resultado = precificarPedido({
    total: 19.39,
    metodo: 'pix',
    itens: [
      { id: 'hero-0', edition: '26/07/2026', qty: 10, price: 1.04, numeros: 10 },
      { id: 'upsell-dia-da-sorte', qty: 1, price: 8.99, numeros: 20 },
    ],
  }, snapshot)

  assert.equal(resultado.totalCentavos, 1939)
  assert.equal(resultado.descricao.numeros, 30)
  assert.throws(
    () => precificarPedido({
      total: 8.99,
      metodo: 'pix',
      itens: [{ id: 'upsell-dia-da-sorte', qty: 1, price: 8.99, numeros: 20 }],
    }, snapshot),
    (erro) => erro.statusCode === 400,
  )
})

test('vincula hero pela edição e raffle por UUID ou edição, rejeitando referências divergentes', () => {
  const snap = {
    updated_at: snapshot.updated_at,
    raffles: [
      ...snapshot.raffles,
      {
        uuid: 'diario-1',
        edition: 'D-77',
        title: 'Viva Sorte do Dia',
        price: 0.05,
        thumbnail: '/dia.webp',
        drawDate: new Date(agoraTeste + 24 * 60 * 60 * 1000).toISOString(),
      },
    ],
  }
  for (const item of [
    { id: 'hero-2', edition: '26/07/2026', qty: 1, price: 1.04, numeros: 1 },
    { id: 'raffle-diario-1', edition: 'D-77', qty: 1, price: 0.05, numeros: 1 },
    { id: 'raffle-D-77', edition: 'D-77', qty: 1, price: 0.05, numeros: 1 },
  ]) {
    const total = item.price
    const resultado = precificarPedido({ total, metodo: 'pix', itens: [item] }, snap)
    assert.equal(resultado.items[0].title, item.id.startsWith('hero-') ? 'Viva Sorte' : 'Viva Sorte do Dia')
  }

  for (const item of [
    { id: 'sorteio-diario-1', edition: 'D-77', qty: 1, price: 0.05, numeros: 1 },
    { id: 'raffle-desconhecido', edition: 'D-77', qty: 1, price: 0.05, numeros: 1 },
    { id: 'raffle-diario-1', edition: 'OUTRA', qty: 1, price: 0.05, numeros: 1 },
  ]) {
    assert.throws(
      () => precificarPedido({ total: item.price, metodo: 'pix', itens: [item] }, snap),
      (erro) => erro.statusCode === 400,
    )
  }
  assert.throws(
    () => precificarPedido({ total: 1.04, metodo: 'pix', itens: [{ id: 'hero-0', edition: '26/07/2026', qty: 1, price: 1.04 }] }, { raffles: [] }),
    (erro) => erro.statusCode === 503,
  )
})

test('aceita snapshot antigo quando o sorteio segue válido e recusa sorteio perto do encerramento', () => {
  const pedido = {
    total: 1.04,
    metodo: 'pix',
    itens: [{ id: 'hero-0', edition: '26/07/2026', qty: 1, price: 1.04, numeros: 1 }],
  }
  const antigo = precificarPedido(pedido, {
    ...snapshot,
    updated_at: new Date(agoraTeste - 24 * 60 * 60 * 1000).toISOString(),
  }, { agora: agoraTeste })
  assert.equal(antigo.totalCentavos, 104)
  assert.throws(
    () => precificarPedido(pedido, {
      ...snapshot,
      raffles: [{ ...snapshot.raffles[0], drawDate: new Date(agoraTeste + 29 * 60 * 1000).toISOString() }],
    }, { agora: agoraTeste }),
    (erro) => erro.statusCode === 400,
  )
})

test('rejeita quantidades zero, decimais ou acima do limite e upsell duplicado', () => {
  for (const qty of [0, 1.5, 1_000_001]) {
    assert.throws(
      () => precificarPedido({
        total: 1.04,
        metodo: 'pix',
        itens: [{ id: 'hero-0', edition: '26/07/2026', qty, price: 1.04, numeros: qty }],
      }, snapshot),
      (erro) => erro.statusCode === 400,
    )
  }
  assert.throws(
    () => precificarPedido({
      total: 19.03,
      metodo: 'pix',
      itens: [
        { id: 'hero-0', edition: '26/07/2026', qty: 1, price: 1.04, numeros: 1 },
        { id: 'upsell-dia-da-sorte', qty: 1, price: 8.99, numeros: 20 },
        { id: 'upsell-dia-da-sorte', qty: 1, price: 8.99, numeros: 20 },
      ],
    }, snapshot),
    (erro) => erro.statusCode === 400,
  )
})
