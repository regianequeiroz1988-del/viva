// POST /api/pagarme/pix — cria uma cobrança Pix no Pagar.me (v5) e devolve o QR.
// Chave secreta: /admin (config pagarme_secret_key) OU env PAGARME_SECRET_KEY (sk_...).
// Para gravar o pedido também usa SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.

import { sendUtmifyOrder } from '../../lib/utmify.js'
import { enviarEmailPedido } from '../../lib/email.js'
import { PAGARME_BASE, credenciaisPagarme, pagarmeAuth } from '../../lib/pagarme.js'
import { montarPersistenciaPix, validarSaidaPix } from '../../lib/pedido-pix.js'
import { validarPedidoPix } from '../../lib/pedido-auth.js'
import { registrarTentativaPix } from '../../lib/pix-tentativas.js'
import { geolocalizarIp } from '../../lib/geoip.js'

const onlyDigits = (v) => String(v || '').replace(/\D/g, '')

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
      headers: {
        apikey: srk,
        Authorization: `Bearer ${srk}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { secretKey } = await credenciaisPagarme()
  if (!secretKey) {
    return res.status(500).json({ error: 'Chave secreta do Pagar.me não configurada (defina em /admin → Gateway de pagamento ou na Vercel).' })
  }

  try {
    const { pedidoId, amount, customer: customerRecebido = {}, metodo } = req.body || {}
    const pedidoAutorizado = await validarPedidoPix(req, pedidoId, { amount, metodo })
    const items = pedidoAutorizado.items
    const descricao = pedidoAutorizado.descricao
    const utm = pedidoAutorizado.utm
    const regenerar = pedidoAutorizado.regenerar
    const customer = {
      ...(customerRecebido || {}),
      name: pedidoAutorizado.pagador.nome || customerRecebido?.name,
      email: pedidoAutorizado.pagador.email || customerRecebido?.email,
      cpf: pedidoAutorizado.pagador.cpf || customerRecebido?.cpf,
      phone: pedidoAutorizado.pagador.telefone || customerRecebido?.phone,
    }

    // Geolocalização aproximada do pagador — headers de geo que a Vercel injeta na
    // requisição (só vêm em produção; no localhost ficam vazios).
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || String(req.headers['x-real-ip'] || '')
    const { cidade, uf } = await geolocalizarIp(ip)

    const phone = onlyDigits(customer.phone)
    const phones =
      phone.length >= 10
        ? { mobile_phone: { country_code: '55', area_code: phone.slice(0, 2), number: phone.slice(2) } }
        : undefined

    const baseItems = items.length ? items : [{ title: 'Títulos Viva Sorte', qty: 1, price: Number(amount) / 100 }]
    const pgItems = baseItems.map((it, i) => {
      const qty = Number(it.qty) || 1
      // Descrição com o nome do sorteio + quantidade (aparece no extrato/app do banco)
      const desc = `${it.title || 'Título Viva Sorte'} (${qty}x)`.slice(0, 64)
      return {
        amount: Math.round(Number(it.price) * 100),
        description: desc,
        quantity: qty,
        code: 'item-' + i,
      }
    })

    // Segurança: o Pagar.me cobra a SOMA dos itens. Se por algum motivo a soma
    // divergir do total esperado (amount em centavos), ajustamos para bater certo.
    const expected = Math.round(Number(amount) || 0)
    const soma = pgItems.reduce((s, it) => s + it.amount * it.quantity, 0)
    if (expected > 0 && soma !== expected) {
      const diff = expected - soma
      if (diff > 0) {
        pgItems.push({ amount: diff, description: 'Oferta adicional', quantity: 1, code: 'item-ajuste' })
      }
    }

    // Descrição do pagamento Pix: nome do sorteio + quantidade de números comprados
    const nomesSorteios = Array.isArray(descricao.sorteios) && descricao.sorteios.length
      ? [...new Set(descricao.sorteios)].join(' • ').slice(0, 64)
      : 'Sorteios Viva Sorte'
    const numerosComprados = Number(descricao.numeros) || baseItems.reduce((s, it) => s + (Number(it.qty) || 0), 0)
    const additionalInfo = [
      { name: 'Sorteio', value: String(nomesSorteios) },
      { name: 'Números da sorte', value: String(numerosComprados) },
    ]

    const body = {
      items: pgItems,
      customer: {
        name: customer.name || 'Cliente Viva Sorte',
        email: customer.email || 'cliente@vivasorte.com.br',
        type: 'individual',
        document: onlyDigits(customer.cpf),
        document_type: 'CPF',
        ...(phones ? { phones } : {}),
      },
      payments: [
        {
          payment_method: 'pix',
          pix: { expires_in: 1800, additional_information: additionalInfo },
        },
      ],
      ...(pedidoId ? { code: String(pedidoId) } : {}),
    }

    // UTMify ANTES de gerar o Pix: a venda fica trackeada mesmo que a gate recuse
    // a criação (ex.: teto de valor no >R$100). Regerações do rodízio não reenviam
    // — a venda pendente já foi registrada na 1ª tentativa desta compra.
    if (pedidoId && metodo !== 'deposito' && !regenerar) {
      await sendUtmifyOrder({
        orderId: pedidoId,
        status: 'waiting_payment',
        total: Number(amount) / 100, // amount chega em centavos; UTMify usa reais
        createdAt: new Date(),
        customer: { ...customer, ip },
        items,
        utm,
      })
    }

    const r = await fetch(`${PAGARME_BASE}/orders`, {
      method: 'POST',
      headers: { Authorization: pagarmeAuth(secretKey), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await r.json()
    if (!r.ok) {
      return res.status(502).json({ error: data?.message || 'Erro ao criar cobrança no Pagar.me', detail: data })
    }

    const charge = data.charges?.[0]
    const tx = charge?.last_transaction || {}
    const out = {
      orderId: data.id,
      chargeId: charge?.id,
      qrCode: tx.qr_code || '',
      qrCodeUrl: tx.qr_code_url || '',
      expiresAt: tx.expires_at ? new Date(tx.expires_at).getTime() : Date.now() + 1800 * 1000,
    }
    await registrarTentativaPix({
      pedidoId,
      gateway: 'pagarme',
      totalCentavos: pedidoAutorizado.totalCentavos,
      out,
    })
    validarSaidaPix(out)

    const persistenciaPix = montarPersistenciaPix({
      out,
      customer,
    })
    const patchBase = {
      gateway: 'pagarme', // no rodízio, garante que o pedido reflita a gate que gerou o Pix
      pagarme_order_id: out.orderId,
      pagarme_charge_id: out.chargeId,
      ...(ip ? { ip } : {}),
      ...(cidade ? { cidade } : {}),
      ...(uf ? { uf } : {}),
    }
    await patchPedido(
      pedidoId,
      { ...patchBase, ...persistenciaPix.colunas },
      { ...patchBase, pagador: persistenciaPix.pagador },
    )

    // UTMify — registra o pedido como "aguardando pagamento" (depósito de carteira
    // não é venda, então fica de fora). Não bloqueia: se falhar, o Pix segue normal.
    // O evento "paid" é enviado depois pelo webhook quando o Pagar.me confirma.
    // E-mail "pedido pendente" — só no sucesso (não manda e-mail de Pix que não gerou).
    if (pedidoId && metodo !== 'deposito' && !regenerar) {
      await enviarEmailPedido(
        { id: pedidoId, total: Number(amount) / 100, created_at: new Date().toISOString(), metodo, pagador: { nome: customer.name, cpf: customer.cpf, email: customer.email } },
        'pendente'
      ).catch(() => {})
    }

    return res.status(200).json(out)
  } catch (e) {
    return res.status(e.statusCode || 500).json({
      error: e.message || 'Falha ao gerar Pix',
      ...(e.stopFailover ? { stopFailover: true } : {}),
    })
  }
}
