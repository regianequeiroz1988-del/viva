// Handlers da UmbrellaPag, servidos pelo dispatcher api/umbrella/[action].js.

import { sendUtmifyOrder, enviarVendaPaga } from './utmify.js'
import { enviarEmailPedido } from './email.js'
import { montarPersistenciaPix, validarSaidaPix, urlWebhookPublica } from './pedido-pix.js'
import { validarPedidoPix } from './pedido-auth.js'
import { registrarTentativaPix, autorizarConsultaPix, buscarVinculoPix, confirmarPersistenciaPagamento } from './pix-tentativas.js'
import {
  UMBRELLA_BASE, credenciaisUmbrella, umbrellaHeaders, extrairPixUmbrella,
  umbrellaPago, extrairE2eUmbrella, buscarTransacaoUmbrella,
} from './umbrella.js'
import { geolocalizarIp } from './geoip.js'

const GATEWAY = 'umbrella'
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

function pedidoDaTransacao(tx) {
  try {
    const m = typeof tx?.metadata === 'string' ? JSON.parse(tx.metadata) : tx?.metadata
    return String(m?.pedidoId || '')
  } catch {
    return ''
  }
}

const valorConfere = (tx, registradoCentavos) => {
  const reg = Number(registradoCentavos)
  return Number.isFinite(reg) && reg > 0 && Math.round(Number(tx?.amount)) === reg
}

async function marcarPago(url, srk, pedidoId, tx, confirmadoPor) {
  const e2e = extrairE2eUmbrella(tx)
  const up = await fetch(`${url}/rest/v1/pedidos?id=eq.${encodeURIComponent(pedidoId)}&status=eq.pendente`, {
    method: 'PATCH',
    headers: { ...supaHeaders(srk), 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ status: 'pago', confirmado_por: confirmadoPor, ...(e2e ? { pix_e2e: e2e } : {}) }),
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

// ─── POST /api/umbrella/pix ─────────────────────────────────────────────────────
export async function pixHandler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { apiKey, webhookSecret } = await credenciaisUmbrella()
  if (!apiKey) {
    return res.status(500).json({ error: 'Chave da Umbrella não configurada (defina em /admin → Gateway de pagamento).' })
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
    const totalCentavos = Math.round(Number(pedidoAutorizado.totalCentavos ?? amount))

    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || String(req.headers['x-real-ip'] || '')
    const { cidade, uf } = await geolocalizarIp(ip)

    const nomes = Array.isArray(descricao?.sorteios) && descricao.sorteios.length
      ? [...new Set(descricao.sorteios)].join(' • ')
      : (items[0]?.product?.name || items[0]?.title || 'Sorteio')
    const titulo = ('COMPRA SORTEIO VIVA SORTE+ - ' + nomes).slice(0, 120)

    const body = {
      amount: totalCentavos,
      currency: 'BRL',
      paymentMethod: 'PIX',
      installments: 1,
      customer: {
        name: customer.name || 'Cliente',
        email: customer.email || `${customer.cpf}@cliente.vivasorte.app`,
        document: { number: String(customer.cpf || ''), type: 'CPF' },
        phone: String(customer.phone || ''),
        externalRef: String(pedidoId),
      },
      // Um item só, com o total: a soma dos itens precisa bater com o amount.
      items: [{ title: titulo, unitPrice: totalCentavos, quantity: 1, tangible: false, externalRef: String(pedidoId) }],
      pix: { expiresInDays: 1 },
      postbackUrl: urlWebhookPublica('/api/umbrella/webhook', webhookSecret),
      metadata: JSON.stringify({ pedidoId: String(pedidoId) }),
      traceable: false,
      ...(ip ? { ip } : {}),
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

    const r = await fetch(`${UMBRELLA_BASE}/user/transactions`, {
      method: 'POST',
      headers: umbrellaHeaders(apiKey),
      body: JSON.stringify(body),
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok || (data?.status && Number(data.status) >= 400)) {
      console.log('[Umbrella pix] criacao REJEITADA — status:', r.status, '| resposta:', JSON.stringify(data).slice(0, 1200))
      return res.status(502).json({ error: data?.message || 'Erro ao criar transação na Umbrella' })
    }

    const px = extrairPixUmbrella(data)
    const trintaMin = Date.now() + 30 * 60 * 1000
    const out = {
      orderId: px.id,
      chargeId: px.id,
      qrCode: px.qrCode,
      qrCodeUrl: px.qrCodeUrl,
      expiresAt: Math.min(px.expiresAt || trintaMin, trintaMin),
      gateway: GATEWAY,
    }
    if (!px.qrCode) console.log('[Umbrella pix] resposta sem copia-e-cola — keys:', Object.keys(data?.data || data || {}).join(','))
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
      error: e.message || 'Falha ao gerar Pix (Umbrella)',
      ...(e.stopFailover ? { stopFailover: true } : {}),
    })
  }
}

// ─── GET /api/umbrella/status?pedidoId=… ────────────────────────────────────────
export async function statusHandler(req, res) {
  const pedidoId = req.query?.pedidoId
  if (!pedidoId) return res.status(400).json({ error: 'pedidoId obrigatório' })

  try {
    const { pedido, tentativa, url, serviceKey: srk } = await autorizarConsultaPix(req, pedidoId, GATEWAY)

    if (pedido?.status === 'pago') {
      if (pedido.metodo === 'deposito' && !pedido.creditado) await creditarDeposito(url, srk, pedidoId)
      return res.status(200).json({ status: 'pago' })
    }

    const txId = tentativa?.charge_id
    const { apiKey } = await credenciaisUmbrella()
    if (apiKey && txId) {
      const tx = await buscarTransacaoUmbrella(txId, apiKey)
      const dono = pedidoDaTransacao(tx)
      const confirmado = tx
        && String(tx.id) === String(txId)
        && umbrellaPago(tx)
        && valorConfere(tx, tentativa.valor_centavos)
        && (!dono || dono === String(pedido.id))
      if (confirmado) {
        if (url && srk) await marcarPago(url, srk, pedidoId, tx, 'polling')
        return res.status(200).json({ status: 'pago' })
      }
    }

    return res.status(200).json({ status: pedido?.status || 'pendente' })
  } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ error: e.message })
    return res.status(503).json({ status: 'pendente' })
  }
}

// ─── POST /api/umbrella/webhook ─────────────────────────────────────────────────
export async function webhookHandler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { apiKey, webhookSecret } = await credenciaisUmbrella()
  if (webhookSecret && req.query?.secret !== webhookSecret) {
    console.log('[Umbrella webhook] 401 — secret inválido.')
    return res.status(401).json({ error: 'unauthorized' })
  }

  const evt = req.body || {}
  const txId = String(evt.objectId || evt.data?.id || evt.id || '').trim()
  console.log('[Umbrella webhook] recebido — txId:', txId, '| body.status:', evt.data?.status ?? evt.status ?? '?')
  if (!txId || !apiKey) return res.status(503).json({ error: 'Não foi possível confirmar a transação agora.' })

  try {
    // O body não é assinado: só a reconsulta autenticada decide se está pago.
    const tx = await buscarTransacaoUmbrella(txId, apiKey)
    if (!tx) return res.status(503).json({ error: 'Não foi possível reconsultar a transação agora.' })
    if (!umbrellaPago(tx)) return res.status(200).json({ received: true })

    const { pedido, tentativa, url, serviceKey: srk } = await buscarVinculoPix(GATEWAY, txId)
    const dono = pedidoDaTransacao(tx)
    if (!valorConfere(tx, tentativa.valor_centavos) || (dono && dono !== String(pedido?.id || ''))) {
      return res.status(200).json({ received: true })
    }
    if (url && srk) await marcarPago(url, srk, pedido.id, tx, 'webhook')
    return res.status(200).json({ received: true })
  } catch (e) {
    console.log('[Umbrella webhook] erro:', e.message)
    if (e.statusCode === 404 || e.statusCode === 409) return res.status(200).json({ received: true })
    return res.status(503).json({ error: 'Falha temporária ao confirmar a transação.' })
  }
}

// ─── GET /api/umbrella/health — testa a chave ──────────────────────────────────
export async function healthHandler(req, res) {
  try {
    const { apiKey } = await credenciaisUmbrella()
    if (!apiKey) return res.status(200).json({ hasSecret: false, ok: false, message: 'Chave da Umbrella não configurada.' })

    let status = 0
    try {
      const r = await fetch(`${UMBRELLA_BASE}/user/sellers`, { headers: umbrellaHeaders(apiKey) })
      status = r.status
    } catch {
      status = 0
    }
    const ok = status === 200
    const message = ok
      ? 'Chave válida e conta acessível ✓.'
      : status === 401 || status === 403
        ? `Chave inválida ou sem permissão (${status}). Confira a chave no /admin.`
        : status === 0
          ? 'Não foi possível falar com a Umbrella (rede). Tente novamente.'
          : `Resposta inesperada da Umbrella (status ${status}).`
    return res.status(200).json({ hasSecret: true, ok, message, probe: { path: '/user/sellers', status } })
  } catch (e) {
    return res.status(200).json({ ok: false, message: e.message || 'Falha no diagnóstico.' })
  }
}
