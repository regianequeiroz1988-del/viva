import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase.js'

const fmtHora = (iso) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
}

function Solicitacao({ s, onFeito }) {
  const max = Math.min(10, s.na_fila)
  const [qtd, setQtd] = useState(max)
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState('')

  const conceder = async () => {
    setBusy(true)
    setErro('')
    const { error } = await supabase.rpc('conceder_fichas', { p_solicitacao: s.id, p_qtd: qtd })
    setBusy(false)
    if (error) setErro(error.message)
    else onFeito()
  }
  const recusar = async () => {
    setBusy(true)
    const { error } = await supabase.rpc('recusar_solicitacao_fichas', { p_solicitacao: s.id })
    setBusy(false)
    if (error) setErro(error.message)
    else onFeito()
  }

  return (
    <div className="ntf__item">
      <div className="ntf__txt">
        <strong>{s.ligador_nome || 'Ligador'} quer mais fichas</strong>
        <span>{fmtHora(s.created_at)} · {s.na_fila} ficha(s) na fila dele</span>
      </div>
      {max > 0 ? (
        <div className="ntf__acoes">
          <input type="number" min={1} max={max} value={qtd} onChange={(e) => setQtd(Math.max(1, Math.min(max, Number(e.target.value) || 1)))} />
          <button type="button" className="ntf__ok" disabled={busy} onClick={conceder}>Conceder</button>
          <button type="button" className="ntf__nao" disabled={busy} onClick={recusar}>Recusar</button>
        </div>
      ) : (
        <div className="ntf__acoes">
          <span className="usr-muted">Sem fichas na fila — envie mais em Pedidos.</span>
          <button type="button" className="ntf__nao" disabled={busy} onClick={recusar}>Dispensar</button>
        </div>
      )}
      {erro && <p className="cfg-warn">{erro}</p>}
    </div>
  )
}

export default function AdminNotificacoes() {
  const [itens, setItens] = useState(null)

  const carregar = () =>
    supabase.rpc('listar_solicitacoes_fichas').then(({ data }) => setItens(Array.isArray(data) ? data : []))

  useEffect(() => {
    carregar()
    const t = setInterval(carregar, 10000)
    return () => clearInterval(t)
  }, [])

  return (
    <section>
      <header className="adm__pagehead"><div>
        <h1 className="adm__title">Notificações</h1>
        <p className="adm__subtitle">Pedidos de mais fichas dos ligadores. Cada ligador vê no máximo 10 por vez.</p>
      </div></header>
      <div className="adm__panel">
        {itens === null ? (
          <p className="usr-muted">Carregando…</p>
        ) : itens.length === 0 ? (
          <p className="usr-muted">Nenhuma notificação pendente.</p>
        ) : (
          itens.map((s) => <Solicitacao key={s.id} s={s} onFeito={carregar} />)
        )}
      </div>
    </section>
  )
}
