// Peças de UI compartilhadas pelo painel admin (status, métodos de pagamento).
export const METODOS = { pix: 'Pix', creditos: 'Créditos', deposito: 'Depósito', cartao: 'Cartão' }

const STATUS = {
  pago: { label: 'Pago', cls: 'pago' },
  pendente: { label: 'Pendente', cls: 'pend' },
  cancelado: { label: 'Cancelado', cls: 'canc' },
  estornado: { label: 'Estornado', cls: 'canc' },
}

export function StatusPill({ status }) {
  const s = STATUS[status] || { label: status || '—', cls: status === 'pago' ? 'pago' : 'pend' }
  return <span className={`adm__status adm__status--${s.cls}`}>{s.label}</span>
}
