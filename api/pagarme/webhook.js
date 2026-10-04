// POST /api/pagarme/webhook — recebe eventos do Pagar.me e marca o pedido como pago.
// Configure no painel Pagar.me a URL: https://SEU-SITE/api/pagarme/webhook
// O segredo compartilhado é uma camada extra. Mesmo sem ele, o evento só é aceito
// depois que a cobrança é reconsultada diretamente na API do Pagar.me.

import { enviarVendaPaga } from '../../lib/utmify.js'
import { enviarEmailPedido } from '../../lib/email.js'
import { extrairPix, extrairBanco, buscarCharge } from '../../lib/bancos.js'
import { credenciaisPagarme } from '../../lib/pagarme.js'
import { buscarVinculoPix, confirmarPersistenciaPagamento } from '../../lib/pix-tentativas.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // Validação opcional por segredo compartilhado (config do /admin OU env)
  const { webhookSecret: expected } = await credenciaisPagarme()
  if (expected && req.query?.secret !== expected) {
    return res.status(401).json({ error: 'unauthorized' })
  }

  try {
    const evt = req.body || {}
    const type = String(evt.type || '')
    const data = evt.data || {}
    if (type !== 'charge.paid' && type !== 'order.paid') {
      return res.status(200).json({ received: true })
    }
    const chargeId = type.startsWith('charge')
      ? data.id
      : (data.charges?.[0]?.id || data.charge?.id)
    if (!chargeId) return res.status(200).json({ received: true })

    // Nunca confia no status do body: o chargeId chega ao navegador depois da criação
    // do Pix e, sem esta reconsulta autenticada, alguém poderia forjar charge.paid.
    const full = await buscarCharge(chargeId)
    if (!full) return res.status(503).json({ error: 'Não foi possível confirmar a cobrança agora.' })
    const statusConfirmado = String(full.status || '').toLowerCase()
    const pago = String(full.id || '') === String(chargeId)
      && (statusConfirmado === 'paid' || statusConfirmado === 'overpaid')
      && String(full.payment_method || '').toLowerCase() === 'pix'

    if (pago) {
      const { pedido, tentativa, url, serviceKey: srk } = await buscarVinculoPix('pagarme', chargeId)
      if (url && srk) {
        const headers = {
          apikey: srk,
          Authorization: `Bearer ${srk}`,
          'Content-Type': 'application/json',
        }
        const totalConfere = Number(tentativa.valor_centavos) === Math.round(Number(full.amount ?? full.paid_amount))
        const fullOrderId = full.order?.id || full.order_id
        const orderConfere = !tentativa.order_id
          || !fullOrderId
          || String(tentativa.order_id) === String(fullOrderId)
        const codigoPedido = String(full.order?.code || '')
        if (!totalConfere || !orderConfere || (codigoPedido && codigoPedido !== String(pedido.id))) {
          return res.status(200).json({ received: true })
        }

        const pix = extrairPix(full)
        const banco = extrairBanco(full)

        // status=neq.pago → o PATCH só devolve as linhas que TRANSITARAM pendente→pago.
        // Assim, se o webhook for reentregue ou o polling (status.js) já tiver confirmado
        // antes, esta chamada devolve [] e não reenvia a venda à UTMify (idempotência).
        const r = await fetch(
          `${url}/rest/v1/pedidos?id=eq.${encodeURIComponent(pedido.id)}&status=eq.pendente`,
          {
          method: 'PATCH',
          headers: { ...headers, Prefer: 'return=representation' },
          body: JSON.stringify({
            status: 'pago', confirmado_por: 'webhook',
            ...(pix.pix_e2e ? { pix_e2e: pix.pix_e2e, pix_ispb: banco.pix_ispb || pix.pix_ispb } : {}),
            ...(banco.pix_banco ? { pix_banco: banco.pix_banco } : {}),
          }),
          }
        )
        const pedidos = await r.json().catch(() => [])
        await confirmarPersistenciaPagamento(r, pedidos, { url, serviceKey: srk, pedidoId: pedido.id })
        for (const p of Array.isArray(pedidos) ? pedidos : []) {
          if (p?.metodo === 'deposito') {
            // Depósito de carteira: credita o saldo e NÃO envia à UTMify (não é venda).
            if (!p?.creditado) {
              await fetch(`${url}/rest/v1/rpc/creditar_deposito`, {
                method: 'POST',
                headers: { ...headers, Prefer: 'return=minimal' },
                body: JSON.stringify({ p_pedido: p.id }),
              }).catch(() => {})
            }
            continue
          }
          // Venda confirmada → UTMify "paid" (mesma orderId do waiting_payment). Não bloqueia.
          await enviarVendaPaga(p)
          // E-mail "pedido aprovado" (não bloqueia)
          await enviarEmailPedido(p, 'aprovado').catch(() => {})
        }
      }
    }

    return res.status(200).json({ received: true })
  } catch (e) {
    if (e.statusCode === 404 || e.statusCode === 409) return res.status(200).json({ received: true })
    // 503 faz o gateway tentar novamente; nunca confirma pelo body em caso de falha.
    return res.status(503).json({ error: 'Falha temporária ao confirmar a cobrança.' })
  }
}
