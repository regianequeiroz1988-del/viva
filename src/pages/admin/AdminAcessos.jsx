import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase.js'
import { TrendingUp, UserIcon, Check } from '../../components/Icons.jsx'

function dataCurta(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
}
const cidadeUf = (c, uf) => (c && c !== '(desconhecida)' ? `${c}${uf ? '/' + uf : ''}` : '(desconhecida)')

export default function AdminAcessos() {
  const [resumo, setResumo] = useState(null) // { total, visitantes, convertidos }
  const [recentes, setRecentes] = useState(null)
  const [convSet, setConvSet] = useState(() => new Set())
  const [erro, setErro] = useState('')

  useEffect(() => {
    let active = true
    ;(async () => {
      const [res, r, p] = await Promise.all([
        supabase.rpc('acessos_resumo'),
        supabase.from('acessos').select('created_at,cidade,uf,ip,visitor_id').order('created_at', { ascending: false }).limit(30),
        supabase.from('pedidos').select('visitor_id,metodo').eq('status', 'pago'),
      ])
      if (!active) return
      if (res.error) setErro(res.error.message)
      setResumo((res.data && res.data[0]) || { total: 0, visitantes: 0, convertidos: 0 })
      setRecentes(r.data || [])
      setConvSet(new Set((p.data || []).filter((x) => x.metodo !== 'deposito' && x.visitor_id).map((x) => x.visitor_id)))
    })()
    return () => { active = false }
  }, [])

  const taxa = resumo && Number(resumo.visitantes) ? (Number(resumo.convertidos) / Number(resumo.visitantes)) * 100 : 0

  const cards = [
    { label: 'Total de acessos', value: resumo == null ? '—' : Number(resumo.total).toLocaleString('pt-BR'), icon: TrendingUp, tone: 'blue' },
    { label: 'Visitantes únicos', value: resumo == null ? '—' : Number(resumo.visitantes).toLocaleString('pt-BR'), icon: UserIcon, tone: 'violet' },
    { label: 'Converteram em venda', value: resumo == null ? '—' : Number(resumo.convertidos).toLocaleString('pt-BR'), icon: Check, tone: 'green' },
    { label: 'Taxa de conversão', value: resumo == null ? '—' : `${taxa.toFixed(1).replace('.', ',')}%`, icon: TrendingUp, tone: 'amber' },
  ]

  return (
    <div>
      <header className="adm__pagehead">
        <div>
          <h1 className="adm__title">Acessos</h1>
          <p className="adm__subtitle">Quem entra no site, de onde, e se vira venda</p>
        </div>
      </header>

      {erro && <p className="auth__erro">{erro}</p>}

      <div className="adm__cards">
        {cards.map((c) => {
          const Icon = c.icon
          return (
            <div className="adm__card" key={c.label}>
              <span className={`adm__card-ic adm__card-ic--${c.tone}`}><Icon size={20} /></span>
              <div className="adm__card-body">
                <span className="adm__card-label">{c.label}</span>
                <strong className="adm__card-value">{c.value}</strong>
              </div>
            </div>
          )
        })}
      </div>

      <section className="adm__section">
        <div className="adm__section-head"><h2 className="adm__section-title">Acessos recentes</h2></div>
        <div className="adm__tablewrap">
          <table className="adm__table">
            <thead>
              <tr><th>Data</th><th>Cidade</th><th>IP</th><th>Converteu?</th></tr>
            </thead>
            <tbody>
              {!recentes ? (
                [...Array(5)].map((_, i) => <tr key={i}><td colSpan="4"><span className="adm__skel" /></td></tr>)
              ) : recentes.length === 0 ? (
                <tr><td colSpan="4" className="adm__empty-cell">Nenhum acesso ainda.</td></tr>
              ) : (
                recentes.map((r, i) => {
                  const conv = r.visitor_id && convSet.has(r.visitor_id)
                  return (
                    <tr key={i}>
                      <td>{dataCurta(r.created_at)}</td>
                      <td>{cidadeUf(r.cidade, r.uf)}</td>
                      <td>{r.ip || '—'}</td>
                      <td>{conv ? <span className="adm__status adm__status--pago">Sim</span> : <span className="adm-muted">—</span>}</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
