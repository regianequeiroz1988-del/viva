export const DEFAULT_WHATSAPP_COBRANCA_MESSAGE = `Olá, {{nome}}! Tudo bem?

Vimos que você gerou o Pix do pedido #{{pedido}}, no valor de {{valor}}, mas o pagamento ainda não foi confirmado.

Se ainda tiver interesse, é só realizar o pagamento para confirmar sua participação. Vou te enviar o código Pix na próxima mensagem.

Esse Pix é válido até {{expiracao}}. Se você já pagou, desconsidere esta mensagem. Se precisar de ajuda, responda por aqui.`

const somenteDigitos = (valor) => String(valor || '').replace(/\D/g, '')
const valorBooleano = (valor) => valor === true || valor === 'true'
const instante = (valor) => {
  if (!valor) return 0
  const data = new Date(valor)
  const ms = data.getTime()
  return Number.isNaN(ms) ? 0 : ms
}

export function normalizarNumeroWhatsApp(valor) {
  let digitos = somenteDigitos(valor)
  if (digitos.startsWith('00')) digitos = digitos.slice(2)
  if (digitos.length === 10 || digitos.length === 11) digitos = `55${digitos}`
  return /^55[1-9]\d{9,10}$/.test(digitos) ? digitos : ''
}

export function pixDoPedido(pedido) {
  return String(pedido?.pix_copia_cola || pedido?.pagador?.pix_copia_cola || '').trim()
}

export function pixExpiraEm(pedido) {
  return pedido?.pix_expira_em || pedido?.pagador?.pix_expira_em || null
}

export function pixGeradoEm(pedido) {
  return pedido?.pix_gerado_at || pedido?.pagador?.pix_gerado_at || pedido?.created_at || null
}

export function lembreteWhatsappEm(pedido) {
  return pedido?.whatsapp_lembrete_at || pedido?.pagador?.whatsapp_lembrete_at || null
}

export function pixEstaValido(pedido, agora = Date.now()) {
  return Boolean(pixDoPedido(pedido)) && instante(pixExpiraEm(pedido)) > Number(agora)
}

export function avaliarCobrancaWhatsapp(pedido, cliente = {}, config = {}, agora = Date.now()) {
  // O destino vem sempre do telefone cadastrado no perfil consultado pelo admin.
  // O lembrete é um fluxo interno e não depende de confirmação da consulta do cliente.
  const destino = normalizarNumeroWhatsApp(cliente?.telefone)
  const numeroAtendimento = normalizarNumeroWhatsApp(config?.numeroAtendimento)
  const lembreteAt = lembreteWhatsappEm(pedido)
  const expiraEm = pixExpiraEm(pedido)

  const negar = (codigo, motivo, extra = {}) => ({
    ok: false,
    codigo,
    motivo,
    destino,
    numeroAtendimento,
    lembreteAt,
    expiraEm,
    ...extra,
  })

  if (!valorBooleano(config?.ativo)) return negar('config_inativa', 'Ative o lembrete nas Configurações do admin.')
  if (pedido?.status === 'pago') return negar('pedido_pago', 'Este pedido já foi pago.')
  if (pedido?.metodo === 'deposito') return negar('deposito', 'Depósitos de carteira não usam este lembrete.')
  if (!destino) return negar('telefone_invalido', 'O cliente não possui um celular brasileiro válido.')
  if (!pixDoPedido(pedido)) return negar('sem_pix', 'Este pedido não possui um Pix copia e cola salvo.')
  if (instante(expiraEm) <= Number(agora)) return negar('pix_expirado', 'O Pix deste pedido já expirou; um código vencido não será encaminhado.')
  if (instante(expiraEm) <= Number(agora) + 3 * 60 * 1000) {
    return negar('pix_perto_expirar', 'Faltam menos de 3 minutos para este Pix expirar; gere um novo código antes do lembrete.')
  }
  if (lembreteAt) {
    return negar('ja_preparado', 'O lembrete deste pedido já foi preparado.', { podeReabrir: true })
  }

  const esperaMinutos = Math.max(0, Number(config?.esperaMinutos) || 0)
  const disponivelEm = instante(pixGeradoEm(pedido)) + esperaMinutos * 60 * 1000
  if (disponivelEm > Number(agora)) {
    return negar('aguardando', 'Aguarde o tempo mínimo configurado antes de preparar o lembrete.', { disponivelEm })
  }

  return {
    ok: true,
    codigo: 'pronto',
    motivo: '',
    destino,
    numeroAtendimento,
    lembreteAt: null,
    expiraEm,
    disponivelEm,
  }
}

export function interpolarMensagemWhatsapp(template, dados = {}) {
  const valores = {
    nome: dados.nome,
    pedido: dados.pedido,
    valor: dados.valor,
    pix: dados.pix,
    expiracao: dados.expiracao,
    validade: dados.expiracao,
    sorteio: dados.sorteio,
    numero_atendimento: dados.numeroAtendimento,
    telefone_atendimento: dados.numeroAtendimento,
  }

  return String(template || DEFAULT_WHATSAPP_COBRANCA_MESSAGE)
    .replace(/{{\s*([a-z_]+)\s*}}/gi, (original, chave) => (
      Object.prototype.hasOwnProperty.call(valores, chave.toLowerCase())
        ? String(valores[chave.toLowerCase()] ?? '')
        : original
    ))
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function removerPixDoTemplateWhatsapp(template) {
  const linhas = String(template || DEFAULT_WHATSAPP_COBRANCA_MESSAGE).split(/\r?\n/)
  const temPix = (linha) => /{{\s*pix\s*}}/i.test(String(linha || ''))
  const ehRotuloPix = (linha) => /(?:pix\s+c[oó]pia\s+e\s+cola|c[oó]digo\s+pix)/i.test(String(linha || ''))
  const saida = []

  linhas.forEach((linha, indice) => {
    const proxima = linhas[indice + 1] || ''
    if (ehRotuloPix(linha) && temPix(proxima)) return
    if (!temPix(linha)) {
      saida.push(linha)
      return
    }

    const inicioTrechoPix = String(linha).search(/(?:pix\s+c[oó]pia\s+e\s+cola|c[oó]digo\s+pix)/i)
    if (inicioTrechoPix > -1) {
      const prefixo = linha.slice(0, inicioTrechoPix).trimEnd()
      if (prefixo.trim()) saida.push(prefixo)
    }
  })

  return saida.join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

const normalizarTextoTemplate = (valor) => String(valor || '')
  .normalize('NFD')
  .replace(/\p{Diacritic}/gu, '')
  .toLowerCase()
  .replace(/\s+/g, ' ')
  .trim()

export function normalizarTemplateCobrancaWhatsapp(template) {
  const limpo = removerPixDoTemplateWhatsapp(template || DEFAULT_WHATSAPP_COBRANCA_MESSAGE)
  const texto = normalizarTextoTemplate(limpo)
  if (!texto) return DEFAULT_WHATSAPP_COBRANCA_MESSAGE

  const pareceTemplatePromocional = texto.includes('renato ambrosio')
    || (texto.includes('viva sorte+') && texto.includes('gerou o pix do pedido #{{pedido}}'))

  return pareceTemplatePromocional ? DEFAULT_WHATSAPP_COBRANCA_MESSAGE : limpo
}

export function montarMensagemWhatsappInicial(template, dados = {}) {
  return interpolarMensagemWhatsapp(normalizarTemplateCobrancaWhatsapp(template), { ...dados, pix: '' })
}
export function montarWaMeUrl(destino, mensagem) {
  const numero = normalizarNumeroWhatsApp(destino)
  return numero && mensagem ? `https://wa.me/${numero}?text=${encodeURIComponent(mensagem)}` : ''
}
