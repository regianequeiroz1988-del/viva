// Handlers da PayForge, consolidados em UM módulo para o dispatcher api/payforge/[action].js.
// Motivo: a Vercel (plano Hobby) limita a 12 Serverless Functions por deployment.

import { sendUtmifyOrder, enviarVendaPaga, pingUtmify } from './utmify.js'
import { enviarEmailPedido } from './email.js'
import { montarPersistenciaPix, validarSaidaPix, urlWebhookPublica } from './pedido-pix.js'
import { validarPedidoPix } from './pedido-auth.js'
import { registrarTentativaPix, autorizarConsultaPix, buscarVinculoPix, confirmarPersistenciaPagamento } from './pix-tentativas.js'
import {
  PAYFORGE_BASE, valorMinimoPayforge, credenciaisPayforge, payforgeHeaders,
  extrairPixPayforge, extrairBancoPayforge, payforgePago, buscarTransacaoPayforge,
} from './payforge.js'
import { geolocalizarIp } from './geoip.js'

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
      headers: { apikey: srk, Authorization: `Bearer ${srk}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
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

function acharTxId(evt) {
  const cands = [
    evt?.transaction?.id, evt?.data?.transaction?.id, evt?.data?.id,
    evt?.data?.transactionId, evt?.transactionId, evt?.objectId, evt?.id,
    // API nova: o evento gira em torno da "charge".
    evt?.data?.chargeId, evt?.data?.charge_id, evt?.chargeId, evt?.charge_id,
    evt?.charge?.id, evt?.data?.charge?.id,
  ]
  for (const c of cands) {
    if (c != null && String(c).trim()) return String(c).trim()
  }
  return ''
}

function centavosPayforge(tx) {
  const direto = tx?.amount_cents ?? tx?.amountCents
  if (direto != null && Number.isFinite(Number(direto))) return Math.round(Number(direto))
  const reais = tx?.amount ?? tx?.value ?? tx?.total
  return Number.isFinite(Number(reais)) ? Math.round(Number(reais) * 100) : NaN
}

// Confere o valor pago. A PayForge manda VÁRIOS campos de valor: `amount` pode vir
// LÍQUIDO (já com a taxa descontada), enquanto `originalAmount`/`chargeAmount` são o
// BRUTO (o que o cliente pagou = o que registramos). Aceita se QUALQUER campo bater
// com o valor registrado (em centavos), testando tanto como reais quanto como centavos.
function valorConferePayforge(tx, registradoCentavos) {
  const reg = Number(registradoCentavos)
  if (!Number.isFinite(reg) || reg <= 0) return false
  const campos = [tx?.originalAmount, tx?.chargeAmount, tx?.amount, tx?.value, tx?.total, tx?.amount_cents, tx?.amountCents]
  return campos.some((v) => {
    const n = Number(v)
    if (!Number.isFinite(n) || n <= 0) return false
    return Math.round(n) === reg || Math.round(n * 100) === reg
  })
}

// Procura, dentro da resposta do GET /pix/charges/{id} (o formato pode variar:
// {transaction}, {data}, {data:[...]}, {transactions:[...]}, etc.), a transação cujo
// id == txId. Busca em profundidade → robusto a mudança de formato. Devolve a transação
// (objeto com id + status) ou null quando não acha (reconsulta inconclusiva).
function acharTransacaoNaResposta(cd, txId, prof = 0) {
  if (!cd || typeof cd !== 'object' || prof > 4) return null
  const idAqui = cd.id ?? cd.transactionId ?? cd.transaction_id
  if (idAqui != null && String(idAqui) === String(txId) && cd.status != null) return cd
  for (const v of Object.values(cd)) {
    if (Array.isArray(v)) {
      for (const item of v) {
        const achou = acharTransacaoNaResposta(item, txId, prof + 1)
        if (achou) return achou
      }
    } else if (v && typeof v === 'object') {
      const achou = acharTransacaoNaResposta(v, txId, prof + 1)
      if (achou) return achou
    }
  }
  return null
}

// ─── POST /api/payforge/pix — cria a cobrança Pix ───────────────────────────────
export async function pixHandler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { publicKey, secretKey, webhookSecret } = await credenciaisPayforge()
  if (!secretKey || !publicKey) {
    return res.status(500).json({ error: 'Credenciais da PayForge não configuradas (defina em /admin → Gateway de pagamento).' })
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

    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || String(req.headers['x-real-ip'] || '')
    const { cidade, uf } = await geolocalizarIp(ip)

    // Barra o ticket baixo ANTES de chamar a adquirente: ela recusaria com um
    // 502 "Falha na adquirente", mensagem que não diz nada ao comprador.
    const minimoCentavos = await valorMinimoPayforge()
    if (Number(pedidoAutorizado.totalCentavos ?? amount) < minimoCentavos) {
      return res.status(400).json({
        error: `O valor mínimo para pagamento por Pix é R$ ${(minimoCentavos / 100).toFixed(2).replace('.', ',')}. Adicione mais itens ao carrinho.`,
      })
    }

    const valorReais = Number(amount) / 100

    // A API nova não aceita callbackUrl por cobrança: o webhook é registrado uma vez
    // em POST /webhooks. A URL pública fica só para referência do /admin.
    const postbackUrl = urlWebhookPublica('/api/payforge/webhook', webhookSecret)
    void postbackUrl

    // Mapeia itens da compra
    const products = items.map((item) => {
      let p = item.price ?? item.unitPrice
      if (p == null) {
        p = Number(amount) / 100
      } else {
        p = Number(p)
      }
      return {
        id: String(item.product?.id || item.id || 'sorteio'),
        name: ('COMPRA SORTEIO VIVA SORTE+ - ' + String(item.product?.name || item.title || 'Sorteio')).slice(0, 120),
        quantity: Number(item.qty || item.quantity) || 1,
        price: p,
      }
    })

    if (products.length === 0) {
      const nomesSorteios = Array.isArray(descricao.sorteios) && descricao.sorteios.length
        ? [...new Set(descricao.sorteios)].join(' • ').slice(0, 120)
        : 'Sorteios Viva Sorte'
      products.push({
        id: 'sorteio',
        name: ('COMPRA SORTEIO VIVA SORTE+ - ' + nomesSorteios).slice(0, 120),
        quantity: 1,
        price: valorReais,
      })
    }

    // A API nova só aceita amount/description/externalId/expiresInMinutes — não recebe
    // mais dados do cliente nem lista de produtos. O que era `products` vira a descrição.
    const descricaoPix = (
      products.length === 1
        ? products[0].name
        : 'COMPRA SORTEIO VIVA SORTE+ - ' +
          [...new Set(products.map((p) => p.name.replace(/^COMPRA SORTEIO VIVA SORTE\+ - /, '')))].join(' • ')
    ).slice(0, 140)

    const body = {
      amount: valorReais,
      description: descricaoPix,
      externalId: String(pedidoId),
      expiresInMinutes: 30,
    }

    // UTMify ANTES de gerar o Pix: a venda fica trackeada mesmo que a gate recuse
    // a criação (ex.: teto de valor no >R$100). Regerações do rodízio não reenviam.
    if (pedidoId && metodo !== 'deposito' && !regenerar) {
      await sendUtmifyOrder({
        orderId: pedidoId,
        status: 'waiting_payment',
        total: Number(amount) / 100,
        createdAt: new Date(),
        customer: { ...customer, ip },
        items,
        utm,
      })
    }

    const r = await fetch(`${PAYFORGE_BASE}/pix/charges`, {
      method: 'POST',
      headers: payforgeHeaders(publicKey, secretKey),
      body: JSON.stringify(body),
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) {
      // Loga a rejeição COMPLETA da PayForge no servidor (Vercel) pra diagnóstico —
      // inclui o campo "details" com o motivo exato. NÃO devolve a resposta crua ao
      // cliente (pode ecoar o callbackUrl com o ?secret= do webhook): só a mensagem.
      console.log('[PayForge pix] criacao REJEITADA — status:', r.status, '| resposta:', JSON.stringify(data).slice(0, 1200))
      return res.status(502).json({ error: data?.message || data?.error || 'Erro ao criar transação na PayForge' })
    }

    const px = extrairPixPayforge(data)
    const trintaMin = Date.now() + 30 * 60 * 1000
    const out = {
      orderId: px.id,
      chargeId: px.id,
      qrCode: px.qrCode,
      qrCodeUrl: px.qrCodeUrl,
      expiresAt: Math.min(px.expiresAt || trintaMin, trintaMin),
      gateway: 'payforge',
    }
    await registrarTentativaPix({
      pedidoId,
      gateway: 'payforge',
      totalCentavos: pedidoAutorizado.totalCentavos,
      out,
    })
    validarSaidaPix(out)

    const persistenciaPix = montarPersistenciaPix({
      out,
      customer,
    })
    const patchBase = {
      gateway: 'payforge',
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
      error: e.message || 'Falha ao gerar Pix (PayForge)',
      ...(e.stopFailover ? { stopFailover: true } : {}),
    })
  }
}

// ─── GET /api/payforge/status?pedidoId=… — polling de confirmação ───────────────
export async function statusHandler(req, res) {
  const pedidoId = req.query?.pedidoId
  if (!pedidoId) return res.status(400).json({ error: 'pedidoId obrigatório' })

  try {
    const { pedido, tentativa, url, serviceKey: srk } = await autorizarConsultaPix(req, pedidoId, 'payforge')

    if (pedido?.status === 'pago') {
      if (pedido.metodo === 'deposito' && !pedido.creditado) await creditarDeposito(url, srk, pedidoId)
      return res.status(200).json({ status: 'pago' })
    }

    const txId = tentativa?.charge_id
    const { publicKey, secretKey } = await credenciaisPayforge()
    if (secretKey && txId) {
      const cd = await buscarTransacaoPayforge(txId, publicKey, secretKey)
      const tx = acharTransacaoNaResposta(cd, txId) || cd?.transaction || (Array.isArray(cd?.data) ? cd.data[0] : cd?.data) || cd
      const idConfirmado = String(tx?.id ?? tx?.transactionId ?? tx?.transaction_id ?? '')
      const identifier = String(tx?.identifier || tx?.external_reference || tx?.metadata?.pedidoId || '')
      const confirmado = tx
        && idConfirmado === String(txId)
        && payforgePago(tx)
        && valorConferePayforge(tx, tentativa.valor_centavos)
        && (!identifier || identifier === String(pedido.id))
      if (confirmado) {
        if (url && srk) {
          const banco = extrairBancoPayforge(cd)
          const up = await fetch(`${url}/rest/v1/pedidos?id=eq.${encodeURIComponent(pedidoId)}&status=eq.pendente`, {
            method: 'PATCH',
            headers: { ...supaHeaders(srk), 'Content-Type': 'application/json', Prefer: 'return=representation' },
            body: JSON.stringify({
              status: 'pago', confirmado_por: 'polling',
              ...(banco.pix_banco ? { pix_banco: banco.pix_banco } : {}),
              ...(banco.pix_ispb ? { pix_ispb: banco.pix_ispb } : {}),
              ...(banco.pix_e2e ? { pix_e2e: banco.pix_e2e } : {}),
            }),
          })
          const arr2 = await up.json().catch(() => [])
          const row = await confirmarPersistenciaPagamento(up, arr2, { url, serviceKey: srk, pedidoId })
          if (row) {
            if (row.metodo === 'deposito') {
              if (!row.creditado) await creditarDeposito(url, srk, pedidoId)
            } else {
              await enviarVendaPaga(row)
              await enviarEmailPedido(row, 'aprovado').catch(() => {})
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

// ─── POST /api/payforge/webhook — confirma pagamento ────────────────────────────
export async function webhookHandler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { publicKey, secretKey, webhookSecret } = await credenciaisPayforge()
  const evt = req.body || {}

  // ── Validação híbrida: query ?secret=… OU token no body ──
  // Muitos gateways removem query params ao disparar o webhook POST,
  // então validamos também pelo campo "token" que vem no corpo do JSON.
  const queryOk = webhookSecret && req.query?.secret === webhookSecret
  const bodyToken = evt.token || evt.secret || ''
  const bodyOk = webhookSecret && bodyToken === webhookSecret
  if (webhookSecret && !queryOk && !bodyOk) {
    console.log('[PayForge webhook] 401 — token inválido.')
    return res.status(401).json({ error: 'unauthorized' })
  }

  try {
    const txId = acharTxId(evt)
    const bodyTx = evt?.transaction || evt?.data || {}
    console.log('[PayForge webhook] recebido — txId:', txId, '| event:', evt.event || evt.type || '?', '| body.status:', bodyTx?.status ?? '?', '| body.tx.keys:', Object.keys(bodyTx).join(','))

    // O status do body nunca é autoridade. O txId é público para o comprador, então
    // uma confirmação só vale depois da reconsulta autenticada à PayForge.
    let pago = false
    let reconsultaOk = false
    let reconsultaLocalizou = false // a reconsulta ACHOU a transação e leu o status?
    let banco = {}
    let txConfirmada = null
    if (txId && secretKey) {
      try {
        const cd = await buscarTransacaoPayforge(txId, publicKey, secretKey)
        reconsultaOk = Boolean(cd)
        // Acha a transação (id == txId) em QUALQUER formato de resposta (busca profunda).
        const tx = acharTransacaoNaResposta(cd, txId)
        reconsultaLocalizou = Boolean(tx)
        console.log('[PayForge webhook] reconsulta — ok:', reconsultaOk, '| localizou:', reconsultaLocalizou, '| tx.status:', tx?.status ?? '?', '| pagoDetectado:', payforgePago(tx), '| cd.keys:', Object.keys(cd || {}).join(','))
        if (tx && payforgePago(tx)) {
          pago = true
          txConfirmada = tx
          banco = extrairBancoPayforge({ transaction: tx })
          console.log('[PayForge webhook] API confirmou pagamento — txId:', txId)
        }
      } catch (e) {
        console.log('[PayForge webhook] falha ao reconsultar API — erro:', e.message)
      }
    }

    // Fallback: SÓ quando a reconsulta NÃO conseguiu localizar/ler a transação (parse ou
    // API falharam) — NUNCA quando ela achou e disse "não pago". Como o webhook é
    // autêntico (secret válido), confiamos no corpo apenas nesse caso de última instância.
    // (Se a reconsulta localizou a transação e ela não estava paga, respeitamos: não marca.)
    if (!pago && !reconsultaLocalizou && webhookSecret && (queryOk || bodyOk) && payforgePago(bodyTx) && String(bodyTx?.id || '') === String(txId)) {
      pago = true
      txConfirmada = bodyTx
      reconsultaOk = true
      banco = extrairBancoPayforge({ transaction: bodyTx })
      console.log('[PayForge webhook] confirmado pelo corpo autenticado (secret) — txId:', txId)
    }

    if (!txId || !secretKey || !publicKey) {
      return res.status(503).json({ error: 'Não foi possível confirmar a transação agora.' })
    }
    if (!pago) {
      return reconsultaOk
        ? res.status(200).json({ received: true })
        : res.status(503).json({ error: 'Não foi possível reconsultar a transação agora.' })
    }

    if (pago) {
      const { pedido, tentativa, url, serviceKey: srk } = await buscarVinculoPix('payforge', txId)
      if (url && srk) {
        const headers = { apikey: srk, Authorization: `Bearer ${srk}`, 'Content-Type': 'application/json' }
        const identifierConfirmado = String(
          txConfirmada?.identifier || txConfirmada?.external_reference || txConfirmada?.metadata?.pedidoId || ''
        )
        const totalConfere = valorConferePayforge(txConfirmada, tentativa.valor_centavos)
        const identifierConfere = !identifierConfirmado || identifierConfirmado === String(pedido?.id || '')
        if (!totalConfere || !identifierConfere) {
          return res.status(200).json({ received: true })
        }

        const patchBody = JSON.stringify({
          status: 'pago', confirmado_por: 'webhook',
          ...(banco.pix_banco ? { pix_banco: banco.pix_banco } : {}),
          ...(banco.pix_ispb ? { pix_ispb: banco.pix_ispb } : {}),
          ...(banco.pix_e2e ? { pix_e2e: banco.pix_e2e } : {}),
        })

        const r = await fetch(
          `${url}/rest/v1/pedidos?id=eq.${encodeURIComponent(pedido.id)}&status=eq.pendente`,
          { method: 'PATCH', headers: { ...headers, Prefer: 'return=representation' }, body: patchBody }
        )
        const pedidosResposta = await r.json().catch(() => [])
        const pedidos = Array.isArray(pedidosResposta) ? pedidosResposta : []
        await confirmarPersistenciaPagamento(r, pedidos, { url, serviceKey: srk, pedidoId: pedido.id })

        console.log('[PayForge webhook] pedidos atualizados:', pedidos.length)

        for (const p of pedidos) {
          if (p?.metodo === 'deposito') {
            if (!p?.creditado) {
              await fetch(`${url}/rest/v1/rpc/creditar_deposito`, {
                method: 'POST',
                headers: { ...headers, Prefer: 'return=minimal' },
                body: JSON.stringify({ p_pedido: p.id }),
              }).catch(() => {})
            }
            continue
          }
          await enviarVendaPaga(p)
          await enviarEmailPedido(p, 'aprovado').catch(() => {})
        }
      }
    }
    return res.status(200).json({ received: true })
  } catch (e) {
    console.log('[PayForge webhook] erro inesperado:', e.message)
    if (e.statusCode === 404 || e.statusCode === 409) return res.status(200).json({ received: true })
    return res.status(503).json({ error: 'Falha temporária ao confirmar a transação.' })
  }
}

// ─── GET /api/payforge/health — diagnóstico ───────────────────────────────────
export async function healthHandler(req, res) {
  // Diagnóstico do token da UTMify: GET /api/payforge/health?utmify=test
  // Faz um POST de teste (isTest:true) na UTMify e devolve a resposta crua dela.
  if (req.query?.utmify === 'test') {
    return res.status(200).json({ utmify: await pingUtmify() })
  }

  try {
    const { publicKey, secretKey } = await credenciaisPayforge()
    if (!secretKey) {
      const hasEnvKey = !!process.env.PAYFORGE_SECRET_KEY
      const hasSrk = !!process.env.SUPABASE_SERVICE_ROLE_KEY
      const hasSupaUrl = !!(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL)
      return res.status(200).json({
        hasSecret: false,
        ok: false,
        message: `Chave secreta da PayForge não configurada. Debug Vercel: PAYFORGE_SECRET_KEY = ${hasEnvKey ? 'Sim' : 'Não'} | SUPABASE_SERVICE_ROLE_KEY = ${hasSrk ? 'Sim' : 'Não'} | SUPABASE_URL = ${hasSupaUrl ? 'Sim' : 'Não'}.`,
      })
    }

    let status = 0
    try {
      const r = await fetch(`${PAYFORGE_BASE}/balance`, { headers: payforgeHeaders(publicKey, secretKey) })
      status = r.status
    } catch {
      status = 0
    }

    let ok = false
    let message = ''
    if (status === 200) {
      ok = true
      message = 'Chaves válidas e conta acessível ✓.'
    } else if (status === 401 || status === 403) {
      message = 'Chaves inválidas ou sem permissão (' + status + '). Confira a chave pública e a secreta no /admin.'
    } else if (status === 0) {
      message = 'Não foi possível falar com a PayForge (rede). Tente novamente.'
    } else {
      // Se /balance não responder, confirma pelas cobranças: um id inexistente com
      // credencial VÁLIDA devolve 404 (autenticou e não achou); credencial inválida
      // devolveria 401/403. Então 404 aqui também prova que as chaves funcionam.
      let statusTx = 0
      try {
        const rTx = await fetch(`${PAYFORGE_BASE}/pix/charges/dummy`, { headers: payforgeHeaders(publicKey, secretKey) })
        statusTx = rTx.status
      } catch {}

      if (statusTx === 200 || statusTx === 404) {
        ok = true
        message = 'Chaves válidas (verificadas via cobranças) ✓.'
      } else {
        message = 'Não foi possível confirmar (status ' + status + '). Verifique as credenciais no /admin.'
      }
    }

    return res.status(200).json({
      hasSecret: true,
      hasPublic: !!publicKey,
      ok,
      message,
      probe: { path: '/balance', status },
    })
  } catch (e) {
    return res.status(200).json({ ok: false, message: e.message || 'Falha no diagnóstico.' })
  }
}
