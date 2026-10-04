import { carregarCatalogoPedido, precificarPedido } from './pedido-catalogo.js'

const somenteDigitos = (valor) => String(valor || '').replace(/\D/g, '')

const falhar = (statusCode, mensagem) => {
  const erro = new Error(mensagem)
  erro.statusCode = statusCode
  throw erro
}


async function selarItensDoPedido(url, serviceKey, pedidoId, items, totalCentavos, pagador) {
  const resposta = await fetch(
    `${url}/rest/v1/pedidos?id=eq.${encodeURIComponent(pedidoId)}&status=eq.pendente&select=id`,
    {
      method: 'PATCH',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({ itens: items, total: totalCentavos / 100, pagador }),
    },
  )
  const linhas = await resposta.json().catch(() => [])
  if (!resposta.ok || !Array.isArray(linhas) || linhas[0]?.id !== pedidoId) {
    falhar(409, 'Não foi possível reservar este pedido para pagamento. Atualize a página e tente novamente.')
  }
}

export async function validarPedidoPix(req, pedidoId, { amount, metodo } = {}) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const apiKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || serviceKey
  if (!url || !serviceKey || !apiKey) falhar(500, 'Supabase não configurado no servidor.')
  if (!pedidoId) falhar(400, 'Pedido obrigatório.')

  const authorization = String(req.headers?.authorization || '')
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) falhar(401, 'Sessão necessária para gerar o Pix.')

  const usuarioResposta = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: apiKey, Authorization: `Bearer ${token}` },
  })
  const usuario = await usuarioResposta.json().catch(() => null)
  if (!usuarioResposta.ok || !usuario?.id) falhar(401, 'Sessão inválida ou expirada. Entre novamente.')

  const pedidoResposta = await fetch(
    `${url}/rest/v1/pedidos?id=eq.${encodeURIComponent(pedidoId)}&select=*`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
  )
  const pedidos = await pedidoResposta.json().catch(() => [])
  const pedido = Array.isArray(pedidos) ? pedidos[0] : null
  if (!pedidoResposta.ok || !pedido) falhar(404, 'Pedido não encontrado.')
  const usuarioEhDono = pedido.user_id === usuario.id
  let usuarioEhAdmin = false
  if (!usuarioEhDono) {
    const adminResposta = await fetch(
      `${url}/rest/v1/profiles?id=eq.${encodeURIComponent(usuario.id)}&select=is_admin`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
    )
    const admins = await adminResposta.json().catch(() => [])
    usuarioEhAdmin = adminResposta.ok && Array.isArray(admins) && admins[0]?.is_admin === true
    if (!usuarioEhAdmin) falhar(403, 'Este pedido pertence a outro usuário.')
  }
  if (pedido.status !== 'pendente') falhar(409, 'Este pedido não está mais pendente.')

  const totalCentavos = Math.round(Number(pedido.total) * 100)
  if (!Number.isFinite(totalCentavos) || totalCentavos <= 0) falhar(400, 'Valor do pedido inválido.')
  if (Math.round(Number(amount) || 0) !== totalCentavos) falhar(400, 'O valor informado não confere com o pedido.')
  if (String(metodo || '') !== String(pedido.metodo || '')) falhar(400, 'O método informado não confere com o pedido.')

  const snapshot = pedido.metodo === 'deposito' ? null : await carregarCatalogoPedido(url, serviceKey)
  const { items, descricao, totalCentavos: totalCatalogoCentavos } = precificarPedido(pedido, snapshot)
  if (totalCatalogoCentavos !== totalCentavos) falhar(400, 'O total do pedido não confere com o catálogo.')

  const perfilResposta = await fetch(
    `${url}/rest/v1/profiles?id=eq.${encodeURIComponent(pedido.user_id)}&select=nome,nome_social,cpf,email,telefone`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
  )
  const perfis = await perfilResposta.json().catch(() => [])
  const perfil = Array.isArray(perfis) ? perfis[0] : null
  if (!perfilResposta.ok || !perfil) falhar(409, 'Complete seu cadastro antes de gerar o Pix.')

  const snapshotPagador = pedido.pagador && typeof pedido.pagador === 'object' ? pedido.pagador : {}
  const metadata = usuarioEhDono && usuario.user_metadata && typeof usuario.user_metadata === 'object' ? usuario.user_metadata : {}
  const pagador = {
    ...snapshotPagador,
    nome: perfil.nome_social || perfil.nome || metadata.nome || '',
    cpf: somenteDigitos(perfil.cpf || metadata.cpf),
    email: perfil.email || (usuarioEhDono ? usuario.email : '') || '',
    telefone: somenteDigitos(perfil.telefone || metadata.telefone),
  }
  delete pagador.whatsapp_optin
  delete pagador.whatsapp_optin_at
  delete pagador.whatsapp_optin_versao
  delete pagador.whatsapp_optin_telefone

  await selarItensDoPedido(url, serviceKey, pedido.id, items, totalCentavos, pagador)

  return {
    pedido,
    usuario,
    totalCentavos,
    cpfPagador: somenteDigitos(pagador.cpf),
    pagador,
    items,
    descricao,
    utm: pedido.utm && typeof pedido.utm === 'object' ? pedido.utm : {},
    regenerar: Boolean(pedido.pix_gerado_at || pedido.pagarme_order_id || pedido.pagarme_charge_id || pedido.pagador?.pix_gerado_at || pedido.pagador?.pix_copia_cola),
  }
}
