const UPSELL_ID = 'upsell-dia-da-sorte'

// Resumo legível do pedido: sorteio(s) comprados + total de números da sorte.
// (Os números ficam dentro do jsonb `itens`: cada item tem `numeros` — qty p/ título,
// 20 p/ a oferta relâmpago. Depósito de carteira não tem números.) Compartilhado entre
// AdminPedidos e AdminUsuarios — mesma leitura dos itens nos dois lugares.
export function resumoPedido(pedido) {
  const arr = Array.isArray(pedido?.itens) ? pedido.itens : []
  if (pedido?.metodo === 'deposito') {
    return { sorteioCurto: 'Depósito de créditos', sorteios: ['Depósito de créditos'], numeros: null }
  }
  const sorteios = arr
    .filter((i) => i && i.id !== UPSELL_ID && i.tipo !== 'deposito')
    .map((i) => i.title)
    .filter(Boolean)
  const numeros = arr.reduce((s, i) => s + (Number(i?.numeros ?? i?.qty) || 0), 0)
  const sorteioCurto = sorteios.length
    ? sorteios[0] + (sorteios.length > 1 ? ` (+${sorteios.length - 1})` : '')
    : '—'
  return { sorteioCurto, sorteios, numeros }
}

// "Voltou": o cliente gerou ou pagou um pedido NOVO depois que a ficha dele já tinha
// sido exportada (pedidos.exportado_at, gravado quando o admin exporta/baixa o .txt).
// Referência = a exportação MAIS RECENTE do cliente (reseta a cada nova exportação).
// "Voltou" = existe pedido CRIADO depois dessa referência (novo Pix = nova atividade;
// como o Pix expira rápido, repagamento de verdade quase sempre gera um pedido novo).
export function calcularExportadoVoltou(historico = []) {
  let exportadoEmMs = 0
  for (const p of historico) {
    if (!p?.exportado || !p?.exportado_at) continue
    const t = new Date(p.exportado_at).getTime()
    if (Number.isFinite(t) && t > exportadoEmMs) exportadoEmMs = t
  }
  if (!exportadoEmMs) return { exportadoEm: null, voltou: false }
  const voltou = historico.some((p) => {
    const t = new Date(p?.created_at || 0).getTime()
    return Number.isFinite(t) && t > exportadoEmMs
  })
  return { exportadoEm: new Date(exportadoEmMs).toISOString(), voltou }
}

const somenteDigitos = (valor) => String(valor || '').replace(/\D/g, '')

// Um CPF identifica a mesma pessoa mesmo se, por algum motivo, ela tiver mais
// de uma conta. Na falta dele, usamos os demais identificadores disponíveis.
export function chaveDoCliente(pedido, perfis = {}) {
  const perfil = perfis[pedido?.user_id] || {}
  const cpf = somenteDigitos(perfil.cpf || pedido?.pagador?.cpf)
  if (cpf) return `cpf:${cpf}`
  if (pedido?.user_id) return `usuario:${pedido.user_id}`

  const email = String(perfil.email || pedido?.pagador?.email || '').trim().toLowerCase()
  if (email) return `email:${email}`

  const telefone = somenteDigitos(perfil.telefone || pedido?.pagador?.telefone)
  if (telefone) return `telefone:${telefone}`

  // Sem nenhum identificador confiável, não juntamos pessoas distintas.
  return pedido?.id ? `pedido:${pedido.id}` : ''
}

const instante = (pedido) => {
  const valor = new Date(pedido?.created_at || 0).getTime()
  return Number.isNaN(valor) ? 0 : valor
}

// Mantém os pedidos reais intactos (webhooks e conciliação dependem de cada
// ID), mas apresenta só um cartão por pessoa: o pedido mais recente recebe o
// resumo e o histórico de todas as tentativas daquele cliente.
export function consolidarPedidosPorCliente(pedidos = [], perfis = {}) {
  const grupos = new Map()

  pedidos.forEach((pedido, indice) => {
    const chave = chaveDoCliente(pedido, perfis) || `sem-identificador:${indice}`
    const grupo = grupos.get(chave) || []
    grupo.push(pedido)
    grupos.set(chave, grupo)
  })

  return [...grupos.entries()]
    .map(([chave, grupo]) => {
      const historico = [...grupo].sort((a, b) => instante(b) - instante(a))
      const maisRecente = historico[0]
      const { exportadoEm, voltou } = calcularExportadoVoltou(historico)
      return {
        ...maisRecente,
        _clienteKey: chave,
        _historico: historico,
        _totalGerados: historico.length,
        _totalPagos: historico.filter((pedido) => pedido.status === 'pago').length,
        _exportadoEm: exportadoEm,
        _voltou: voltou,
      }
    })
    .sort((a, b) => instante(b) - instante(a))
}

// Uma ficha por Pix: cada pedido vira um cartão, com o aviso de "voltou" calculado por pessoa.
export function fichasPorPedido(pedidos = [], perfis = {}) {
  const grupos = new Map()
  pedidos.forEach((pedido) => {
    const chave = chaveDoCliente(pedido, perfis) || `pedido:${pedido.id}`
    grupos.set(chave, [...(grupos.get(chave) || []), pedido])
  })
  const saida = []
  for (const [chave, grupo] of grupos) {
    const { exportadoEm } = calcularExportadoVoltou(grupo)
    const exportadoMs = exportadoEm ? new Date(exportadoEm).getTime() : 0
    for (const pedido of grupo) {
      saida.push({
        ...pedido,
        _clienteKey: chave,
        _historico: [pedido],
        _totalGerados: 1,
        _totalPagos: pedido.status === 'pago' ? 1 : 0,
        _exportadoEm: exportadoEm,
        _voltou: exportadoMs > 0 && instante(pedido) > exportadoMs,
      })
    }
  }
  return saida.sort((a, b) => instante(b) - instante(a))
}
