import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase.js'
import { formatBRL } from '../../utils/format.js'
import { UserIcon, Check, Clock, TrendingUp, Receipt, Wallet } from '../../components/Icons.jsx'
import { METODOS, StatusPill } from './AdminUI.jsx'

export default function AdminDashboard() {
  const [s, setS] = useState({
    usuarios: 0, pagos: 0, pendentes: 0, faturado: 0, ticket: 0, creditos: 0, loading: true,
  })
  const [recentes, setRecentes] = useState(null)

  useEffect(() => {
    let active = true
    ;(async () => {
      const [u, p, c, r] = await Promise.all([
        supabase.from('profiles').select('id', { count: 'exact', head: true }),
        supabase.from('pedidos').select('total,status,metodo'),
        supabase.from('profiles').select('creditos_nao_sacaveis'),
        supabase.from('pedidos').select('id,total,status,metodo,created_at').order('created_at', { ascending: false }).limit(6),
      ])
      if (!active) return
      const pedidos = p.data || []
      const pagos = pedidos.filter((x) => x.status === 'pago')
      const pendentes = pedidos.filter((x) => x.status !== 'pago')
      const faturado = pagos.reduce((a, x) => a + Number(x.total || 0), 0)
      const creditos = (c.data || []).reduce((a, x) => a + Number(x.creditos_nao_sacaveis || 0), 0)
      setS({
        usuarios: u.count || 0,
        pagos: pagos.length,
        pendentes: pendentes.length,
        faturado,
        ticket: pagos.length ? faturado / pagos.length : 0,
        creditos,
        loading: false,
      })
      setRecentes(r.data || [])
    })()
    return () => { active = false }
  }, [])

  const cards = [
    { label: 'Usuários cadastrados', value: s.usuarios, icon: UserIcon, tone: 'blue' },
    { label: 'Pedidos pagos', value: s.pagos, icon: Check, tone: 'green' },
    { label: 'Pedidos não pagos', value: s.pendentes, icon: Clock, tone: 'amber' },
    { label: 'Total faturado', value: formatBRL(s.faturado), icon: TrendingUp, tone: 'blue' },
    { label: 'Ticket médio (pago)', value: formatBRL(s.ticket), icon: Receipt, tone: 'violet' },
    { label: 'Créditos em carteira', value: formatBRL(s.creditos), icon: Wallet, tone: 'green' },
  ]

  return (
    <div>
      <header className="adm__pagehead">
        <div>
          <h1 className="adm__title">Visão geral</h1>
          <p className="adm__subtitle">Resumo do desempenho do seu site</p>
        </div>
      </header>

      <div className="adm__cards">
        {cards.map((c) => {
          const Icon = c.icon
          return (
            <div className="adm__card" key={c.label}>
              <span className={`adm__card-ic adm__card-ic--${c.tone}`}><Icon size={20} /></span>
              <div className="adm__card-body">
                <span className="adm__card-label">{c.label}</span>
                <strong className="adm__card-value">{s.loading ? '—' : c.value}</strong>
              </div>
            </div>
          )
        })}
      </div>

      <section className="adm__section">
        <div className="adm__section-head">
          <h2 className="adm__section-title">Pedidos recentes</h2>
          <Link className="adm__seeall" to="/admin/pedidos" onClick={(e) => e.stopPropagation()}>Ver todos →</Link>
        </div>
        <div className="adm__tablewrap">
          <table className="adm__table">
            <thead>
              <tr><th>Data</th><th>Método</th><th>Total</th><th>Status</th></tr>
            </thead>
            <tbody>
              {!recentes ? (
                [...Array(4)].map((_, i) => (
                  <tr key={i}><td colSpan="4"><span className="adm__skel" /></td></tr>
                ))
              ) : recentes.length === 0 ? (
                <tr><td colSpan="4" className="adm__empty-cell">Nenhum pedido ainda.</td></tr>
              ) : (
                recentes.map((r) => (
                  <tr key={r.id}>
                    <td>{new Date(r.created_at).toLocaleString('pt-BR')}</td>
                    <td>{METODOS[r.metodo] || r.metodo || '—'}</td>
                    <td>{formatBRL(r.total)}</td>
                    <td><StatusPill status={r.status} /></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
