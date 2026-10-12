import test from 'node:test'
import assert from 'node:assert/strict'
import { chaveDoCliente, consolidarPedidosPorCliente, fichasPorPedido } from './pedidosAgrupados.js'

test('consolida pedidos do mesmo CPF e usa o pedido mais recente no cartão', () => {
  const pedidos = [
    { id: 'antigo', user_id: 'u1', status: 'pago', created_at: '2026-07-20T10:00:00Z', pagador: { cpf: '123.456.789-00' } },
    { id: 'recente', user_id: 'u2', status: 'pendente', created_at: '2026-07-26T10:00:00Z', pagador: { cpf: '12345678900' } },
  ]

  const resultado = consolidarPedidosPorCliente(pedidos)

  assert.equal(resultado.length, 1)
  assert.equal(resultado[0].id, 'recente')
  assert.equal(resultado[0]._totalGerados, 2)
  assert.equal(resultado[0]._totalPagos, 1)
  assert.deepEqual(resultado[0]._historico.map((pedido) => pedido.id), ['recente', 'antigo'])
})

test('usa o CPF do perfil quando o snapshot do pagador não tem documento', () => {
  const perfis = { u1: { cpf: '111.222.333-44' } }
  const pedidos = [
    { id: '1', user_id: 'u1', status: 'pendente', created_at: '2026-07-25T10:00:00Z' },
    { id: '2', user_id: 'u1', status: 'pendente', created_at: '2026-07-26T10:00:00Z' },
  ]

  assert.equal(chaveDoCliente(pedidos[0], perfis), 'cpf:11122233344')
  assert.equal(consolidarPedidosPorCliente(pedidos, perfis).length, 1)
})

test('CPF do perfil prevalece sobre um snapshot de pagador adulterado', () => {
  const perfis = { u1: { cpf: '111.222.333-44' } }
  const pedido = {
    id: '1',
    user_id: 'u1',
    status: 'pendente',
    pagador: { cpf: '999.888.777-66' },
  }
  assert.equal(chaveDoCliente(pedido, perfis), 'cpf:11122233344')
})

test('não mistura pedidos sem nenhum identificador de cliente', () => {
  const resultado = consolidarPedidosPorCliente([
    { id: '1', status: 'pendente' },
    { id: '2', status: 'pago' },
  ])

  assert.equal(resultado.length, 2)
})

test('fichasPorPedido: cada Pix da mesma pessoa vira um cartão, com aviso de voltou só nos novos', () => {
  const pedidos = [
    { id: 'p1', user_id: 'u1', status: 'pago', created_at: '2026-10-01T10:00:00Z', pagador: { cpf: '11111111111' }, exportado: true, exportado_at: '2026-10-02T10:00:00Z' },
    { id: 'p2', user_id: 'u1', status: 'pendente', created_at: '2026-10-05T10:00:00Z', pagador: { cpf: '11111111111' } },
  ]
  const fichas = fichasPorPedido(pedidos)
  assert.equal(fichas.length, 2)
  assert.deepEqual(fichas.map((f) => f._historico.length), [1, 1])
  assert.equal(fichas.find((f) => f.id === 'p2')._voltou, true)
  assert.equal(fichas.find((f) => f.id === 'p1')._voltou, false)
})
