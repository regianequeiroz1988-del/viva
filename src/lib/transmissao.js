// Transmissão de tela (WebRTC) ligador → admin. Sinalização em /ws/transmissao
// (lib/transmissao.js no servidor); vídeo e áudio vão direto entre os navegadores.

// Trocado pelo que o servidor mandar no 'ok' (inclui TURN, se configurado).
let ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }]

export const suportaTransmissao = () =>
  typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia && typeof RTCPeerConnection !== 'undefined'

function urlWs() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${location.host}/ws/transmissao`
}

// Socket com reconexão automática. `onMsg` recebe as mensagens já em JSON;
// `onStatus(conectado)` avisa quando autenticou / caiu.
function abrirSocket(auth, onMsg, onStatus) {
  let ws = null
  let fechado = false
  let timer = null
  const conectar = () => {
    ws = new WebSocket(urlWs())
    ws.onopen = async () => {
      const a = await auth()
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'auth', ...a }))
    }
    ws.onmessage = (e) => {
      let m
      try { m = JSON.parse(e.data) } catch { return }
      if (m.type === 'ok') { if (Array.isArray(m.ice) && m.ice.length) ICE = m.ice; onStatus(true) }
      onMsg(m)
    }
    ws.onclose = (e) => {
      onStatus(false)
      if (fechado || e.code === 4001 || e.code === 4002) return
      timer = setTimeout(conectar, 3000)
    }
  }
  conectar()
  return {
    enviar: (msg) => { if (ws?.readyState === 1) ws.send(JSON.stringify(msg)) },
    fechar: () => { fechado = true; clearTimeout(timer); ws?.close() },
  }
}

// Fila de candidatos ICE que chegam antes da descrição remota.
function criarPeer(onCandidato) {
  const pc = new RTCPeerConnection({ iceServers: ICE })
  const fila = []
  pc.onicecandidate = (e) => { if (e.candidate) onCandidato(e.candidate) }
  return {
    pc,
    async remota(desc) {
      await pc.setRemoteDescription(desc)
      while (fila.length) await pc.addIceCandidate(fila.shift()).catch(() => {})
    },
    async candidato(c) {
      if (pc.remoteDescription) await pc.addIceCandidate(c).catch(() => {})
      else fila.push(c)
    },
  }
}

// ---------------------------------------------------------------------------
// LIGADOR: captura tela inteira + áudio do sistema + microfone (misturados).
// ---------------------------------------------------------------------------
export async function iniciarTransmissaoLigador({ token, onFim, onConexao }) {
  const tela = await navigator.mediaDevices.getDisplayMedia({
    video: { displaySurface: 'monitor', frameRate: { ideal: 15, max: 20 } },
    audio: true,
    systemAudio: 'include',
    selfBrowserSurface: 'exclude',
    preferCurrentTab: false,
    monitorTypeSurfaces: 'include',
    surfaceSwitching: 'exclude',
  })
  const video = tela.getVideoTracks()[0]
  const superficie = video?.getSettings?.().displaySurface
  // Só aceita tela inteira COMPROVADA: alguns navegadores não informam
  // displaySurface — aí vale o rótulo da captura ("screen:..." = monitor).
  const ehTelaInteira = superficie ? superficie === 'monitor' : /^screen:/i.test(video?.label || '')
  if (!ehTelaInteira) {
    tela.getTracks().forEach((t) => t.stop())
    throw new Error('Escolha "Tela inteira" ao compartilhar (não vale só uma janela ou aba).')
  }
  if (!tela.getAudioTracks().length) {
    tela.getTracks().forEach((t) => t.stop())
    throw new Error('Deixe ligado "Compartilhar com áudio do sistema" ao compartilhar a tela.')
  }

  // Microfone é obrigatório: sem ele não dá pra ouvir o ligador falando.
  let mic = null
  try {
    mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
  } catch { mic = null }
  if (!mic?.getAudioTracks().length) {
    tela.getTracks().forEach((t) => t.stop())
    throw new Error('Libere o microfone pra transmitir. Clique no cadeado ao lado do endereço do site → Microfone → Permitir, e tente de novo.')
  }

  // Mistura áudio do sistema + microfone numa faixa só (o <video> do admin toca uma).
  const fontes = [...tela.getAudioTracks(), ...(mic ? mic.getAudioTracks() : [])]
  let ctx = null
  let audio = null
  if (fontes.length) {
    ctx = new AudioContext()
    ctx.resume().catch(() => {})
    const destino = ctx.createMediaStreamDestination()
    for (const t of fontes) ctx.createMediaStreamSource(new MediaStream([t])).connect(destino)
    audio = destino.stream.getAudioTracks()[0]
  }
  const saida = new MediaStream([video, ...(audio ? [audio] : [])])
  const semMic = !mic

  const peers = new Map() // viewerId -> peer
  const fecharPeer = (id) => { peers.get(id)?.pc.close(); peers.delete(id) }

  const sock = abrirSocket(
    () => ({ role: 'ligador', token }),
    async (m) => {
      if (m.type === 'ok') sock.enviar({ type: 'transmitindo', ativo: true, semMic })
      else if (m.type === 'viewer-join') {
        fecharPeer(m.viewerId)
        const peer = criarPeer((c) => sock.enviar({ type: 'signal', to: m.viewerId, data: { candidate: c } }))
        peers.set(m.viewerId, peer)
        saida.getTracks().forEach((t) => peer.pc.addTrack(t, saida))
        const oferta = await peer.pc.createOffer()
        await peer.pc.setLocalDescription(oferta)
        sock.enviar({ type: 'signal', to: m.viewerId, data: { sdp: peer.pc.localDescription } })
      } else if (m.type === 'viewer-leave') fecharPeer(m.viewerId)
      else if (m.type === 'signal') {
        const peer = peers.get(m.from)
        if (!peer) return
        if (m.data?.sdp) await peer.remota(m.data.sdp)
        else if (m.data?.candidate) await peer.candidato(m.data.candidate)
      }
    },
    (ok) => onConexao?.(ok)
  )

  let parado = false
  const parar = () => {
    if (parado) return
    parado = true
    sock.enviar({ type: 'transmitindo', ativo: false })
    for (const id of [...peers.keys()]) fecharPeer(id)
    sock.fechar()
    tela.getTracks().forEach((t) => t.stop())
    mic?.getTracks().forEach((t) => t.stop())
    ctx?.close().catch(() => {})
    onFim?.()
  }
  video.addEventListener('ended', parar) // clicou em "Parar compartilhamento" do navegador
  // Tirou o microfone (desconectou ou revogou a permissão) → a transmissão cai.
  mic.getAudioTracks().forEach((t) => t.addEventListener('ended', parar))
  return { parar, semMic }
}

// ---------------------------------------------------------------------------
// ADMIN/GERENTE: lista quem está online e assiste um ligador por vez.
// credenciais() → { role:'admin', jwt } ou { role:'gerente', token }
// ---------------------------------------------------------------------------
export function conectarPainelTransmissoes({ credenciais, onLista, onStream, onFim, onConexao, onEstadoVideo }) {
  let assistindo = null
  let peer = null

  const encerrar = () => { peer?.pc.close(); peer = null }

  const sock = abrirSocket(
    credenciais,
    async (m) => {
      if (m.type === 'lista') onLista(m.ligadores || [])
      else if (m.type === 'fim' && m.ligadorId === assistindo) {
        encerrar()
        onFim?.(m.ligadorId)
      } else if (m.type === 'signal' && m.from === assistindo) {
        if (m.data?.sdp) {
          encerrar()
          const alvo = assistindo
          peer = criarPeer((c) => sock.enviar({ type: 'signal', to: alvo, data: { candidate: c } }))
          peer.pc.ontrack = (e) => onStream(e.streams[0] || new MediaStream([e.track]))
          peer.pc.onconnectionstatechange = () => onEstadoVideo?.(peer?.pc.connectionState)
          await peer.remota(m.data.sdp)
          const resposta = await peer.pc.createAnswer()
          await peer.pc.setLocalDescription(resposta)
          sock.enviar({ type: 'signal', to: alvo, data: { sdp: peer.pc.localDescription } })
        } else if (m.data?.candidate && peer) await peer.candidato(m.data.candidate)
      }
    },
    (ok) => {
      onConexao?.(ok)
      if (ok && assistindo) sock.enviar({ type: 'assistir', to: assistindo }) // reconectou
    }
  )

  return {
    assistir(ligadorId) {
      if (assistindo) sock.enviar({ type: 'sair', to: assistindo })
      encerrar()
      assistindo = ligadorId
      sock.enviar({ type: 'assistir', to: ligadorId })
    },
    sair() {
      if (assistindo) sock.enviar({ type: 'sair', to: assistindo })
      encerrar()
      assistindo = null
    },
    fechar() {
      this.sair()
      sock.fechar()
    },
  }
}
