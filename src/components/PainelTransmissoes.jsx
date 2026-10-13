import { useEffect, useRef, useState } from 'react'
import { conectarPainelTransmissoes } from '../lib/transmissao.js'

// Grade de ligadores + player. Usado pelo admin (vê todos) e pelo gerente (só os dele).
// credenciais() → { role:'admin', jwt } | { role:'gerente', token }
// carregarLigadores() → [{ id, usuario, nome, ativo }] cadastrados (pra mostrar os offline)
export default function PainelTransmissoes({ credenciais, carregarLigadores, onConexao }) {
  const [todos, setTodos] = useState([])
  const [online, setOnline] = useState([])
  const [assistindo, setAssistindo] = useState(null)
  const [temVideo, setTemVideo] = useState(false)
  const [somBloqueado, setSomBloqueado] = useState(false)
  const [estadoVideo, setEstadoVideo] = useState('')
  const painel = useRef(null)
  const videoRef = useRef(null)
  const cbs = useRef({ credenciais, carregarLigadores, onConexao })
  cbs.current = { credenciais, carregarLigadores, onConexao }

  useEffect(() => {
    cbs.current.carregarLigadores().then((d) => setTodos(Array.isArray(d) ? d : []))
    const p = conectarPainelTransmissoes({
      credenciais: () => cbs.current.credenciais(),
      onLista: setOnline,
      onEstadoVideo: setEstadoVideo,
      onConexao: (ok) => cbs.current.onConexao?.(ok),
      onStream: (stream) => {
        const v = videoRef.current
        if (!v) return
        v.srcObject = stream
        setTemVideo(true)
        v.play().then(() => setSomBloqueado(false)).catch(() => {
          v.muted = true
          setSomBloqueado(true)
          v.play().catch(() => {})
        })
      },
      onFim: () => {
        if (videoRef.current) videoRef.current.srcObject = null
        setTemVideo(false)
      },
    })
    painel.current = p
    return () => p.fechar()
  }, [])

  const assistir = (id) => {
    if (videoRef.current) videoRef.current.srcObject = null
    setTemVideo(false)
    setAssistindo(id)
    painel.current?.assistir(id)
  }
  const sair = () => {
    painel.current?.sair()
    if (videoRef.current) videoRef.current.srcObject = null
    setTemVideo(false)
    setAssistindo(null)
  }
  const ativarSom = () => {
    const v = videoRef.current
    if (!v) return
    v.muted = false
    v.play().then(() => setSomBloqueado(false)).catch(() => {})
  }
  const telaCheia = () => videoRef.current?.requestFullscreen?.().catch(() => {})

  const porId = new Map(online.map((o) => [o.id, o]))
  const cards = [
    ...online.filter((o) => !todos.some((t) => t.id === o.id)).map((o) => ({ id: o.id, nome: o.nome })),
    ...todos.filter((t) => t.ativo !== false).map((t) => ({ id: t.id, nome: t.nome || t.usuario })),
  ]
    .map((c) => ({ ...c, on: porId.get(c.id) }))
    .sort((a, b) => Number(!!b.on?.transmitindo) - Number(!!a.on?.transmitindo))

  const atual = cards.find((c) => c.id === assistindo)

  return (
    <>
      <div className="trs__grid">
        {cards.map((c) => {
          const tx = !!c.on?.transmitindo
          return (
            <button
              key={c.id}
              type="button"
              className={`trs__card ${tx ? 'is-live' : ''} ${assistindo === c.id ? 'is-sel' : ''}`}
              disabled={!tx}
              onClick={() => assistir(c.id)}
            >
              <strong>{c.nome || 'Ligador'}</strong>
              <span>{tx ? '● Transmitindo' : c.on ? 'Online, sem transmitir' : 'Offline'}</span>
              {tx && c.on.semMic && <small>sem microfone</small>}
            </button>
          )
        })}
        {!cards.length && <p className="usr-muted">Nenhum ligador cadastrado.</p>}
      </div>

      {assistindo && (
        <div className="trs__player">
          <div className="trs__player-top">
            <strong>{atual?.nome || 'Ligador'}</strong>
            <div className="trs__player-acoes">
              {somBloqueado && <button type="button" onClick={ativarSom}>🔊 Ativar som</button>}
              <button type="button" onClick={telaCheia}>Tela cheia</button>
              <button type="button" onClick={sair}>Sair</button>
            </div>
          </div>
          <div className="trs__video-wrap">
            <video ref={videoRef} className="trs__video" autoPlay playsInline controls />
            {estadoVideo === 'failed' && (
              <p className="trs__aguarde">Não foi possível conectar o vídeo com este ligador (a internet dele bloqueia conexão direta). Clique em Sair e tente de novo; se continuar, é preciso configurar um servidor TURN.</p>
            )}
            {!temVideo && <p className="trs__aguarde">{atual?.on?.transmitindo ? 'Conectando à tela…' : 'A transmissão terminou.'}</p>}
          </div>
        </div>
      )}
    </>
  )
}
