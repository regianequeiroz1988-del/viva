// Identifica o BANCO do pagador de um Pix a partir da charge do Pagar.me.
// No padrão Pix, o "end-to-end id" (E2E) começa com "E" + os 8 dígitos do ISPB
// da instituição do PAGADOR. Daí a gente tira o código do banco e (no front)
// mapeia pro nome. Guardamos o E2E e o ISPB no pedido — sempre corretos.

import { PAGARME_BASE, credenciaisPagarme, pagarmeAuth } from './pagarme.js'

// Extrai { pix_e2e, pix_ispb } do last_transaction de uma charge.
export function extrairPix(charge) {
  const tx = (charge && charge.last_transaction) || {}
  const e2e = String(tx.end_to_end_id || tx.endToEndId || tx.end_to_end || '')
  const m = /^E(\d{8})/.exec(e2e) // E + ISPB(8) + data(12) + aleatório(11)
  return { pix_e2e: e2e || null, pix_ispb: m ? m[1] : null }
}

// Extrai o NOME do banco do pagador direto da cobrança paga da Pagar.me.
// A Pagar.me devolve os dados do pagador no last_transaction quando o Pix é
// confirmado. Os nomes de campo variam um pouco entre payloads, então lemos de
// forma defensiva (vários caminhos) e devolvemos { pix_banco, pix_holder, pix_ispb }.
// pix_banco vira a fonte PRIMÁRIA do nome do banco (evita a lista manual de ISPB).
export function extrairBanco(charge) {
  const tx = (charge && charge.last_transaction) || {}
  const pa = tx.payer || tx.pix?.payer || charge?.payer || tx.pix_payer || {}
  const ba = pa.bank_account || pa.bankAccount || pa.bank || tx.bank_account || {}
  const pix_banco =
    ba.bank_name || ba.bankName || ba.name ||
    pa.bank_name || pa.bankName || pa.institution_name || pa.bank ||
    null
  const pix_holder = pa.name || pa.holder_name || pa.holderName || ba.holder_name || null
  // ISPB às vezes vem junto do payer; reforça o que o E2E já dá.
  const ispbRaw = ba.ispb || ba.bank_code || pa.ispb || ''
  const pix_ispb = String(ispbRaw).replace(/\D/g, '').slice(0, 8) || null
  return {
    pix_banco: pix_banco ? String(pix_banco).trim() : null,
    pix_holder: pix_holder ? String(pix_holder).trim() : null,
    pix_ispb,
  }
}

// Busca a charge completa no Pagar.me (o webhook às vezes vem sem o E2E).
// Lê a chave do /admin (config) OU da env, via credenciaisPagarme().
export async function buscarCharge(chargeId) {
  const { secretKey } = await credenciaisPagarme()
  if (!secretKey || !chargeId) return null
  try {
    const r = await fetch(`${PAGARME_BASE}/charges/${encodeURIComponent(chargeId)}`, {
      headers: { Authorization: pagarmeAuth(secretKey) },
    })
    return r.ok ? await r.json() : null
  } catch {
    return null
  }
}
