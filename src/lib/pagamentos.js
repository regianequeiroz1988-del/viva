// Cliente do front para falar com as funções serverless do Pagar.me (/api).
// Em produção (Vercel) essas rotas existem; em dev/preview sem chaves elas
// não respondem, então caímos num "modo demonstração" para visualizar a tela.

import { supabase, isSupabaseConfigured } from './supabase.js'

const onlyDigits = (v) => String(v || '').replace(/\D/g, '')
const demoPermitido = import.meta.env?.DEV === true

// Gateways suportados, em ordem canônica (define a prioridade do rodízio).
export const GATEWAYS = ['umbrella', 'payforge', 'pagarme']

// Só os gateways suportados — evita montar caminho arbitrário em /api/<gw>/...
const gw = (g) => (GATEWAYS.includes(g) ? g : 'pagarme')

async function cabecalhoDeSessao() {
  if (!isSupabaseConfigured) return {}
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/**
 * Monta a lista ordenada do rodízio a partir das configs do /admin.
 * - `ativo`: gateway principal (começa por ele).
 * - `rodizioCsv`: lista CSV das gates que participam (ex.: 'payforge,pagarme').
 * Retorna a lista deduplicada, começando pelo gateway ativo. Se o rodízio estiver
 * vazio, devolve só o gateway ativo (comportamento antigo, sem failover).
 */
export function montarRodizio(ativo, rodizioCsv) {
  const a = gw(ativo)
  let lista = String(rodizioCsv || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => GATEWAYS.includes(s))
  // Dedup preservando ordem
  lista = [...new Set(lista)]
  if (lista.length === 0) return [a]
  if (!lista.includes(a)) lista.unshift(a)
  // Rotaciona para começar pelo gateway ativo
  const i = lista.indexOf(a)
  return [...lista.slice(i), ...lista.slice(0, i)]
}

/**
 * Cria uma cobrança Pix no gateway ativo ('pagarme' | 'medusapay').
 * payload: { pedidoId, amount (R$), items:[{title,qty,price}], descricao?:{sorteios,numeros}, customer:{name,email,cpf,phone} }
 * retorno: { qrCode, qrCodeUrl, expiresAt, chargeId, orderId, gateway, demo? }
 */
export async function criarPagamentoPix(payload, gateway = 'pagarme') {
  const g = gw(gateway)
  try {
    const authHeader = await cabecalhoDeSessao()
    const r = await fetch(`/api/${g}/pix`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader },
      body: JSON.stringify({
        ...payload,
        amount: Math.round(Number(payload.amount) * 100), // centavos
        customer: {
          ...payload.customer,
          cpf: onlyDigits(payload.customer?.cpf),
          phone: onlyDigits(payload.customer?.phone),
        },
      }),
    })
    // Rota inexistente / não-JSON (dev/preview, ou ainda não deployada) → demo
    const ct = r.headers.get('content-type') || ''
    if ((r.status === 404 || !ct.includes('application/json')) && demoPermitido) {
      return { ...demoPix(payload), gateway: g }
    }
    if (!ct.includes('application/json')) {
      const erro = new Error('A resposta do pagamento foi interrompida. Confira o pedido antes de tentar novamente.')
      erro.stopFailover = true
      throw erro
    }
    if (!r.ok) {
      // Mensagem SEMPRE limpa (nunca JSON cru). Lê o corpo e extrai só a mensagem,
      // inclusive quando vem aninhada no detail (resposta crua do gateway).
      const raw = await r.text().catch(() => '')
      let msg = raw
      let stopFailover = false
      try {
        const j = JSON.parse(raw)
        const e = j?.error ?? j?.message ?? j?.detail?.message ?? j?.detail?.error
        msg = Array.isArray(e) ? e.join(' • ') : (e || '')
        stopFailover = j?.stopFailover === true
      } catch {
        /* não era JSON — mantém o texto */
      }
      if (/m[íi]nim/i.test(msg)) {
        msg = 'O valor mínimo para pagamento via Pix é R$ 5,00. Adicione mais números para continuar.'
      } else if (!msg || /^\s*[[{]/.test(msg)) {
        // Vazio ou JSON que sobrou → mensagem genérica amigável.
        msg = 'Não foi possível gerar o Pix agora. Tente novamente em alguns minutos.'
      }
      const erro = new Error(msg)
      erro.stopFailover = stopFailover
      throw erro
    }
    return { gateway: g, ...(await r.json()) }
  } catch (err) {
    // Sem rede / backend (dev/preview): devolve um Pix de demonstração
    if (String(err.message || '').includes('Failed to fetch')) {
      if (demoPermitido) return { ...demoPix(payload), gateway: g }
      const erro = new Error('A conexão caiu durante a criação do Pix. Confira o pedido antes de tentar novamente.')
      erro.stopFailover = true
      throw erro
    }
    throw err
  }
}

/**
 * Cria o Pix percorrendo a lista de gateways do rodízio a partir de `startIndex`,
 * em LOOP, até uma gate conseguir gerar. Usado para o failover automático: se a
 * adquirente de uma gate recusa a criação (ex.: teto de valor no Pix), tenta a próxima.
 * retorno: { ...pix, gateway, gatewayIndex } — gatewayIndex = posição na lista que funcionou.
 * Lança o último erro se NENHUMA gate conseguir gerar.
 */
export async function criarPagamentoPixFailover(payload, gateways, startIndex = 0) {
  const lista = Array.isArray(gateways) && gateways.length ? gateways : ['pagarme']
  let ultimoErro
  for (let k = 0; k < lista.length; k++) {
    const idx = (startIndex + k) % lista.length
    try {
      const pix = await criarPagamentoPix(payload, lista[idx])
      return { ...pix, gateway: pix.gateway || gw(lista[idx]), gatewayIndex: idx }
    } catch (err) {
      ultimoErro = err
      if (err?.stopFailover) throw err
      // gate falhou ao gerar — segue para a próxima do rodízio
    }
  }
  throw ultimoErro || new Error('Não foi possível gerar o Pix em nenhum gateway no momento.')
}

/**
 * Consulta o status de um pedido (pago | pendente | falhou) no gateway informado.
 * Tenta o endpoint serverless (que checa no gateway e atualiza o banco).
 */
export async function consultarStatusPedido(pedidoId, gateway = 'pagarme') {
  try {
    const authHeader = await cabecalhoDeSessao()
    const r = await fetch(`/api/${gw(gateway)}/status?pedidoId=` + encodeURIComponent(pedidoId), { headers: authHeader })
    if (!r.ok) return { status: 'pendente' }
    return await r.json()
  } catch {
    return { status: 'pendente' }
  }
}

// ---- modo demonstração (apenas para visualizar a tela sem o Pagar.me) -------
function demoPix(payload) {
  const valor = Number(payload.amount).toFixed(2)
  // "copia e cola" fictício só para exibição (NÃO é um Pix válido)
  const code =
    '00020126580014br.gov.bcb.pix0136viva-sorte-demo-' +
    (payload.pedidoId || 'demo') +
    '520400005303986540' +
    valor +
    '5802BR5909VIVASORTE6009SAO PAULO62070503***6304DEMO'
  return {
    demo: true,
    qrCode: code,
    qrCodeUrl: '', // sem imagem em modo demo (mostra placeholder)
    expiresAt: Date.now() + 30 * 60 * 1000,
    chargeId: 'demo',
    orderId: 'demo',
  }
}
