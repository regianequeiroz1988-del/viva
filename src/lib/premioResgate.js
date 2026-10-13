// Resgate do "prêmio instantâneo", guardado por CPF. O código só sai do banco
// conforme quem pergunta:
//  - ganhador (anônimo, pelo CPF): recebe o código só depois de declarar (ou com a
//    declaração desligada) — ganhador_consultar_premio.
//  - ligador (pelo token, só CPF da própria carteira): sempre recebe —
//    ligador_consultar_premio. Código, estado e valor são gravados pelo ligador
//    (ver definirCodigoPremio/definirEstadoPremio/definirValorPremio em lib/ligador.js).
// Estado: 'bloqueado' | 'liberado' | 'pagamento_parcial'.
import { supabase, isSupabaseConfigured } from './supabase.js'
import { getLigador } from './ligador.js'
import { onlyDigits } from '../utils/masks.js'

const vazio = () => ({ codigo: null, estado: 'bloqueado', valor: null })

const normalizar = (data) => {
  const row = Array.isArray(data) ? data[0] : data
  return {
    codigo: row?.codigo || null,
    estado: row?.estado || 'bloqueado',
    valor: row?.valor != null ? Number(row.valor) : null,
  }
}

/**
 * Consulta o resgate do /ganhador pelo CPF.
 * Devolve { codigo, estado, valor } — codigo fica null até a declaração estar regularizada.
 * `valor` null = usa o padrão global (CONFIG_KEYS.premioGanhadorValor).
 */
export async function consultarPremio(cpf) {
  const c = onlyDigits(cpf)
  if (c.length !== 11 || !isSupabaseConfigured) return vazio()
  const { data, error } = await supabase.rpc('ganhador_consultar_premio', { p_cpf: c })
  if (error) return vazio()
  return normalizar(data)
}

/** Consulta o resgate pelo ligador logado (sempre traz o código, só das fichas da carteira dele). */
export async function consultarPremioLigador(cpf) {
  const l = getLigador()
  const c = onlyDigits(cpf)
  if (!l?.token || c.length !== 11 || !isSupabaseConfigured) return vazio()
  const { data, error } = await supabase.rpc('ligador_consultar_premio', { p_token: l.token, p_cpf: c })
  if (error) return vazio()
  return normalizar(data)
}

/** Chave Pix que o ganhador informou (só CPF da carteira do ligador). null se não informou. */
export async function consultarPixLigador(cpf) {
  const l = getLigador()
  const c = onlyDigits(cpf)
  if (!l?.token || c.length !== 11 || !isSupabaseConfigured) return null
  const { data, error } = await supabase.rpc('ligador_premio_pix', { p_token: l.token, p_cpf: c })
  if (error) return null
  return (Array.isArray(data) ? data[0] : data) || null
}
