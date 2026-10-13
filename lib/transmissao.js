// Sinalização WebRTC das transmissões de tela dos ligadores (/ws/transmissao).
// O vídeo/áudio vai direto do navegador do ligador pro de quem assiste (peer-to-peer);
// este servidor só autentica as duas pontas e repassa as mensagens de conexão.
//   ligador → { type:'auth', role:'ligador', token }   (token do login do ligador)
//   admin   → { type:'auth', role:'admin', jwt }       (sessão Supabase, is_admin) — vê todos
//   gerente → { type:'auth', role:'gerente', token }   (token do login do gerente) — só os dele
import { WebSocketServer } from 'ws'
import { validarTokenAdmin } from './admin-handlers.js'

const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY
const UUID = /^[0-9a-f-]{36}$/i

// STUN do Google + TURN opcional (TURN_URLS separadas por vírgula, TURN_USERNAME, TURN_CREDENTIAL).
// Sem TURN, quem está atrás de 4G/NAT de operadora pode não conseguir conectar o vídeo.
function iceServers() {
  const lista = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }]
  const urls = String(process.env.TURN_URLS || '').split(',').map((u) => u.trim()).filter(Boolean)
  if (urls.length) lista.push({ urls, username: process.env.TURN_USERNAME || '', credential: process.env.TURN_CREDENTIAL || '' })
  return lista
}

const ligadores = new Map() // ligadorId -> { ws, nome, gerenteId, transmitindo, semMic }
const viewers = new Map() // connId -> { ws, gerenteId } (gerenteId null = admin, vê todos)
let seq = 0

const enviar = (ws, msg) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)) }

const podeVer = (viewer, lig) => !!viewer && !!lig && (viewer.gerenteId === null || viewer.gerenteId === lig.gerenteId)

function lista(viewer) {
  return [...ligadores.entries()]
    .filter(([, l]) => podeVer(viewer, l))
    .map(([id, l]) => ({ id, nome: l.nome, transmitindo: l.transmitindo, semMic: l.semMic }))
}
function avisarFim(ligadorId, lig) {
  for (const v of viewers.values()) if (podeVer(v, lig)) enviar(v.ws, { type: 'fim', ligadorId })
}
function atualizarLista() {
  for (const v of viewers.values()) enviar(v.ws, { type: 'lista', ligadores: lista(v) })
}

async function buscar(tabela, token, campos) {
  if (!UUID.test(String(token || ''))) return null
  const r = await fetch(
    `${SUPA_URL}/rest/v1/${tabela}?token=eq.${encodeURIComponent(token)}&ativo=is.true&select=${campos}`,
    { headers: { apikey: SRK, Authorization: `Bearer ${SRK}` } }
  ).catch(() => null)
  const rows = r && r.ok ? await r.json().catch(() => []) : []
  return rows?.[0] || null
}

export function iniciarTransmissao(server) {
  const wss = new WebSocketServer({ server, path: '/ws/transmissao', maxPayload: 256 * 1024 })

  wss.on('connection', (ws) => {
    let papel = null
    let meuId = null
    ws.vivo = true
    ws.on('pong', () => { ws.vivo = true })
    const prazoAuth = setTimeout(() => ws.close(4001, 'sem auth'), 10000)

    ws.on('message', async (raw) => {
      let m
      try { m = JSON.parse(raw) } catch { return }

      if (!papel) {
        if (m?.type !== 'auth') return
        if (m.role === 'ligador') {
          // sem a coluna gerente_id (gerentes_setup.sql não rodado) a 1ª busca falha
          const lig = await buscar('ligadores', m.token, 'id,nome,usuario,gerente_id')
            || await buscar('ligadores', m.token, 'id,nome,usuario')
          if (!lig) return ws.close(4001, 'token invalido')
          papel = 'ligador'
          meuId = lig.id
          const antigo = ligadores.get(meuId)
          if (antigo && antigo.ws !== ws) antigo.ws.close(4002, 'outra aba')
          ligadores.set(meuId, { ws, nome: lig.nome || lig.usuario, gerenteId: lig.gerente_id || null, transmitindo: false, semMic: false })
        } else if (m.role === 'admin') {
          const a = await validarTokenAdmin(String(m.jwt || ''))
          if (!a.ok) return ws.close(4001, 'nao admin')
          papel = 'viewer'
          meuId = `a${++seq}`
          viewers.set(meuId, { ws, gerenteId: null })
        } else if (m.role === 'gerente') {
          const g = await buscar('gerentes', m.token, 'id')
          if (!g) return ws.close(4001, 'token invalido')
          papel = 'viewer'
          meuId = `g${++seq}`
          viewers.set(meuId, { ws, gerenteId: g.id })
        } else return
        clearTimeout(prazoAuth)
        enviar(ws, { type: 'ok', id: meuId, ice: iceServers() })
        if (papel === 'viewer') enviar(ws, { type: 'lista', ligadores: lista(viewers.get(meuId)) })
        else atualizarLista()
        return
      }

      if (papel === 'ligador') {
        const eu = ligadores.get(meuId)
        if (!eu || eu.ws !== ws) return
        if (m.type === 'transmitindo') {
          eu.transmitindo = !!m.ativo
          eu.semMic = !!m.semMic
          if (!eu.transmitindo) avisarFim(meuId, eu)
          atualizarLista()
        } else if (m.type === 'signal') {
          const v = viewers.get(m.to)
          if (podeVer(v, eu)) enviar(v.ws, { type: 'signal', from: meuId, data: m.data })
        }
        return
      }

      // quem assiste (admin ou gerente)
      const alvo = ligadores.get(m.to)
      if (!podeVer(viewers.get(meuId), alvo)) return
      if (m.type === 'assistir') enviar(alvo.ws, { type: 'viewer-join', viewerId: meuId })
      else if (m.type === 'sair') enviar(alvo.ws, { type: 'viewer-leave', viewerId: meuId })
      else if (m.type === 'signal') enviar(alvo.ws, { type: 'signal', from: meuId, data: m.data })
    })

    ws.on('close', () => {
      clearTimeout(prazoAuth)
      if (papel === 'ligador') {
        const eu = ligadores.get(meuId)
        if (eu?.ws !== ws) return
        ligadores.delete(meuId)
        avisarFim(meuId, eu)
        atualizarLista()
      } else if (papel === 'viewer') {
        viewers.delete(meuId)
        for (const l of ligadores.values()) enviar(l.ws, { type: 'viewer-leave', viewerId: meuId })
      }
    })
  })

  // Mantém as conexões vivas (o proxy do Render derruba sockets ociosos).
  setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.vivo) { ws.terminate(); continue }
      ws.vivo = false
      ws.ping()
    }
  }, 25000)
}
