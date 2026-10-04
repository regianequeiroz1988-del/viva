/** Formata um numero como moeda brasileira: 19.8 -> "R$ 19,80" ; 20000 -> "R$ 20.000,00" */
const fmtBRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export const formatBRL = (value) => fmtBRL.format(Number(value) || 0)
