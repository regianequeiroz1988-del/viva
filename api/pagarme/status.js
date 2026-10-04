// GET /api/pagarme/status?pedidoId=... — consulta o status do pedido.
// Lê o pedido no Supabase; se ainda pendente, confere a charge no Pagar.me e,
// se estiver paga, atualiza o pedido para "pago". Devolve { status }.

import { enviarVendaPaga } from '../../lib/utmify.js'
import { enviarEmailPedido } from '../../lib/email.js'
import { extrairPix, extrairBanco } from '../../lib/bancos.js'
import { credenciaisPagarme, pagarmeAuth } from '../../lib/pagarme.js'
import { autorizarConsultaPix, confirmarPersistenciaPagamento } from '../../lib/pix-tentativas.js'

const supaHeaders = (srk) => ({ apikey: srk, Authorization: `Bearer ${srk}` })

// Credita o saldo de um pedido de DEPÓSITO (idempotente via RPC).
async function creditarDeposito(url, srk, pedidoId) {
  try {
    await fetch(`${url}/rest/v1/rpc/creditar_deposito`, {
      method: 'POST',
      headers: { ...supaHeaders(srk), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ p_pedido: pedidoId }),
    })
  } catch {
    /* não bloqueia a resposta de status */
  }
}

export default async function handler(req, res) {
  const pedidoId = req.query?.pedidoId
  if (!pedidoId) return res.status(400).json({ error: 'pedidoId obrigatório' })

  try {
    const { pedido, tentativa, url, serviceKey: srk } = await autorizarConsultaPix(req, pedidoId, 'pagarme')

    // Já estava pago: nada a (re)enviar — o "paid" foi disparado na transição.
    if (pedido?.status === 'pago') {
      if (pedido.metodo === 'deposito' && !pedido.creditado) await creditarDeposito(url, srk, pedidoId)
      return res.status(200).json({ status: 'pago' })
    }

    const chargeId = tentativa?.charge_id
    const { secretKey: secret } = await credenciaisPagarme()
    if (secret && chargeId) {
      const cr = await fetch(`https://api.pagar.me/core/v5/charges/${encodeURIComponent(chargeId)}`, {
        headers: { Authorization: pagarmeAuth(secret) },
      })
      const cd = await cr.json().catch(() => ({}))
      const status = String(cd.status || '').toLowerCase()
      const orderId = String(cd.order?.id || cd.order_id || '')
      const codigoPedido = String(cd.order?.code || '')
      const confirmado = cr.ok
        && String(cd.id || '') === String(chargeId)
        && (status === 'paid' || status === 'overpaid')
        && String(cd.payment_method || '').toLowerCase() === 'pix'
        && Math.round(Number(cd.amount ?? cd.paid_amount)) === Number(tentativa.valor_centavos)
        && (!tentativa.order_id || orderId === String(tentativa.order_id))
        && (!codigoPedido || codigoPedido === String(pedido.id))
      if (confirmado) {
        if (url && srk) {
          const pix = extrairPix(cd) // E2E/ISPB do pagador da charge
          const banco = extrairBanco(cd) // NOME do banco do pagador (direto da Pagar.me)
          // Transição pendente→pago (status=neq.pago + return=representation): a linha
          // só volta se ESTE request fez a transição → evita corrida/duplicidade com o
          // webhook ao enviar a venda à UTMify.
          const up = await fetch(`${url}/rest/v1/pedidos?id=eq.${encodeURIComponent(pedidoId)}&status=eq.pendente`, {
            method: 'PATCH',
            headers: { ...supaHeaders(srk), 'Content-Type': 'application/json', Prefer: 'return=representation' },
            body: JSON.stringify({
              status: 'pago', confirmado_por: 'polling',
              ...(pix.pix_e2e ? { pix_e2e: pix.pix_e2e, pix_ispb: banco.pix_ispb || pix.pix_ispb } : {}),
              ...(banco.pix_banco ? { pix_banco: banco.pix_banco } : {}),
            }),
          })
          const arr2 = await up.json().catch(() => [])
          const row = await confirmarPersistenciaPagamento(up, arr2, { url, serviceKey: srk, pedidoId })
          if (row) {
            if (row.metodo === 'deposito') {
              if (!row.creditado) await creditarDeposito(url, srk, pedidoId)
            } else {
              await enviarVendaPaga(row) // venda confirmada via polling → UTMify "paid"
              await enviarEmailPedido(row, 'aprovado').catch(() => {}) // e-mail "pedido aprovado"
            }
          }
        }
        return res.status(200).json({ status: 'pago' })
      }
    }

    return res.status(200).json({ status: pedido?.status || 'pendente' })
  } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ error: e.message })
    return res.status(503).json({ status: 'pendente' })
  }
}
