// Handlers da Sharpify, servidos pelo dispatcher api/sharpify/[action].js.

import { sendUtmifyOrder, enviarVendaPaga } from './utmify.js'
import { enviarEmailPedido } from './email.js'
import { montarPersistenciaPix, validarSaidaPix, urlWebhookPublica } from './pedido-pix.js'
import { validarPedidoPix } from './pedido-auth.js'
import { registrarTentativaPix, autorizarConsultaPix, buscarVinculoPix, confirmarPersistenciaPagamento } from './pix-tentativas.js'
import {
  SHARPIFY_BASE, credenciaisSharpify, sharpifyHeaders, extrairPixSharpify,
  sharpifyPago, totalCentavosSharpify, buscarLinkSharpify,
} from './sharpify.js'
import { geolocalizarIp } from './geoip.js'

const GATEWAY = 'sharpify'
// Piso do Pix no site (R$ 5,00), igual ao das outras gates.
const SHARPIFY_MIN_CENTAVOS = 500
const supaHeaders = (srk) => ({ apikey: srk, Authorization: `Bearer ${srk}` })

async function patchPedido(id, patch, fallbackPatch) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const srk = process.env.SUPABASE_SERVICE_ROLE_KEY
  const falhar = () => {
    const erro = new Error('O Pix foi criado, mas não foi possível vinculá-lo ao pedido. Tente novamente em instantes.')
    erro.statusCode = 503
    erro.stopFailover = true
    throw erro
  }
  if (!url || !srk || !id) falhar()
  const salvar = async (body) => {
    const resposta = await fetch(`${url}/rest/v1/pedidos?id=eq.${encodeURIComponent(id)}&status=eq.pendente&select=id`, {
      method: 'PATCH',
      headers: { ...supaHeaders(srk), 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify(body),
    })
    const linhas = await resposta.json().catch(() => [])
    return resposta.ok && Array.isArray(linhas) && linhas[0]?.id === id
  }
  try {
    if (await salvar(patch)) return
    if (fallbackPatch && await salvar(fallbackPatch)) return
  } catch {
    /* tratado abaixo */
  }
  falhar()
}

async function creditarDeposito(url, srk, pedidoId) {
  try {
    await fetch(`${url}/rest/v1/rpc/creditar_deposito`, {
      method: 'POST',
      headers: { ...supaHeaders(srk), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ p_pedido: pedidoId }),
    })
  } catch {
    /* ignore */
  }
}

const valorConfere = (link, registradoCentavos) => {
  const reg = Number(registradoCentavos)
  return Number.isFinite(reg) && reg > 0 && totalCentavosSharpify(link) === reg
}

async function marcarPago(url, srk, pedidoId, link, confirmadoPor) {
  const up = await fetch(`${url}/rest/v1/pedidos?id=eq.${encodeURIComponent(pedidoId)}&status=eq.pendente`, {
    method: 'PATCH',
    headers: { ...supaHeaders(srk), 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ status: 'pago', confirmado_por: confirmadoPor }),
  })
  const linhas = await up.json().catch(() => [])
  const row = await confirmarPersistenciaPagamento(up, linhas, { url, serviceKey: srk, pedidoId })
  if (!row) return
  if (row.metodo === 'deposito') {
    if (!row.creditado) await creditarDeposito(url, srk, pedidoId)
  } else {
    await enviarVendaPaga(row)
    await enviarEmailPedido(row, 'aprovado').catch(() => {})
  }
}

// ─── POST /api/sharpify/pix ─────────────────────────────────────────────────────
export async function pixHandler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { clientId, clientSecret, webhookSecret } = await credenciaisSharpify()
  if (!clientId || !clientSecret) {
    return res.status(500).json({ error: 'Credenciais da Sharpify não configuradas (defina em /admin → Gateway de pagamento).' })
  }

  try {
    const { pedidoId, amount, customer: customerRecebido = {}, metodo } = req.body || {}
    const pedidoAutorizado = await validarPedidoPix(req, pedidoId, { amount, metodo })
    const { items, descricao, utm, regenerar } = pedidoAutorizado
    const customer = {
      ...(customerRecebido || {}),
      name: pedidoAutorizado.pagador.nome || customerRecebido?.name,
      email: pedidoAutorizado.pagador.email || customerRecebido?.email,
      cpf: pedidoAutorizado.pagador.cpf || customerRecebido?.cpf,
      phone: pedidoAutorizado.pagador.telefone || customerRecebido?.phone,
    }
    const cpf = String(customer.cpf || '').replace(/\D/g, '')
    const telefone = String(customer.phone || '').replace(/\D/g, '')
    if (cpf.length !== 11) {
      return res.status(400).json({ error: 'Seu cadastro está sem CPF. Entre com o seu CPF para comprar.' })
    }
    if (telefone.length < 10 || telefone.length > 11) {
      return res.status(400).json({ error: 'Informe seu telefone com DDD para gerar o Pix.', codigo: 'telefone' })
    }
    const totalCentavos = Math.round(Number(pedidoAutorizado.totalCentavos ?? amount))
    if (totalCentavos < SHARPIFY_MIN_CENTAVOS) {
      return res.status(400).json({ error: 'O valor mínimo para pagamento via Pix é R$ 5,00. Adicione mais números para continuar.' })
    }

    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || String(req.headers['x-real-ip'] || '')
    const { cidade, uf } = await geolocalizarIp(ip)

    const nomes = Array.isArray(descricao?.sorteios) && descricao.sorteios.length
      ? [...new Set(descricao.sorteios)].join(' • ')
      : (items[0]?.product?.name || items[0]?.title || 'Sorteio')
    const titulo = ('COMPRA SORTEIO VIVA SORTE+ - ' + nomes).slice(0, 120)

    const callbackURL = urlWebhookPublica('/api/sharpify/webhook', webhookSecret)
    const body = {
      name: titulo,
      // Sem dados pessoais: o link vai pro gateway só com o identificador do pedido.
      description: `Pedido ${String(pedidoId)}`,
      amount: Number((totalCentavos / 100).toFixed(2)),
      gatewayMethod: 'PIX',
      ...(callbackURL ? { webhook: { callbackURL } } : {}),
    }

    if (pedidoId && metodo !== 'deposito' && !regenerar) {
      await sendUtmifyOrder({
        orderId: pedidoId,
        status: 'waiting_payment',
        total: totalCentavos / 100,
        createdAt: new Date(),
        customer: { ...customer, ip },
        items,
        utm,
      })
    }

    const r = await fetch(`${SHARPIFY_BASE}/api/v1/gateway/payment/create-paymnet`, {
      method: 'POST',
      headers: sharpifyHeaders(clientId, clientSecret),
      body: JSON.stringify(body),
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) {
      console.log('[Sharpify pix] criacao REJEITADA — status:', r.status, '| resposta:', JSON.stringify(data).slice(0, 1200))
      return res.status(502).json({ error: 'Não foi possível gerar o Pix agora. Tente novamente em alguns minutos.' })
    }

    const px = extrairPixSharpify(data)
    if (!px.id) {
      console.log('[Sharpify pix] resposta sem id do link — keys:', Object.keys(data?.data || data || {}).join(','))
      return res.status(502).json({ error: 'Não foi possível gerar o Pix agora. Tente novamente em alguns minutos.' })
    }
    if (!px.qrCode) console.log('[Sharpify pix] resposta sem copia-e-cola — keys:', Object.keys(data?.data || data || {}).join(','))
    const trintaMin = Date.now() + 30 * 60 * 1000
    const out = {
      orderId: px.id,
      chargeId: px.id,
      qrCode: px.qrCode,
      qrCodeUrl: px.qrCodeUrl,
      expiresAt: Math.min(px.expiresAt || trintaMin, trintaMin),
      gateway: GATEWAY,
    }
    await registrarTentativaPix({ pedidoId, gateway: GATEWAY, totalCentavos, out })
    validarSaidaPix(out)

    const persistenciaPix = montarPersistenciaPix({ out, customer })
    const patchBase = {
      gateway: GATEWAY,
      pagarme_order_id: px.id,
      pagarme_charge_id: px.id,
      ...(ip ? { ip } : {}),
      ...(cidade ? { cidade } : {}),
      ...(uf ? { uf } : {}),
    }
    await patchPedido(
      pedidoId,
      { ...patchBase, ...persistenciaPix.colunas },
      { ...patchBase, pagador: persistenciaPix.pagador },
    )

    if (pedidoId && metodo !== 'deposito' && !regenerar) {
      await enviarEmailPedido(
        { id: pedidoId, total: totalCentavos / 100, created_at: new Date().toISOString(), metodo, pagador: { nome: customer.name, cpf: customer.cpf, email: customer.email } },
        'pendente'
      ).catch(() => {})
    }

    return res.status(200).json(out)
  } catch (e) {
    return res.status(e.statusCode || 500).json({
      error: e.message || 'Falha ao gerar Pix (Sharpify)',
      ...(e.stopFailover ? { stopFailover: true } : {}),
    })
  }
}

// ─── GET /api/sharpify/status?pedidoId=… ────────────────────────────────────────
export async function statusHandler(req, res) {
  const pedidoId = req.query?.pedidoId
  if (!pedidoId) return res.status(400).json({ error: 'pedidoId obrigatório' })

  try {
    const { pedido, tentativa, url, serviceKey: srk } = await autorizarConsultaPix(req, pedidoId, GATEWAY)

    if (pedido?.status === 'pago') {
      if (pedido.metodo === 'deposito' && !pedido.creditado) await creditarDeposito(url, srk, pedidoId)
      return res.status(200).json({ status: 'pago' })
    }

    const linkId = tentativa?.charge_id
    const { clientId, clientSecret } = await credenciaisSharpify()
    if (clientId && clientSecret && linkId) {
      const link = await buscarLinkSharpify(linkId, clientId, clientSecret)
      const confirmado = link
        && String(link.id) === String(linkId)
        && sharpifyPago(link)
        && valorConfere(link, tentativa.valor_centavos)
      if (confirmado) {
        if (url && srk) await marcarPago(url, srk, pedidoId, link, 'polling')
        return res.status(200).json({ status: 'pago' })
      }
    }

    return res.status(200).json({ status: pedido?.status || 'pendente' })
  } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ error: e.message })
    return res.status(503).json({ status: 'pendente' })
  }
}

// ─── POST /api/sharpify/webhook ─────────────────────────────────────────────────
export async function webhookHandler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { clientId, clientSecret, webhookSecret } = await credenciaisSharpify()
  if (webhookSecret && req.query?.secret !== webhookSecret) {
    console.log('[Sharpify webhook] 401 — secret inválido.')
    return res.status(401).json({ error: 'unauthorized' })
  }

  const evt = req.body || {}
  const linkId = String(evt.event?.contextId || evt.data?.id || evt.contextId || evt.id || '').trim()
  console.log('[Sharpify webhook] recebido — linkId:', linkId, '| evento:', evt.event?.name ?? '?')
  if (!linkId || !clientId || !clientSecret) return res.status(503).json({ error: 'Não foi possível confirmar a transação agora.' })

  try {
    // O body não é assinado: só a reconsulta autenticada decide se está pago.
    const link = await buscarLinkSharpify(linkId, clientId, clientSecret)
    if (!link) return res.status(503).json({ error: 'Não foi possível reconsultar a transação agora.' })
    if (!sharpifyPago(link)) return res.status(200).json({ received: true })

    const { pedido, tentativa, url, serviceKey: srk } = await buscarVinculoPix(GATEWAY, linkId)
    if (!valorConfere(link, tentativa.valor_centavos)) return res.status(200).json({ received: true })
    if (url && srk) await marcarPago(url, srk, pedido.id, link, 'webhook')
    return res.status(200).json({ received: true })
  } catch (e) {
    console.log('[Sharpify webhook] erro:', e.message)
    if (e.statusCode === 404 || e.statusCode === 409) return res.status(200).json({ received: true })
    return res.status(503).json({ error: 'Falha temporária ao confirmar a transação.' })
  }
}

// ─── GET /api/sharpify/health — testa as credenciais ───────────────────────────
export async function healthHandler(req, res) {
  try {
    const { clientId, clientSecret } = await credenciaisSharpify()
    if (!clientId || !clientSecret) {
      return res.status(200).json({ hasSecret: false, ok: false, message: 'Credenciais da Sharpify não configuradas.' })
    }

    let status = 0
    try {
      // Consulta um link que não existe: a Sharpify só responde 401/403 se as credenciais forem recusadas.
      const r = await fetch(
        `${SHARPIFY_BASE}/api/v1/gateway/payment/get-payment?paymentLinkId=00000000-0000-0000-0000-000000000000`,
        { headers: sharpifyHeaders(clientId, clientSecret) }
      )
      status = r.status
    } catch {
      status = 0
    }
    const recusada = status === 401 || status === 403
    const ok = status > 0 && !recusada
    const message = ok
      ? 'Credenciais aceitas pela Sharpify ✓.'
      : recusada
        ? `Credenciais recusadas pela Sharpify (${status}). Confira o Client ID e o Client Secret no /admin.`
        : 'Não foi possível falar com a Sharpify (rede). Tente novamente.'
    return res.status(200).json({ hasSecret: true, ok, message, probe: { path: '/api/v1/gateway/payment/get-payment', status } })
  } catch (e) {
    return res.status(200).json({ ok: false, message: e.message || 'Falha no diagnóstico.' })
  }
}
