// Sinalização WebRTC das transmissões de tela dos ligadores (/ws/transmissao).
// O vídeo/áudio vai direto do navegador do ligador pro do admin (peer-to-peer);
// este servidor só autentica as duas pontas e repassa as mensagens de conexão.
//   ligador → { type:'auth', role:'ligador', token }   (token do login do ligador)
//   admin   → { type:'auth', role:'admin', jwt }       (sessão Supabase, is_admin)
import { WebSocketServer } from 'ws'
import { validarTokenAdmin } from './admin-handlers.js'

const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY
const UUID = /^[0-9a-f-]{36}$/i

const ligadores = new Map() // ligadorId -> { ws, nome, transmitindo, semMic }
const admins = new Map() // adminConnId -> ws
let seq = 0

const enviar = (ws, msg) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)) }

function lista() {
  return [...ligadores.entries()].map(([id, l]) => ({ id, nome: l.nome, transmitindo: l.transmitindo, semMic: l.semMic }))
}
function avisarAdmins(msg) { for (const ws of admins.values()) enviar(ws, msg) }
const atualizarLista = () => avisarAdmins({ type: 'lista', ligadores: lista() })

async function validarLigador(token) {
  if (!UUID.test(String(token || ''))) return null
  const r = await fetch(
    `${SUPA_URL}/rest/v1/ligadores?token=eq.${encodeURIComponent(token)}&ativo=is.true&select=id,nome,usuario`,
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
          const lig = await validarLigador(m.token)
          if (!lig) return ws.close(4001, 'token invalido')
          papel = 'ligador'
          meuId = lig.id
          const antigo = ligadores.get(meuId)
          if (antigo && antigo.ws !== ws) antigo.ws.close(4002, 'outra aba')
          ligadores.set(meuId, { ws, nome: lig.nome || lig.usuario, transmitindo: false, semMic: false })
        } else if (m.role === 'admin') {
          const a = await validarTokenAdmin(String(m.jwt || ''))
          if (!a.ok) return ws.close(4001, 'nao admin')
          papel = 'admin'
          meuId = `a${++seq}`
          admins.set(meuId, ws)
        } else return
        clearTimeout(prazoAuth)
        enviar(ws, { type: 'ok', id: meuId })
        if (papel === 'admin') enviar(ws, { type: 'lista', ligadores: lista() })
        else atualizarLista()
        return
      }

      if (papel === 'ligador') {
        const eu = ligadores.get(meuId)
        if (!eu || eu.ws !== ws) return
        if (m.type === 'transmitindo') {
          eu.transmitindo = !!m.ativo
          eu.semMic = !!m.semMic
          if (!eu.transmitindo) avisarAdmins({ type: 'fim', ligadorId: meuId })
          atualizarLista()
        } else if (m.type === 'signal') {
          enviar(admins.get(m.to), { type: 'signal', from: meuId, data: m.data })
        }
        return
      }

      // admin
      const alvo = ligadores.get(m.to)
      if (!alvo) return
      if (m.type === 'assistir') enviar(alvo.ws, { type: 'viewer-join', viewerId: meuId })
      else if (m.type === 'sair') enviar(alvo.ws, { type: 'viewer-leave', viewerId: meuId })
      else if (m.type === 'signal') enviar(alvo.ws, { type: 'signal', from: meuId, data: m.data })
    })

    ws.on('close', () => {
      clearTimeout(prazoAuth)
      if (papel === 'ligador' && ligadores.get(meuId)?.ws === ws) {
        ligadores.delete(meuId)
        avisarAdmins({ type: 'fim', ligadorId: meuId })
        atualizarLista()
      } else if (papel === 'admin') {
        admins.delete(meuId)
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
