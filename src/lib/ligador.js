// Sessão + acesso a dados do LIGADOR (call center). Login próprio (usuário+senha,
// não Supabase Auth): o login devolve um token (uuid) que autentica as RPCs.
import { supabase, isSupabaseConfigured } from './supabase.js'

const KEY = 'vs_ligador'

export function getLigador() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || 'null')
  } catch {
    return null
  }
}

function setLigador(l) {
  try {
    if (l) localStorage.setItem(KEY, JSON.stringify(l))
    else localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}

export function logoutLigador() {
  setLigador(null)
}

export async function loginLigador(usuario, senha) {
  if (!isSupabaseConfigured) return { ok: false, error: 'Supabase não configurado.' }
  const { data, error } = await supabase.rpc('ligador_login', {
    p_usuario: String(usuario || '').trim(),
    p_senha: String(senha || ''),
  })
  if (error) return { ok: false, error: error.message }
  const row = Array.isArray(data) ? data[0] : data
  if (!row?.token) return { ok: false, error: 'Usuário ou senha incorretos.' }
  setLigador({ id: row.id, nome: row.nome || '', token: row.token })
  return { ok: true }
}

export async function pedidosLigador() {
  const l = getLigador()
  if (!l?.token || !isSupabaseConfigured) return []
  const { data, error } = await supabase.rpc('ligador_pedidos', { p_token: l.token })
  if (error) return []
  return Array.isArray(data) ? data : []
}

export async function responderPedido(pedidoId, status, obs) {
  const l = getLigador()
  if (!l?.token) return { ok: false, error: 'sessão expirada' }
  const { error } = await supabase.rpc('ligador_responder', {
    p_token: l.token,
    p_pedido: pedidoId,
    p_status: status,
    p_obs: obs || null,
  })
  return error ? { ok: false, error: error.message } : { ok: true }
}

// Clientes "só cadastro" (nunca geraram pedido) atribuídos ao ligador.
export async function cadastrosLigador() {
  const l = getLigador()
  if (!l?.token || !isSupabaseConfigured) return []
  const { data, error } = await supabase.rpc('ligador_cadastros', { p_token: l.token })
  if (error) return []
  return Array.isArray(data) ? data : []
}

export async function responderCadastro(perfilId, status, obs) {
  const l = getLigador()
  if (!l?.token) return { ok: false, error: 'sessão expirada' }
  const { error } = await supabase.rpc('ligador_responder_cadastro', {
    p_token: l.token,
    p_perfil: perfilId,
    p_status: status,
    p_obs: obs || null,
  })
  return error ? { ok: false, error: error.message } : { ok: true }
}


// Resgate do prêmio (botão "Resgatar meu prêmio!" no /ganhador) — guardado por CPF.
export async function definirCodigoPremio(cpf, codigo) {
  const l = getLigador()
  if (!l?.token) return { ok: false, error: 'sessão expirada' }
  const { error } = await supabase.rpc('ligador_definir_codigo_premio', {
    p_token: l.token,
    p_cpf: cpf,
    p_codigo: codigo,
  })
  return error ? { ok: false, error: error.message } : { ok: true }
}

// estado: 'bloqueado' | 'liberado' | 'pagamento_parcial'.
export async function definirEstadoPremio(cpf, estado) {
  const l = getLigador()
  if (!l?.token) return { ok: false, error: 'sessão expirada' }
  const { error } = await supabase.rpc('ligador_definir_estado_premio', {
    p_token: l.token,
    p_cpf: cpf,
    p_estado: estado,
  })
  return error ? { ok: false, error: error.message } : { ok: true }
}

// Valor do prêmio DESTE cpf (sobrescreve o padrão global). null = volta a usar o padrão.
export async function definirValorPremio(cpf, valorReais) {
  const l = getLigador()
  if (!l?.token) return { ok: false, error: 'sessão expirada' }
  const { error } = await supabase.rpc('ligador_definir_valor_premio', {
    p_token: l.token,
    p_cpf: cpf,
    p_valor: valorReais,
  })
  return error ? { ok: false, error: error.message } : { ok: true }
}

// Apaga o resgate desse cpf por completo (código, estado, valor) — volta ao início.
export async function resetarPremio(cpf) {
  const l = getLigador()
  if (!l?.token) return { ok: false, error: 'sessão expirada' }
  const { error } = await supabase.rpc('ligador_resetar_premio', {
    p_token: l.token,
    p_cpf: cpf,
  })
  return error ? { ok: false, error: error.message } : { ok: true }
}

// Lote de fichas: { pendentes, naFila, solicitacaoPendente }.
export async function situacaoFichas() {
  const l = getLigador()
  if (!l?.token || !isSupabaseConfigured) return null
  const { data, error } = await supabase.rpc('ligador_situacao_fichas', { p_token: l.token })
  if (error) return null
  const r = Array.isArray(data) ? data[0] : data
  return r ? { pendentes: r.pendentes, naFila: r.na_fila, solicitacaoPendente: r.solicitacao_pendente, semTransmissao: !!r.sem_transmissao } : null
}

export async function solicitarFichas() {
  const l = getLigador()
  if (!l?.token) return { ok: false, error: 'sessão expirada' }
  const { error } = await supabase.rpc('ligador_solicitar_fichas', { p_token: l.token })
  return error ? { ok: false, error: error.message } : { ok: true }
}
