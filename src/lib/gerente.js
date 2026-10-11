// Sessão + acesso a dados do GERENTE. Login próprio (usuário+senha), igual ao
// ligador: o login devolve um token (uuid) que autentica as RPCs gerente_*.
import { supabase, isSupabaseConfigured } from './supabase.js'

const KEY = 'vs_gerente'

export function getGerente() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || 'null')
  } catch {
    return null
  }
}

function setGerente(g) {
  try {
    if (g) localStorage.setItem(KEY, JSON.stringify(g))
    else localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}

export function logoutGerente() {
  setGerente(null)
}

export async function loginGerente(usuario, senha) {
  if (!isSupabaseConfigured) return { ok: false, error: 'Supabase não configurado.' }
  const { data, error } = await supabase.rpc('gerente_login', {
    p_usuario: String(usuario || '').trim(),
    p_senha: String(senha || ''),
  })
  if (error) return { ok: false, error: error.message }
  const row = Array.isArray(data) ? data[0] : data
  if (!row?.token) return { ok: false, error: 'Usuário ou senha incorretos.' }
  setGerente({ id: row.id, nome: row.nome || '', token: row.token })
  return { ok: true }
}

async function rpc(nome, args = {}) {
  const g = getGerente()
  if (!g?.token || !isSupabaseConfigured) return { data: null, error: { message: 'sessão expirada' } }
  return supabase.rpc(nome, { p_token: g.token, ...args })
}

const lista = async (nome) => {
  const { data, error } = await rpc(nome)
  return error || !Array.isArray(data) ? [] : data
}

export const ligadoresGerente = () => lista('gerente_ligadores')
export const solicitacoesGerente = () => lista('gerente_solicitacoes')

// { estoque, solicitacaoPendente }
export async function situacaoGerente() {
  const { data, error } = await rpc('gerente_situacao')
  const r = Array.isArray(data) ? data[0] : data
  return error || !r ? null : { estoque: r.estoque, solicitacaoPendente: r.solicitacao_pendente, automatico: !!r.recebe_automatico }
}

export async function concederFichas(solicitacaoId, qtd) {
  const { data, error } = await rpc('gerente_conceder_fichas', { p_solicitacao: solicitacaoId, p_qtd: qtd })
  return error ? { ok: false, error: error.message } : { ok: true, liberadas: data }
}

export async function recusarSolicitacao(solicitacaoId) {
  const { error } = await rpc('gerente_recusar_solicitacao', { p_solicitacao: solicitacaoId })
  return error ? { ok: false, error: error.message } : { ok: true }
}

export async function pedirFichasAdmin(qtd) {
  const { error } = await rpc('gerente_solicitar_fichas', { p_qtd: qtd || 0 })
  return error ? { ok: false, error: error.message } : { ok: true }
}

// Fichas do estoque, uma por Pix: [{ tipo: 'pago'|'pendente'|'cadastro', id, nome, telefone, cidade, uf, total, created_at, ordem }]
export const estoqueGerente = () => lista('gerente_estoque')

export async function enviarFichas(ligadorId, fichas) {
  const pedidos = fichas.filter((f) => f.tipo !== 'cadastro').map((f) => f.id)
  const cadastros = fichas.filter((f) => f.tipo === 'cadastro').map((f) => f.id)
  const { data, error } = await rpc('gerente_enviar_fichas', { p_ligador: ligadorId, p_pedidos: pedidos, p_cadastros: cadastros })
  return error ? { ok: false, error: error.message } : { ok: true, enviadas: data }
}

export async function acessosGerente(desde) {
  const { data, error } = await rpc('gerente_acessos', { p_desde: desde })
  if (error) throw new Error(error.message)
  return data
}

// Libera (ou volta a exigir) a transmissão de tela pra um ligador do gerente.
export async function liberarSemTransmissao(ligadorId, ativo) {
  const { error } = await rpc('gerente_liberar_sem_transmissao', { p_ligador: ligadorId, p_ativo: ativo })
  return error ? { ok: false, error: error.message } : { ok: true }
}
