const UPSELL_ID = 'upsell-dia-da-sorte'
const UPSELL_PRECO_CENTAVOS = 899
const UPSELL_NUMEROS = 20
const MAX_ITENS = 100
const MAX_QUANTIDADE = 1_000_000
const MARGEM_SORTEIO_MS = 30 * 60 * 1000

const falhar = (statusCode, mensagem) => {
  const erro = new Error(mensagem)
  erro.statusCode = statusCode
  throw erro
}

const emCentavos = (valor) => Math.round(Number(valor) * 100)
const inteiroPositivo = (valor) => typeof valor === 'number' && Number.isSafeInteger(valor) && valor > 0
const ehPrincipal = (sorteio) => sorteio?.category?.slug === 'viva-sorte' || sorteio?.kind === 'MAIN'

const instanteRaffle = (valor) => {
  const texto = String(valor || '').trim()
  if (!texto) return NaN
  const normalizado = texto.includes('T') ? texto : `${texto.replace(' ', 'T')}Z`
  return new Date(normalizado).getTime()
}

function validarSnapshot(snapshot, agora = Date.now()) {
  const atualizadoEm = new Date(snapshot?.updated_at || '').getTime()
  if (!Array.isArray(snapshot?.raffles) || snapshot.raffles.length === 0) {
    falhar(503, 'O catálogo de sorteios está indisponível.')
  }
  if (!Number.isFinite(atualizadoEm)
      || atualizadoEm > agora + 5 * 60 * 1000) {
    falhar(503, 'O catálogo de sorteios está desatualizado. Atualize os sorteios no admin.')
  }
}

function encontrarSorteio(item, sorteios) {
  const id = String(item?.id || '')
  const edicao = String(item?.edition || '')

  if (/^hero-\d+$/.test(id)) {
    return sorteios.find((sorteio) => ehPrincipal(sorteio) && String(sorteio?.edition || '') === edicao)
  }

  if (/^raffle-.+$/.test(id)) {
    const referencia = id.slice('raffle-'.length)
    const sorteio = sorteios.find((candidato) =>
      String(candidato?.uuid || '') === referencia || String(candidato?.edition || '') === referencia
    )
    if (!sorteio) return null
    if (edicao && String(sorteio?.edition || '') !== edicao) return null
    return sorteio
  }

  return null
}

export async function carregarCatalogoPedido(url, serviceKey) {
  const resposta = await fetch(
    `${url}/rest/v1/configuracoes?chave=eq.sorteios_snapshot&select=valor`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
  )
  if (!resposta.ok) falhar(503, 'Não foi possível conferir os preços agora. Tente novamente em instantes.')

  const linhas = await resposta.json().catch(() => [])
  const valor = Array.isArray(linhas) ? linhas[0]?.valor : null
  let snapshot = valor
  if (typeof valor === 'string') {
    try {
      snapshot = JSON.parse(valor)
    } catch {
      snapshot = null
    }
  }
  validarSnapshot(snapshot)
  return snapshot
}

export function precificarPedido(pedido, snapshot, { agora = Date.now() } = {}) {
  const itensRecebidos = Array.isArray(pedido?.itens) ? pedido.itens : []
  const totalPedidoCentavos = emCentavos(pedido?.total)
  if (!Number.isSafeInteger(totalPedidoCentavos) || totalPedidoCentavos <= 0) {
    falhar(400, 'Valor do pedido inválido.')
  }

  if (pedido?.metodo === 'deposito') {
    const item = itensRecebidos[0]
    const depositoValido = itensRecebidos.length === 1
      && item?.tipo === 'deposito'
      && Number(item?.qty) === 1
      && emCentavos(item?.price) === totalPedidoCentavos
      && totalPedidoCentavos >= 500
    if (!depositoValido) falhar(400, 'Os dados do depósito não conferem.')
    return {
      totalCentavos: totalPedidoCentavos,
      items: [{ id: 'deposito', title: 'Depósito de créditos', qty: 1, price: totalPedidoCentavos / 100, numeros: 0, tipo: 'deposito' }],
      descricao: { sorteios: ['Depósito de créditos na carteira'], numeros: 0 },
    }
  }

  if (pedido?.metodo !== 'pix') falhar(400, 'Método de pagamento inválido para gerar Pix.')
  if (itensRecebidos.length === 0 || itensRecebidos.length > MAX_ITENS) falhar(400, 'Itens do pedido inválidos.')

  validarSnapshot(snapshot, agora)
  const sorteios = snapshot.raffles

  let totalCalculado = 0
  let quantidadeSorteios = 0
  let encontrouUpsell = false
  const items = []

  for (const item of itensRecebidos) {
    const id = String(item?.id || '')
    if (id === UPSELL_ID) {
      const numeros = item?.numeros
      const valido = !encontrouUpsell
        && Number(item?.qty) === 1
        && typeof item?.qty === 'number'
        && typeof item?.price === 'number'
        && typeof numeros === 'number'
        && emCentavos(item?.price) === UPSELL_PRECO_CENTAVOS
        && numeros === UPSELL_NUMEROS
      if (!valido) falhar(400, 'A oferta adicional do pedido é inválida.')
      encontrouUpsell = true
      totalCalculado += UPSELL_PRECO_CENTAVOS
      items.push({
        id: UPSELL_ID,
        title: 'Hoje é seu dia de sorte 🍀',
        qty: 1,
        price: UPSELL_PRECO_CENTAVOS / 100,
        numeros: UPSELL_NUMEROS,
      })
      continue
    }

    if (!inteiroPositivo(item?.qty) || Number(item.qty) > MAX_QUANTIDADE) {
      falhar(400, 'A quantidade de títulos é inválida.')
    }
    const quantidade = item.qty
    const numeros = item?.numeros == null ? quantidade : item.numeros
    if (typeof item?.price !== 'number' || typeof numeros !== 'number'
        || !Number.isSafeInteger(numeros) || numeros !== quantidade) {
      falhar(400, 'A quantidade de números não confere com os títulos.')
    }

    const sorteio = encontrarSorteio(item, sorteios)
    if (!sorteio) falhar(400, 'Um dos sorteios não está mais disponível. Atualize o carrinho.')
    const sorteioEm = instanteRaffle(sorteio.drawDate)
    if (!Number.isFinite(sorteioEm) || sorteioEm <= agora + MARGEM_SORTEIO_MS) {
      falhar(400, 'Um dos sorteios já encerrou ou está perto do encerramento. Atualize o carrinho.')
    }
    const precoCentavos = emCentavos(sorteio.price)
    if (!Number.isSafeInteger(precoCentavos) || precoCentavos <= 0) {
      falhar(503, 'O preço de um dos sorteios está indisponível.')
    }
    if (emCentavos(item?.price) !== precoCentavos) {
      falhar(400, 'O preço de um dos sorteios mudou. Atualize o carrinho.')
    }

    const subtotal = precoCentavos * quantidade
    if (!Number.isSafeInteger(subtotal) || !Number.isSafeInteger(totalCalculado + subtotal)) {
      falhar(400, 'O total do pedido é inválido.')
    }
    totalCalculado += subtotal
    quantidadeSorteios += 1
    items.push({
      id,
      title: sorteio.title || 'Título Viva Sorte',
      qty: quantidade,
      price: precoCentavos / 100,
      numeros: quantidade,
      edition: String(sorteio.edition || ''),
    })
  }

  if (quantidadeSorteios === 0) falhar(400, 'A oferta adicional precisa acompanhar um sorteio.')
  if (totalCalculado !== totalPedidoCentavos) {
    falhar(400, 'O total do pedido não confere com os preços atuais.')
  }

  return {
    totalCentavos: totalCalculado,
    items,
    descricao: {
      sorteios: [...new Set(items.map((item) => item.title).filter(Boolean))],
      numeros: items.reduce((total, item) => total + (Number(item.numeros) || 0), 0),
    },
  }
}
