const falhar = (statusCode, mensagem, { stopFailover = false } = {}) => {
  const erro = new Error(mensagem)
  erro.statusCode = statusCode
  erro.stopFailover = stopFailover
  throw erro
}

const ambiente = () => {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const apiKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || serviceKey
  if (!url || !serviceKey || !apiKey) falhar(500, 'Supabase não configurado no servidor.')
  return { url, serviceKey, apiKey }
}

const headersServico = (serviceKey, extra = {}) => ({
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  ...extra,
})

const emCentavos = (valor) => Math.round(Number(valor) * 100)

const paraIsoOuNull = (valor) => {
  if (!valor) return null
  const data = new Date(valor)
  return Number.isNaN(data.getTime()) ? null : data.toISOString()
}

export async function registrarTentativaPix({ pedidoId, gateway, totalCentavos, out = {} }) {
  const { url, serviceKey } = ambiente()
  const chargeId = String(out.chargeId || out.orderId || '').trim()
  const orderId = String(out.orderId || chargeId).trim()
  const valor = Math.round(Number(totalCentavos))
  if (!pedidoId || !gateway || !chargeId || !Number.isSafeInteger(valor) || valor <= 0) {
    falhar(500, 'Não foi possível identificar a tentativa Pix criada.', { stopFailover: true })
  }

  let resposta
  try {
    resposta = await fetch(
      `${url}/rest/v1/pix_tentativas?on_conflict=gateway%2Ccharge_id`,
      {
        method: 'POST',
        headers: headersServico(serviceKey, {
          'Content-Type': 'application/json',
          Prefer: 'resolution=ignore-duplicates,return=minimal',
        }),
        body: JSON.stringify({
          pedido_id: pedidoId,
          gateway,
          order_id: orderId,
          charge_id: chargeId,
          valor_centavos: valor,
          pix_copia_cola: String(out.qrCode || '').trim(),
          pix_expira_em: paraIsoOuNull(out.expiresAt),
        }),
      },
    )
  } catch {
    falhar(503, 'O Pix foi criado, mas não foi possível registrar a tentativa com segurança.', { stopFailover: true })
  }
  if (!resposta.ok) {
    falhar(503, 'O Pix foi criado, mas não foi possível registrar a tentativa com segurança.', { stopFailover: true })
  }

  // Um retry pode encontrar o mesmo charge_id. Não atualizamos a linha existente:
  // apenas aceitamos se ela já estiver vinculada ao mesmo pedido, gateway e valor.
  const filtros = [
    `gateway=eq.${encodeURIComponent(gateway)}`,
    `charge_id=eq.${encodeURIComponent(chargeId)}`,
    'select=pedido_id,gateway,order_id,charge_id,valor_centavos',
  ].join('&')
  let confirmacao
  try {
    confirmacao = await fetch(`${url}/rest/v1/pix_tentativas?${filtros}`, {
      headers: headersServico(serviceKey),
    })
  } catch {
    falhar(503, 'O Pix foi criado, mas o vínculo da tentativa não pôde ser confirmado.', { stopFailover: true })
  }
  const linhas = await confirmacao.json().catch(() => [])
  const tentativa = Array.isArray(linhas) ? linhas[0] : null
  const confere = confirmacao.ok
    && String(tentativa?.pedido_id || '') === String(pedidoId)
    && String(tentativa?.gateway || '') === String(gateway)
    && String(tentativa?.charge_id || '') === chargeId
    && Number(tentativa?.valor_centavos) === valor
    && (!orderId || !tentativa?.order_id || String(tentativa.order_id) === orderId)
  if (!confere) {
    falhar(503, 'O Pix foi criado, mas o vínculo da tentativa não pôde ser confirmado.', { stopFailover: true })
  }
}

async function buscarPedido(url, serviceKey, pedidoId) {
  const resposta = await fetch(
    `${url}/rest/v1/pedidos?id=eq.${encodeURIComponent(pedidoId)}&select=*`,
    { headers: headersServico(serviceKey) },
  )
  if (!resposta.ok) falhar(503, 'Falha temporaria ao consultar o pedido.')
  const linhas = await resposta.json().catch(() => [])
  const pedido = Array.isArray(linhas) ? linhas[0] : null
  if (!pedido) falhar(404, 'Pedido não encontrado.')
  return pedido
}

export async function confirmarPersistenciaPagamento(resposta, linhas, { url, serviceKey, pedidoId }) {
  if (!resposta?.ok) falhar(503, 'Não foi possível salvar a confirmação do pagamento.')
  const atualizados = Array.isArray(linhas) ? linhas : []
  if (atualizados.length > 0) return atualizados[0]

  // Um webhook/polling concorrente pode ter vencido a corrida. Só tratamos a
  // resposta vazia como sucesso quando o banco confirma que o pedido já está pago.
  const atual = await buscarPedido(url, serviceKey, pedidoId)
  if (atual.status !== 'pago') falhar(503, 'O pagamento foi confirmado, mas o pedido ainda não foi atualizado.')
  return null
}

async function buscarTentativa(url, serviceKey, { pedidoId, gateway, chargeId }) {
  const filtros = [
    `gateway=eq.${encodeURIComponent(gateway)}`,
    `charge_id=eq.${encodeURIComponent(chargeId)}`,
    ...(pedidoId ? [`pedido_id=eq.${encodeURIComponent(pedidoId)}`] : []),
    'select=*',
  ].join('&')
  const resposta = await fetch(`${url}/rest/v1/pix_tentativas?${filtros}`, {
    headers: headersServico(serviceKey),
  })
  if (!resposta.ok) falhar(503, 'Falha temporaria ao consultar o vinculo Pix.')
  const linhas = await resposta.json().catch(() => [])
  const tentativa = Array.isArray(linhas) ? linhas[0] : null
  if (!tentativa) falhar(409, 'Esta cobrança não possui vínculo seguro com o pedido.')
  return tentativa
}

function validarVinculo(pedido, tentativa, gateway) {
  if (String(tentativa.pedido_id) !== String(pedido.id)) falhar(409, 'A cobrança pertence a outro pedido.')
  if (String(tentativa.gateway) !== String(gateway)) falhar(409, 'O gateway da cobrança não confere.')
  if (Number(tentativa.valor_centavos) !== emCentavos(pedido.total)) falhar(409, 'O valor da cobrança não confere com o pedido.')
}

export async function autorizarConsultaPix(req, pedidoId, gateway) {
  const { url, serviceKey, apiKey } = ambiente()
  const authorization = String(req.headers?.authorization || '')
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) falhar(401, 'Sessão necessária para consultar o pagamento.')

  const usuarioResposta = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: apiKey, Authorization: `Bearer ${token}` },
  })
  const usuario = await usuarioResposta.json().catch(() => null)
  if (!usuarioResposta.ok || !usuario?.id) falhar(401, 'Sessão inválida ou expirada.')

  const pedido = await buscarPedido(url, serviceKey, pedidoId)
  if (String(pedido.user_id) !== String(usuario.id)) falhar(403, 'Este pedido pertence a outro usuário.')
  if (pedido.status === 'pago') return { pedido, tentativa: null, url, serviceKey }
  if (pedido.status !== 'pendente') falhar(409, 'Este pedido não está mais pendente.')
  if (String(pedido.gateway || '') !== String(gateway)) falhar(409, 'O gateway atual do pedido não confere.')

  const chargeId = String(pedido.pagarme_charge_id || '').trim()
  if (!chargeId) falhar(409, 'O pedido ainda não possui uma cobrança registrada.')
  const tentativa = await buscarTentativa(url, serviceKey, { pedidoId, gateway, chargeId })
  validarVinculo(pedido, tentativa, gateway)
  return { pedido, tentativa, url, serviceKey }
}

export async function buscarVinculoPix(gateway, chargeId) {
  const { url, serviceKey } = ambiente()
  const tentativa = await buscarTentativa(url, serviceKey, { gateway, chargeId })
  const pedido = await buscarPedido(url, serviceKey, tentativa.pedido_id)
  validarVinculo(pedido, tentativa, gateway)
  return { pedido, tentativa, url, serviceKey }
}
