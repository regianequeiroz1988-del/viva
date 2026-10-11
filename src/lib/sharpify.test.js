import test from 'node:test'
import assert from 'node:assert/strict'
import { extrairPixSharpify, sharpifyPago, totalCentavosSharpify } from '../../lib/sharpify.js'

test('extrai id do link e o copia-e-cola da resposta da Sharpify', () => {
  const r = extrairPixSharpify({
    data: {
      id: 'link_1',
      status: 'PENDING',
      pricing: { total: 19.8 },
      payment: { gateway: { expirationDate: '2099-01-01T00:00:00.000Z', data: { code: '00020126580014br.gov.bcb.pix0136abc', qrCode: '00020126580014br.gov.bcb.pix0136abc' } } },
    },
  })
  assert.equal(r.id, 'link_1')
  assert.equal(r.qrCode, '00020126580014br.gov.bcb.pix0136abc')
  assert.equal(r.qrCodeUrl, '')
  assert.ok(r.expiresAt > Date.now())
})

test('converte imagem do QR em data URL e mantém o copia-e-cola separado', () => {
  const b64 = 'A'.repeat(120)
  const r = extrairPixSharpify({ id: 'link_2', payment: { gateway: { data: { code: '00020126abc', qrCode: b64 } } } })
  assert.equal(r.qrCode, '00020126abc')
  assert.equal(r.qrCodeUrl, `data:image/png;base64,${b64}`)
})

test('valor total em centavos e status pago só com APPROVED', () => {
  assert.equal(totalCentavosSharpify({ pricing: { total: 19.8 } }), 1980)
  assert.equal(totalCentavosSharpify({ payment: { amount: 5 } }), 500)
  assert.equal(sharpifyPago({ status: 'APPROVED' }), true)
  assert.equal(sharpifyPago({ status: 'PENDING' }), false)
  assert.equal(sharpifyPago({ status: 'CANCELLED' }), false)
})
