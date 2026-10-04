import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_WHATSAPP_COBRANCA_MESSAGE,
  avaliarCobrancaWhatsapp,
  montarMensagemWhatsappInicial,
  montarWaMeUrl,
  normalizarNumeroWhatsApp,
  pixEstaValido,
} from './whatsappCobranca.js'
import { montarPersistenciaPix } from '../../lib/pedido-pix.js'

const agora = Date.parse('2026-07-26T15:00:00Z')
const pedidoValido = {
  id: '12345678-abcd',
  status: 'pendente',
  metodo: 'pix',
  created_at: '2026-07-26T14:50:00Z',
  pix_gerado_at: '2026-07-26T14:50:00Z',
  pix_expira_em: '2026-07-26T15:20:00Z',
  pix_copia_cola: '000201PIXVALIDO',
  pagador: { telefone: '(21) 99999-8888' },
}
const config = { ativo: true, numeroAtendimento: '(31) 98888-7777', esperaMinutos: 5 }
const clienteConfirmado = {
  telefone: '(21) 99999-8888',
  telefones: ['(21) 99999-8888'],
  telefone_confere: true,
}

test('normaliza apenas celulares/telefones brasileiros utilizáveis no wa.me', () => {
  assert.equal(normalizarNumeroWhatsApp('(21) 99999-8888'), '5521999998888')
  assert.equal(normalizarNumeroWhatsApp('005531988887777'), '5531988887777')
  assert.equal(normalizarNumeroWhatsApp('123'), '')
  assert.equal(normalizarNumeroWhatsApp('(00) 99999-8888'), '')
})

test('só considera o Pix válido quando há código e a expiração está no futuro', () => {
  assert.equal(pixEstaValido(pedidoValido, agora), true)
  assert.equal(pixEstaValido({ ...pedidoValido, pix_expira_em: '2026-07-26T14:59:59Z' }, agora), false)
  assert.equal(pixEstaValido({ ...pedidoValido, pix_copia_cola: '' }, agora), false)
  assert.equal(pixEstaValido({
    ...pedidoValido,
    pix_copia_cola: '',
    pix_expira_em: null,
    pagador: { pix_copia_cola: 'PIX-ANTIGO', pix_expira_em: '2026-07-26T15:20:00Z' },
  }, agora), true)
})

test('libera a cobranca apos a espera e bloqueia expiracao e repeticao', () => {
  assert.equal(avaliarCobrancaWhatsapp(pedidoValido, clienteConfirmado, config, agora).ok, true)
  assert.equal(avaliarCobrancaWhatsapp(pedidoValido, clienteConfirmado, { ativo: true, esperaMinutos: 5 }, agora).ok, true)
  assert.equal(avaliarCobrancaWhatsapp({ ...pedidoValido, pix_expira_em: '2026-07-26T14:59:59Z' }, clienteConfirmado, config, agora).codigo, 'pix_expirado')
  const preparado = avaliarCobrancaWhatsapp({ ...pedidoValido, whatsapp_lembrete_at: '2026-07-26T14:58:00Z' }, clienteConfirmado, config, agora)
  assert.equal(preparado.codigo, 'ja_preparado')
  assert.equal(preparado.podeReabrir, true)
  assert.equal(avaliarCobrancaWhatsapp(pedidoValido, { ...clienteConfirmado, telefone_confere: false }, config, agora).ok, true)
  assert.equal(avaliarCobrancaWhatsapp(pedidoValido, { telefone: '(21) 99999-8888' }, config, agora).ok, true)
  assert.equal(avaliarCobrancaWhatsapp(pedidoValido, { ...clienteConfirmado, telefone: '(21) 98888-7777' }, config, agora).ok, true)
  assert.equal(avaliarCobrancaWhatsapp(pedidoValido, { telefone: '' }, config, agora).codigo, 'telefone_invalido')
  assert.equal(avaliarCobrancaWhatsapp(pedidoValido, { telefone: '123' }, config, agora).codigo, 'telefone_invalido')
  assert.equal(avaliarCobrancaWhatsapp({ ...pedidoValido, pix_gerado_at: '2026-07-26T14:58:00Z' }, clienteConfirmado, config, agora).codigo, 'aguardando')
  assert.equal(avaliarCobrancaWhatsapp({ ...pedidoValido, pix_expira_em: '2026-07-26T15:02:59Z' }, clienteConfirmado, config, agora).codigo, 'pix_perto_expirar')
  assert.equal(avaliarCobrancaWhatsapp(pedidoValido, {
    ...clienteConfirmado,
    telefones: ['(31) 99999-8888'],
  }, config, agora).ok, true)
})

test('monta a primeira mensagem sem colocar o Pix dentro do WhatsApp', () => {
  const mensagem = montarMensagemWhatsappInicial(DEFAULT_WHATSAPP_COBRANCA_MESSAGE, {
    nome: 'Solange', pedido: '12345678', valor: 'R$ 118,80', pix: 'PIX-CODE',
    expiracao: '26/07/2026 12:20', sorteio: 'Viva Sorte', numeroAtendimento: '(31) 98888-7777',
  })
  const url = montarWaMeUrl('(21) 99999-8888', mensagem)

  assert.match(mensagem, /Solange/)
  assert.match(mensagem, /realizar o pagamento para confirmar sua participação/i)
  assert.match(mensagem, /código Pix na próxima mensagem/i)
  assert.doesNotMatch(mensagem, /PIX-CODE/)
  assert.doesNotMatch(mensagem, /Renato Ambrósio|Viva Sorte\+/)
  assert.equal(url.startsWith('https://wa.me/5521999998888?text='), true)
  assert.doesNotMatch(decodeURIComponent(url), /PIX-CODE/)
  assert.match(decodeURIComponent(url), /R\$ 118,80/)
})
test('volta templates promocionais para a mensagem curta com acentos', () => {
  const promocional = `Olá, {{nome}}! Tudo bem? Aqui é do Viva Sorte+.

Vimos que você gerou o Pix do pedido #{{pedido}}, no valor de {{valor}}, mas o pagamento ainda não foi confirmado.

Depois é só torcer para o Renato Ambrósio entrar em contato anunciando que você foi o(a) mais novo(a) ganhador(a) da semana!`
  const mensagem = montarMensagemWhatsappInicial(promocional, {
    nome: 'Solange', pedido: '12345678', valor: 'R$ 118,80', pix: 'PIX-CODE',
    expiracao: '26/07/2026 12:20', sorteio: 'Viva Sorte', numeroAtendimento: '(31) 98888-7777',
  })

  assert.match(mensagem, /participação/)
  assert.match(mensagem, /próxima mensagem/)
  assert.doesNotMatch(mensagem, /Renato Ambrósio|Viva Sorte\+|PIX-CODE/)
})

test('limpa templates antigos que ainda tinham o Pix no corpo da mensagem', () => {
  const dados = {
    nome: 'Solange', pedido: '12345678', valor: 'R$ 118,80', pix: 'PIX-CODE',
    expiracao: '26/07/2026 12:20', sorteio: 'Viva Sorte', numeroAtendimento: '(31) 98888-7777',
  }
  const blocoAntigo = `Olá, {{nome}}!

Pix copia e cola (válido até {{expiracao}}):
{{pix}}

Obrigado.`
  const inlineAntigo = 'Olá, {{nome}}! Vimos seu pedido. Pix copia e cola: {{pix}}'

  const mensagemBloco = montarMensagemWhatsappInicial(blocoAntigo, dados)
  const mensagemInline = montarMensagemWhatsappInicial(inlineAntigo, dados)

  assert.equal(mensagemBloco, 'Olá, Solange!\n\nObrigado.')
  assert.equal(mensagemInline, 'Olá, Solange! Vimos seu pedido.')
  assert.doesNotMatch(mensagemBloco, /PIX-CODE|copia e cola/i)
  assert.doesNotMatch(mensagemInline, /PIX-CODE|copia e cola/i)
})

test('monta a persistência do Pix com expiração ISO e snapshot de compatibilidade', () => {
  const persistencia = montarPersistenciaPix({
    out: { qrCode: 'PIX-CODE', expiresAt: Date.parse('2026-07-26T15:20:00Z') },
    customer: { name: 'Solange', cpf: '123', phone: '21999998888' },
    agora: new Date('2026-07-26T14:50:05Z'),
  })

  assert.equal(persistencia.colunas.pix_expira_em, '2026-07-26T15:20:00.000Z')
  assert.equal(Object.hasOwn(persistencia.colunas, 'whatsapp_optin'), false)
  assert.equal(persistencia.pagador.pix_copia_cola, 'PIX-CODE')
  assert.equal(persistencia.pagador.telefone, '21999998888')
})
