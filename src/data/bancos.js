// Bancos e instituições de pagamento com código COMPE (3 dígitos) e ISPB.
// Fonte: listas públicas de códigos COMPE/ISPB (conferir na planilha oficial do BCB
// em bcb.gov.br → Sistema Financeiro Nacional → Encontre uma instituição).
// Usado na declaração de valores do /ganhador: a busca casa por nome, código ou ISPB.
export const BANCOS = [
  { codigo: '121', nome: 'Agibank', ispb: '10664513' },
  { codigo: '246', nome: 'Banco ABC Brasil', ispb: '28195667' },
  { codigo: '025', nome: 'Banco Alfa', ispb: '03323840' },
  { codigo: '318', nome: 'Banco BMG', ispb: '61186680' },
  { codigo: '218', nome: 'Banco BS2', ispb: '71027866' },
  { codigo: '655', nome: 'Banco BV (Votorantim)', ispb: '59588111' },
  { codigo: '069', nome: 'Banco Crefisa', ispb: '61033106' },
  { codigo: '707', nome: 'Banco Daycoval', ispb: '62232889' },
  { codigo: '335', nome: 'Banco Digio', ispb: '27098060' },
  { codigo: '001', nome: 'Banco do Brasil', ispb: '00000000' },
  { codigo: '004', nome: 'Banco do Nordeste (BNB)', ispb: '07237373' },
  { codigo: '077', nome: 'Banco Inter', ispb: '00416968' },
  { codigo: '243', nome: 'Banco Master', ispb: '33923798' },
  { codigo: '389', nome: 'Banco Mercantil do Brasil', ispb: '57839805' },
  { codigo: '212', nome: 'Banco Original', ispb: '92894922' },
  { codigo: '623', nome: 'Banco Pan', ispb: '59285411' },
  { codigo: '422', nome: 'Banco Safra', ispb: '58160789' },
  { codigo: '033', nome: 'Banco Santander', ispb: '90400888' },
  { codigo: '637', nome: 'Banco Sofisa', ispb: '60889128' },
  { codigo: '037', nome: 'Banpará', ispb: '04902979' },
  { codigo: '041', nome: 'Banrisul', ispb: '92702067' },
  { codigo: '047', nome: 'Banese', ispb: '13009717' },
  { codigo: '021', nome: 'Banestes', ispb: '28127603' },
  { codigo: '007', nome: 'BNDES', ispb: '33657248' },
  { codigo: '237', nome: 'Bradesco', ispb: '60746948' },
  { codigo: '070', nome: 'BRB (Banco de Brasília)', ispb: '00000208' },
  { codigo: '208', nome: 'BTG Pactual', ispb: '30306294' },
  { codigo: '336', nome: 'C6 Bank', ispb: '31872495' },
  { codigo: '104', nome: 'Caixa Econômica Federal', ispb: '00360305' },
  { codigo: '341', nome: 'Itaú Unibanco', ispb: '60701190' },
  { codigo: '323', nome: 'Mercado Pago', ispb: '10573521' },
  { codigo: '536', nome: 'Neon', ispb: '20855875' },
  { codigo: '260', nome: 'Nubank', ispb: '18236120' },
  { codigo: '290', nome: 'PagBank (PagSeguro)', ispb: '08561701' },
  { codigo: '380', nome: 'PicPay', ispb: '22896431' },
  { codigo: '756', nome: 'Sicoob', ispb: '02038232' },
  { codigo: '748', nome: 'Sicredi', ispb: '01181521' },
  { codigo: '197', nome: 'Stone', ispb: '16501555' },
  { codigo: '280', nome: 'Will Bank', ispb: '23862762' },
  { codigo: '102', nome: 'XP Investimentos', ispb: '02332886' },
]

// Busca por nome, código COMPE ou ISPB (ignora acento e caixa).
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
export function buscarBancos(termo) {
  const t = norm(termo).trim()
  if (!t) return BANCOS
  const digitos = t.replace(/\D/g, '')
  // Código e ISPB casam pelo começo (senão "237" acharia um ISPB qualquer que contém 237).
  return BANCOS.filter((b) =>
    norm(b.nome).includes(t) || (digitos && (b.codigo.startsWith(digitos) || b.ispb.startsWith(digitos)))
  )
}
