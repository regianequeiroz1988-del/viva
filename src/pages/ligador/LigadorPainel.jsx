import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getLigador, logoutLigador, pedidosLigador, responderPedido, cadastrosLigador, responderCadastro, definirCodigoPremio, definirEstadoPremio, definirValorPremio, resetarPremio, situacaoFichas, solicitarFichas } from '../../lib/ligador.js'
import { iniciarTransmissaoLigador, suportaTransmissao } from '../../lib/transmissao.js'
import { consultarPremio } from '../../lib/premioResgate.js'
import { formatBRL } from '../../utils/format.js'
import { maskCpf, maskTelefone } from '../../utils/masks.js'
import { StatusPill } from '../admin/AdminUI.jsx'

const UPSELL_ID = 'upsell-dia-da-sorte'

// Máscara de centavos: digita só números, formata como R$ ao vivo (últimos 2 = centavos).
const formatarCentavos = (digitos) => {
  const n = Number(digitos || '0') / 100
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}


const fmtData = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
}

function resumo(p) {
  const arr = Array.isArray(p?.itens) ? p.itens : []
  const sorteios = arr
    .filter((i) => i && i.id !== UPSELL_ID && i.tipo !== 'deposito')
    .map((i) => i.title)
    .filter(Boolean)
  const numeros = arr.reduce((s, i) => s + (Number(i?.numeros ?? i?.qty) || 0), 0)
  return { sorteios, numeros }
}

// Bloco de resgate do prêmio (por CPF): valor próprio deste cliente, código +
// colar + salvar, e as ações de liberar/pagamento parcial. Some sem CPF.
//   bloqueado         → só "Liberar prêmio pro ganhador" (exige código salvo).
//   liberado          → "💸 Pagamento parcial" (webhook manual).
//   pagamento_parcial → código foi limpo no servidor; só "Gerar nova
//                        liberação" depois de colar e SALVAR um código novo.
function PremioResgate({ cpf }) {
  const [codigo, setCodigo] = useState('')
  const [valorDigitos, setValorDigitos] = useState('')
  const [premio, setPremio] = useState({ codigo: null, estado: 'bloqueado', valor: null })
  const [carregado, setCarregado] = useState(false)
  const [busySalvar, setBusySalvar] = useState(false)
  const [busyValor, setBusyValor] = useState(false)
  const [busyEstado, setBusyEstado] = useState(false)
  const [msg, setMsg] = useState('')
  const [msgValor, setMsgValor] = useState('')
  const [busyReset, setBusyReset] = useState(false)

  const carregar = () => {
    if (!cpf) return
    return consultarPremio(cpf).then((r) => {
      setPremio(r)
      setCodigo(r.codigo || '')
      setValorDigitos(r.valor != null ? String(Math.round(r.valor * 100)) : '')
      setCarregado(true)
    })
  }
  useEffect(() => {
    carregar()
  }, [cpf]) // eslint-disable-line react-hooks/exhaustive-deps

  const colar = async () => {
    try {
      const texto = await navigator.clipboard.readText()
      if (texto) setCodigo(texto.trim())
    } catch {
      /* sem permissão de clipboard — cola manualmente */
    }
  }

  const salvarCodigo = async () => {
    setBusySalvar(true)
    setMsg('')
    const r = await definirCodigoPremio(cpf, codigo)
    setBusySalvar(false)
    if (r.ok) {
      setPremio((prev) => ({ ...prev, codigo }))
      setMsg('ok')
      setTimeout(() => setMsg(''), 2000)
    } else {
      setMsg(r.error || 'Não foi possível salvar.')
    }
  }

  const salvarValor = async () => {
    setBusyValor(true)
    setMsgValor('')
    const valor = valorDigitos ? Number(valorDigitos) / 100 : null
    const r = await definirValorPremio(cpf, valor)
    setBusyValor(false)
    if (r.ok) {
      setPremio((prev) => ({ ...prev, valor }))
      setMsgValor('ok')
      setTimeout(() => setMsgValor(''), 2000)
    } else {
      setMsgValor(r.error || 'Não foi possível salvar.')
    }
  }

  const mudarEstado = async (novoEstado) => {
    setBusyEstado(true)
    setMsg('')
    const r = await definirEstadoPremio(cpf, novoEstado)
    setBusyEstado(false)
    if (r.ok) await carregar() // recarrega — o código pode ter sido limpo no servidor
    else setMsg(r.error || 'Não foi possível atualizar.')
  }

  // Reset: apaga o registro do resgate desse cpf por completo — volta pra como
  // era no início (bloqueado, sem código), como se ninguém tivesse mexido ainda.
  const resetar = async () => {
    if (!window.confirm('Resetar o resgate deste cliente? Ele volta pro estado inicial (bloqueado, sem código).')) return
    setBusyReset(true)
    setMsg('')
    const r = await resetarPremio(cpf)
    setBusyReset(false)
    if (r.ok) {
      setCodigo('')
      setValorDigitos('')
      await carregar()
    } else {
      setMsg(r.error || 'Não foi possível resetar.')
    }
  }

  if (!cpf) return null

  return (
    <div className="ligc__premio">
      <div className="ligc__premio-head">
        <strong className="ligc__premio-tit">Valor do prêmio (só deste cliente)</strong>
        <button type="button" className="ligc__premio-reset" disabled={busyReset || !carregado} onClick={resetar} title="Voltar pro estado inicial (bloqueado, sem código)">
          {busyReset ? 'Resetando…' : '↺ Reset'}
        </button>
      </div>
      <div className="ligc__premio-row">
        <input
          className="ligc__premio-input"
          inputMode="numeric"
          placeholder="Usa o padrão global"
          value={valorDigitos ? formatarCentavos(valorDigitos) : ''}
          onChange={(e) => setValorDigitos(e.target.value.replace(/\D/g, '').slice(0, 12))}
          disabled={!carregado}
        />
        <button type="button" className="ligc__premio-salvar" disabled={busyValor || !carregado} onClick={salvarValor}>
          {busyValor ? 'Salvando…' : msgValor === 'ok' ? 'Salvo!' : 'Salvar'}
        </button>
      </div>
      {msgValor && msgValor !== 'ok' && <p className="ligc__premio-erro">{msgValor}</p>}

      <strong className="ligc__premio-tit">Código de resgate</strong>
      <div className="ligc__premio-row">
        <input
          className="ligc__premio-input"
          placeholder="Código do prêmio"
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
          disabled={!carregado}
        />
        <button type="button" className="ligc__premio-paste" onClick={colar} title="Colar da área de transferência" aria-label="Colar">📋</button>
        <button type="button" className="ligc__premio-salvar" disabled={busySalvar || !carregado} onClick={salvarCodigo}>
          {busySalvar ? 'Salvando…' : msg === 'ok' ? 'Salvo!' : 'Salvar'}
        </button>
      </div>

      {premio.estado === 'bloqueado' && (
        <button
          type="button"
          className="ligc__premio-liberar"
          disabled={busyEstado || !carregado || !premio.codigo}
          onClick={() => mudarEstado('liberado')}
        >
          🔓 Liberar prêmio pro ganhador
        </button>
      )}
      {premio.estado === 'liberado' && (
        <>
          <p className="ligc__premio-status is-liberado">✅ Prêmio liberado pro ganhador</p>
          <button type="button" className="ligc__premio-parcial" disabled={busyEstado} onClick={() => mudarEstado('pagamento_parcial')}>
            💸 Pagamento parcial
          </button>
        </>
      )}
      {premio.estado === 'pagamento_parcial' && (
        <>
          <p className="ligc__premio-status is-parcial">💸 Pagamento parcial registrado — cole um código novo</p>
          <button
            type="button"
            className="ligc__premio-liberar"
            disabled={busyEstado || !carregado || !premio.codigo}
            onClick={() => mudarEstado('liberado')}
          >
            🔓 Gerar nova liberação
          </button>
        </>
      )}
      {msg && msg !== 'ok' && <p className="ligc__premio-erro">{msg}</p>}
    </div>
  )
}

function CardLigar({ p, onResponder }) {
  const ehCadastro = p._tipo === 'cadastro'
  const pag = p.pagador || {}
  const { sorteios, numeros } = resumo(p)
  const tel = pag.telefone || ''
  const [obs, setObs] = useState(p.ligador_obs || '')
  const [busy, setBusy] = useState(false)
  const finalizado = p.ligador_status === 'bom' || p.ligador_status === 'ruim'
  const emRetorno = p.ligador_status === 'retorno'

  const responder = async (status) => {
    setBusy(true)
    await onResponder(p, status, obs)
    setBusy(false)
  }

  return (
    <div className={`adm__pcard ligc ${finalizado ? `ligc--${p.ligador_status}` : emRetorno ? 'ligc--retorno' : ''}`}>
      <div className="adm__pcard-top">
        <strong className="adm__pcard-nome">{pag.nome || 'Cliente'}</strong>
        {ehCadastro ? <span className="adm__status adm__status--pend">Só cadastro</span> : <StatusPill status={p.status} />}
      </div>

      <dl className="adm__pcard-grid">
        <dt>Telefone</dt><dd>{tel ? maskTelefone(tel) : '—'}</dd>
        <dt>CPF</dt><dd>{pag.cpf ? maskCpf(pag.cpf) : '—'}</dd>
        {!ehCadastro && (
          <>
            <dt>Sorteio</dt><dd title={sorteios.join(' · ')}>{sorteios.length ? sorteios.join(' · ') : '—'}</dd>
            <dt>Números</dt><dd>{numeros || '—'}</dd>
            <dt>Total</dt><dd>{formatBRL(p.total)}</dd>
            <dt>Cidade</dt><dd>{p.cidade ? `${p.cidade}${p.uf ? '/' + p.uf : ''}` : '—'}</dd>
          </>
        )}
        <dt>Data</dt><dd>{fmtData(p.created_at)}</dd>
      </dl>

      <PremioResgate cpf={pag.cpf} />

      <textarea
        className="ligc__obs"
        placeholder="Observação: atendeu, desistiu do prêmio, retornar depois…"
        value={obs}
        onChange={(e) => setObs(e.target.value)}
      />
      <div className="ligc__acoes">
        <button className="ligc__bom" disabled={busy} onClick={() => responder('bom')}>👍 Deu bom</button>
        <button className="ligc__ruim" disabled={busy} onClick={() => responder('ruim')}>👎 Deu ruim</button>
        <button className="ligc__retornar" disabled={busy} onClick={() => responder('retorno')} title="Mover pra aba Retornos" aria-label="Retornar">↻</button>
      </div>
    </div>
  )
}

export default function LigadorPainel() {
  const navigate = useNavigate()
  const lig = getLigador()
  const [rows, setRows] = useState(null)
  const [aba, setAba] = useState('a_ligar')
  const [situacao, setSituacao] = useState(null)
  const [pedindo, setPedindo] = useState(false)

  // Transmissão de tela: as fichas só existem na tela enquanto ela estiver ativa.
  const transRef = useRef(null)
  const [transmitindo, setTransmitindo] = useState(false)
  const [semMic, setSemMic] = useState(false)
  const [conectado, setConectado] = useState(false)
  const [transErro, setTransErro] = useState('')
  const [iniciando, setIniciando] = useState(false)

  const iniciarTransmissao = async () => {
    setTransErro('')
    setIniciando(true)
    try {
      const t = await iniciarTransmissaoLigador({
        token: lig?.token,
        onFim: () => { transRef.current = null; setTransmitindo(false); setConectado(false); setRows(null); setSituacao(null) },
        onConexao: setConectado,
      })
      transRef.current = t
      setSemMic(t.semMic)
      setTransmitindo(true)
    } catch (e) {
      setTransErro(e?.name === 'NotAllowedError'
        ? 'Você cancelou o compartilhamento. Pra ver as fichas é preciso transmitir a tela.'
        : e?.message || 'Não foi possível iniciar a transmissão.')
    }
    setIniciando(false)
  }
  useEffect(() => () => transRef.current?.parar(), [])

  // Junta pedidos e "só cadastro" (clientes sem nenhum pedido) numa lista só — o
  // ligador liga pro mesmo jeito, tenha ou não pedido gerado.
  const carregar = async () => {
    const [pedidos, cadastros, sit] = await Promise.all([pedidosLigador(), cadastrosLigador(), situacaoFichas()])
    if (!transRef.current) return // parou de transmitir no meio da carga
    setSituacao(sit)
    const cadastrosComoCard = cadastros.map((c) => ({
      id: c.id,
      _tipo: 'cadastro',
      pagador: { nome: c.nome, telefone: c.telefone, cpf: c.cpf },
      itens: [],
      total: null,
      status: 'cadastro',
      created_at: c.created_at,
      ligador_status: c.ligador_status,
      ligador_obs: c.ligador_obs,
    }))
    setRows([...pedidos, ...cadastrosComoCard])
  }
  useEffect(() => {
    if (!transmitindo) return
    carregar()
    const t = setInterval(carregar, 15000) // fichas novas aparecem sozinhas quando o gerente/admin conceder
    return () => clearInterval(t)
  }, [transmitindo]) // eslint-disable-line react-hooks/exhaustive-deps

  const onResponder = async (p, status, obs) => {
    const r = p._tipo === 'cadastro' ? await responderCadastro(p.id, status, obs) : await responderPedido(p.id, status, obs)
    if (r.ok) carregar()
    else alert(r.error || 'Não foi possível salvar a resposta.')
  }

  const pedirFichas = async () => {
    setPedindo(true)
    const r = await solicitarFichas()
    setPedindo(false)
    if (!r.ok) alert(r.error || 'Não foi possível pedir mais fichas.')
    carregar()
  }

  const sair = () => {
    transRef.current?.parar()
    logoutLigador()
    navigate('/ligador/entrar', { replace: true })
  }

  const aLigar = (rows || []).filter((p) => (p.ligador_status || 'a_ligar') === 'a_ligar')
  const retornos = (rows || []).filter((p) => p.ligador_status === 'retorno')
  const finalizados = (rows || []).filter((p) => p.ligador_status === 'bom' || p.ligador_status === 'ruim')
  const lista = aba === 'a_ligar' ? aLigar : aba === 'retorno' ? retornos : finalizados

  return (
    <main className="ligp">
      <header className="ligp__top">
        <div className="ligp__id">
          <strong>Painel do Ligador</strong>
          <span>Olá, {lig?.nome || 'ligador'}</span>
        </div>
        <div className="ligp__top-acoes">
          {transmitindo && (
            <span className={`ligp__live ${conectado ? '' : 'is-off'}`}>● {conectado ? 'Transmitindo' : 'Reconectando…'}</span>
          )}
          {transmitindo && <button className="ligp__sair" onClick={() => transRef.current?.parar()}>Parar</button>}
          <button className="ligp__sair" onClick={sair}>Sair</button>
        </div>
      </header>

      <div className="ligp__wrap">
        {!transmitindo ? (
          <div className="ligp__gate">
            <h2>Transmita sua tela pra ver as fichas</h2>
            {suportaTransmissao() ? (
              <>
                <p>
                  Clique no botão, escolha <strong>Tela inteira</strong> e marque <strong>Compartilhar áudio do sistema</strong>.
                  Depois permita o microfone. As fichas ficam visíveis só enquanto a transmissão estiver ativa.
                </p>
                <button className="ligp__gate-btn" onClick={iniciarTransmissao} disabled={iniciando}>
                  {iniciando ? 'Aguardando…' : '🖥️ Iniciar transmissão'}
                </button>
              </>
            ) : (
              <p>Este navegador não permite transmitir a tela. Use o Google Chrome ou o Edge num computador.</p>
            )}
            {transErro && <p className="cfg-warn">{transErro}</p>}
          </div>
        ) : (
        <>
        {semMic && <p className="cfg-warn">Microfone não liberado — só o áudio do computador está sendo transmitido.</p>}
        <div className="adm__tabs" role="tablist">
          <button className={`adm__tab ${aba === 'a_ligar' ? 'is-active' : ''}`} onClick={() => setAba('a_ligar')}>
            A ligar {rows && <span className="adm__tab-badge">{aLigar.length}</span>}
          </button>
          <button className={`adm__tab ${aba === 'retorno' ? 'is-active' : ''}`} onClick={() => setAba('retorno')}>
            Retornos {rows && <span className="adm__tab-badge">{retornos.length}</span>}
          </button>
          <button className={`adm__tab ${aba === 'fin' ? 'is-active' : ''}`} onClick={() => setAba('fin')}>
            Finalizados {rows && <span className="adm__tab-badge">{finalizados.length}</span>}
          </button>
        </div>

        {rows === null ? (
          <p className="usr-muted ligp__msg">Carregando…</p>
        ) : aba === 'a_ligar' && aLigar.length === 0 ? (
          <div className="ligp__gate">
            <h2>Você terminou suas fichas</h2>
            {situacao?.solicitacaoPendente ? (
              <p>Pedido enviado — aguardando a liberação de mais fichas. Elas aparecem aqui sozinhas.</p>
            ) : (
              <button className="ligp__gate-btn" onClick={pedirFichas} disabled={pedindo}>
                {pedindo ? 'Enviando…' : 'Liberar mais fichas'}
              </button>
            )}
          </div>
        ) : lista.length === 0 ? (
          <p className="usr-muted ligp__msg">{aba === 'retorno' ? 'Nenhum retorno pendente.' : 'Nada finalizado ainda.'}</p>
        ) : (
          <div className="ligp__list">
            {lista.map((p) => <CardLigar key={p.id} p={p} onResponder={onResponder} />)}
          </div>
        )}
        </>
        )}
      </div>
    </main>
  )
}
