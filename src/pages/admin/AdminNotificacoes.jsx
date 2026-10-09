import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase.js'

const fmtHora = (iso) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
}

function Solicitacao({ s, onFeito }) {
  const max = s.na_fila
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

function SolicitacaoGerente({ s, onFeito }) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState('')

  const responder = async (status) => {
    setBusy(true)
    setErro('')
    const { error } = await supabase.rpc('responder_solicitacao_gerente', { p_solicitacao: s.id, p_status: status })
    setBusy(false)
    if (error) setErro(error.message)
    else onFeito()
  }

  return (
    <div className="ntf__item">
      <div className="ntf__txt">
        <strong>Gerente {s.gerente_nome || ''} quer mais fichas{s.quantidade ? ` (${s.quantidade})` : ''}</strong>
        <span>{fmtHora(s.created_at)} · {s.estoque} ficha(s) ainda com ele</span>
      </div>
      <div className="ntf__acoes">
        <button type="button" className="ntf__ok" disabled={busy} onClick={() => navigate('/admin/pedidos')}>Enviar em Pedidos</button>
        <button type="button" className="ntf__nao" disabled={busy} onClick={() => responder('atendida')}>Já enviei</button>
        <button type="button" className="ntf__nao" disabled={busy} onClick={() => responder('recusada')}>Recusar</button>
      </div>
      {erro && <p className="cfg-warn">{erro}</p>}
    </div>
  )
}

export default function AdminNotificacoes() {
  const [itens, setItens] = useState(null)
  const [gerentes, setGerentes] = useState([])

  const carregar = () => {
    supabase.rpc('listar_solicitacoes_gerente').then(({ data }) => setGerentes(Array.isArray(data) ? data : []))
    return supabase.rpc('listar_solicitacoes_fichas').then(({ data }) => setItens(Array.isArray(data) ? data : []))
  }

  useEffect(() => {
    carregar()
    const t = setInterval(carregar, 10000)
    return () => clearInterval(t)
  }, [])

  return (
    <section>
      <header className="adm__pagehead"><div>
        <h1 className="adm__title">Notificações</h1>
        <p className="adm__subtitle">Pedidos de mais fichas. Ligadores com gerente pedem pro gerente, não aparecem aqui.</p>
      </div></header>
      {gerentes.length > 0 && (
        <div className="adm__panel">
          <h2 className="adm__panel-title">Gerentes</h2>
          {gerentes.map((s) => <SolicitacaoGerente key={s.id} s={s} onFeito={carregar} />)}
        </div>
      )}
      <div className="adm__panel">
        <h2 className="adm__panel-title">Ligadores sem gerente</h2>
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
