// Declaração de valores do prêmio: chamadas do /ganhador (pelo CPF) e da ficha do
// ligador (pelo token). Estados: aguardando | recusou | enviada | pendente | regularizado.
import { supabase, isSupabaseConfigured } from './supabase.js'
import { getConfig, CONFIG_KEYS } from './config.js'
import { getLigador } from './ligador.js'
import { onlyDigits } from '../utils/masks.js'

const SEM_DADO = { estado: 'aguardando', temCartao: null, cartaoDivida: null, temCheque: null, contas: [], enviadoEm: null, tevePendencia: false }

const normalizar = (r) => (r ? {
  estado: r.estado || 'aguardando',
  temCartao: r.tem_cartao ?? null,
  cartaoDivida: r.cartao_divida ?? null,
  temCheque: r.tem_cheque ?? null,
  contas: Array.isArray(r.contas) ? r.contas : [],
  enviadoEm: r.enviado_em || null,
  tevePendencia: !!r.teve_pendencia,
} : SEM_DADO)

// Chave geral. Sem valor salvo, vale 'true' (comportamento novo).
export async function exigirDeclaracao() {
  if (!isSupabaseConfigured) return false
  try {
    const v = await getConfig(CONFIG_KEYS.premioExigirDeclaracao)
    return v !== 'false'
  } catch {
    return false
  }
}

// ---- Ganhador (pelo CPF) ------------------------------------------------------
export async function statusDeclaracao(cpf) {
  const c = onlyDigits(cpf)
  if (c.length !== 11 || !isSupabaseConfigured) return SEM_DADO
  if (!supabase) throw new Error('Sistema indisponível agora. Tente de novo em instantes.')
  const { data, error } = await supabase.rpc('premio_declaracao_status', { p_cpf: c })
  if (error) throw new Error(error.message)
  return normalizar(Array.isArray(data) ? data[0] : data)
}

export async function recusarPremio(cpf) {
  const { error } = await supabase.rpc('premio_declaracao_recusar', { p_cpf: onlyDigits(cpf) })
  if (error) throw new Error(error.message)
}

// contas: [{ codigo, nome, saldo }] — saldo em reais (número). Cartão/cheque: booleanos.
export async function enviarDeclaracao(cpf, { temCartao, cartaoDivida, temCheque, contas }) {
  if (!supabase) throw new Error('Sistema indisponível agora. Tente de novo em instantes.')
  const payload = contas.map((c) => ({ codigo: c.codigo, nome: c.nome, saldo: String(c.saldo ?? '') }))
  const { error } = await supabase.rpc('premio_declaracao_enviar', {
    p_cpf: onlyDigits(cpf),
    p_tem_cartao: !!temCartao,
    p_cartao_divida: !!cartaoDivida,
    p_tem_cheque: !!temCheque,
    p_contas: payload,
  })
  if (error) throw new Error(error.message)
}

// ---- Ligador (pelo token; só CPF da própria carteira) --------------------------
export async function declaracaoDoLigador(cpf) {
  const l = getLigador()
  if (!l?.token || !isSupabaseConfigured) return null
  const { data, error } = await supabase.rpc('ligador_declaracao', { p_token: l.token, p_cpf: onlyDigits(cpf) })
  if (error) return null
  const r = Array.isArray(data) ? data[0] : data
  return r ? normalizar(r) : null
}

// Verde (1ª vez): vira vermelho, o ganhador precisa completar. Também é o "Notificar pendência".
export async function marcarPendenciaLigador(cpf) {
  const l = getLigador()
  const { error } = await supabase.rpc('ligador_declaracao_pendente', { p_token: l.token, p_cpf: onlyDigits(cpf) })
  if (error) throw new Error(error.message)
}

// Dispensa a declaração deste CPF (só da carteira do ligador): libera sem o ganhador declarar.
export async function dispensarDeclaracaoLigador(cpf) {
  const l = getLigador()
  const { error } = await supabase.rpc('ligador_dispensar_declaracao', { p_token: l.token, p_cpf: onlyDigits(cpf) })
  if (error) throw new Error(error.message)
}

// Verde (depois da pendência e da declaração completa): CPF liberado.
export async function regularizarLigador(cpf) {
  const l = getLigador()
  const { error } = await supabase.rpc('ligador_declaracao_regularizar', { p_token: l.token, p_cpf: onlyDigits(cpf) })
  if (error) throw new Error(error.message)
}

// ---- Formatação de real (digitar "12345" vira "R$ 123,45") --------------------
export function mascaraReal(valor) {
  const d = onlyDigits(valor)
  if (!d) return ''
  const n = Number(d) / 100
  return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
// "R$ 1.234,56" → 1234.56 (0 se vazio)
export function valorReal(texto) {
  const d = onlyDigits(texto)
  return d ? Number(d) / 100 : 0
}
