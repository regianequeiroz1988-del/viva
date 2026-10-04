// Mapa ISPB (código de 8 dígitos do banco no Pix) → nome amigável. Cobre os
// bancos mais usados; para os demais mostramos "Banco (ISPB xxxxxxxx)" — o código
// fica guardado no pedido, então dá pra adicionar o nome aqui a qualquer momento.
export const BANCOS_ISPB = {
  '18236120': 'Nubank',
  '60701190': 'Itaú',
  '60746948': 'Bradesco',
  '00360305': 'Caixa Econômica',
  '00000000': 'Banco do Brasil',
  '90400888': 'Santander',
  '00416968': 'Banco Inter',
  '31872495': 'C6 Bank',
  '22896431': 'PicPay',
  '09516419': 'PicPay',
  '10573521': 'Mercado Pago',
  '08561701': 'PagBank (PagSeguro)',
  '30306294': 'BTG Pactual',
  '02038232': 'Sicoob',
  '01181521': 'Sicredi',
  '59285411': 'Banco Pan',
  '59588111': 'Banco BV',
  '58160789': 'Banco Safra',
  '92894922': 'Banco Original',
  '16501555': 'Stone',
  '05463212': 'Ailos',
  '07237373': 'Banco do Nordeste',
  '92702067': 'Banrisul',
  '61186680': 'Banco BMG',
}

// Nome do banco a partir do ISPB. Sem ISPB → ''. ISPB não mapeado → "Banco (ISPB ...)".
export function nomeBanco(ispb) {
  const c = String(ispb || '').trim()
  if (!c) return ''
  return BANCOS_ISPB[c] || `Banco (ISPB ${c})`
}
