import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getGerente, logoutGerente, situacaoGerente, ligadoresGerente, solicitacoesGerente,
  concederFichas, recusarSolicitacao, pedirFichasAdmin,
} from '../../lib/gerente.js'
import PainelTransmissoes from '../../components/PainelTransmissoes.jsx'

const fmtHora = (iso) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
}

const credenciais = async () => ({ role: 'gerente', token: getGerente()?.token || '' })

function Solicitacao({ s, disponivel, onFeito }) {
  const max = Math.min(10, disponivel)
  const [qtd, setQtd] = useState(max)
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState('')

  useEffect(() => { setQtd((q) => Math.max(1, Math.min(max, q || max))) }, [max])

  const conceder = async () => {
    setBusy(true)
    setErro('')
    const r = await concederFichas(s.id, qtd)
    setBusy(false)
    if (r.ok) onFeito()
    else setErro(r.error)
  }
  const recusar = async () => {
    setBusy(true)
    const r = await recusarSolicitacao(s.id)
    setBusy(false)
    if (r.ok) onFeito()
    else setErro(r.error)
  }

  return (
    <div className="ntf__item">
      <div className="ntf__txt">
        <strong>{s.ligador_nome || 'Ligador'} quer mais fichas</strong>
        <span>{fmtHora(s.created_at)}</span>
      </div>
      {max > 0 ? (
        <div className="ntf__acoes">
          <input type="number" min={1} max={max} value={qtd} onChange={(e) => setQtd(Math.max(1, Math.min(max, Number(e.target.value) || 1)))} />
          <button type="button" className="ntf__ok" disabled={busy} onClick={conceder}>Conceder</button>
          <button type="button" className="ntf__nao" disabled={busy} onClick={recusar}>Recusar</button>
        </div>
      ) : (
        <div className="ntf__acoes">
          <span className="usr-muted">Você está sem fichas — peça mais ao admin.</span>
          <button type="button" className="ntf__nao" disabled={busy} onClick={recusar}>Dispensar</button>
        </div>
      )}
      {erro && <p className="cfg-warn">{erro}</p>}
    </div>
  )
}

export default function GerentePainel() {
  const navigate = useNavigate()
  const ger = getGerente()
  const [situacao, setSituacao] = useState(null)
  const [ligadores, setLigadores] = useState(null)
  const [pedidos, setPedidos] = useState(null)
  const [pedindo, setPedindo] = useState(false)
  const [qtdAdmin, setQtdAdmin] = useState('')
  const [conectado, setConectado] = useState(false)

  const carregar = async () => {
    const [sit, ligs, sols] = await Promise.all([situacaoGerente(), ligadoresGerente(), solicitacoesGerente()])
    // token não vale mais (gerente removido/desativado): volta pro login
    if (!sit) { logoutGerente(); navigate('/gerente/entrar', { replace: true }); return }
    setSituacao(sit)
    setLigadores(ligs)
    setPedidos(sols)
  }

  useEffect(() => {
    carregar()
    const t = setInterval(carregar, 10000)
    return () => clearInterval(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const pedirAdmin = async (e) => {
    e.preventDefault()
    setPedindo(true)
    const r = await pedirFichasAdmin(Number(qtdAdmin) || 0)
    setPedindo(false)
    if (!r.ok) alert(r.error || 'Não foi possível pedir fichas.')
    setQtdAdmin('')
    carregar()
  }

  const sair = () => {
    logoutGerente()
    navigate('/gerente/entrar', { replace: true })
  }

  const naFilaDe = new Map((ligadores || []).map((l) => [l.id, l.na_fila]))
  const estoque = situacao?.estoque ?? 0

  return (
    <main className="ligp">
      <header className="ligp__top">
        <div className="ligp__id">
          <strong>Painel do Gerente</strong>
          <span>Olá, {ger?.nome || 'gerente'}</span>
        </div>
        <div className="ligp__top-acoes">
          <button className="ligp__sair" onClick={sair}>Sair</button>
        </div>
      </header>

      <div className="ligp__wrap ger">
        <section className="adm__panel ger__fichas">
          <div>
            <h2 className="adm__panel-title">Minhas fichas</h2>
            <p className="ger__num">{situacao ? estoque : '…'}</p>
            <p className="usr-muted">disponíveis pra liberar aos seus ligadores</p>
          </div>
          {situacao?.solicitacaoPendente ? (
            <p className="ger__aguarde">Pedido enviado ao admin — as fichas aparecem aqui assim que ele enviar.</p>
          ) : (
            <form className="ger__pedir" onSubmit={pedirAdmin}>
              <input type="number" min={1} placeholder="Qtd. (opcional)" value={qtdAdmin} onChange={(e) => setQtdAdmin(e.target.value)} />
              <button className="adm__btn adm__btn--primary" disabled={pedindo}>
                {pedindo ? 'Enviando…' : 'Pedir mais ao admin'}
              </button>
            </form>
          )}
        </section>

        <section className="adm__panel">
          <h2 className="adm__panel-title">Pedidos de fichas dos ligadores</h2>
          <p className="usr-muted">Cada ligador vê no máximo 10 fichas por vez. Primeiro sai da fila dele, depois do seu estoque.</p>
          {pedidos === null ? (
            <p className="usr-muted">Carregando…</p>
          ) : pedidos.length === 0 ? (
            <p className="usr-muted">Nenhum pedido pendente.</p>
          ) : (
            pedidos.map((s) => (
              <Solicitacao key={s.id} s={s} disponivel={estoque + (naFilaDe.get(s.ligador_id) ?? s.na_fila ?? 0)} onFeito={carregar} />
            ))
          )}
        </section>

        <section className="adm__panel">
          <h2 className="adm__panel-title">Meus ligadores</h2>
          {ligadores === null ? (
            <p className="usr-muted">Carregando…</p>
          ) : ligadores.length === 0 ? (
            <p className="usr-muted">Nenhum ligador vinculado a você ainda. O admin vincula em Ligadores.</p>
          ) : (
            <div className="lig-tab">
              {ligadores.map((l) => (
                <div key={l.id} className="lig-row">
                  <div className="lig-row__id"><strong>{l.nome || l.usuario}</strong>{l.ativo === false ? ' · inativo' : ''}</div>
                  <div className="lig-row__stats">
                    <span className="lig-pill lig-pill--a">{l.a_ligar} a ligar</span>
                    <span className="lig-pill lig-pill--a">{l.retorno} retorno</span>
                    <span className="lig-pill lig-pill--b">{l.bom} bom</span>
                    <span className="lig-pill lig-pill--r">{l.ruim} ruim</span>
                    {l.na_fila > 0 && <span className="usr-muted">{l.na_fila} na fila</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="adm__panel">
          <h2 className="adm__panel-title">Transmissões</h2>
          <p className="usr-muted">
            {conectado ? 'Clique num ligador transmitindo pra assistir a tela dele (com áudio).' : 'Conectando ao servidor de transmissão…'}
          </p>
          <PainelTransmissoes credenciais={credenciais} carregarLigadores={ligadoresGerente} onConexao={setConectado} />
        </section>
      </div>
    </main>
  )
}
