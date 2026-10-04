// Resgate do "prêmio instantâneo" do /ganhador — guardado por CPF (RPC
// consultar_premio, pública). Código, estado e valor são gravados pelo
// ligador (ver definirCodigoPremio/definirEstadoPremio/definirValorPremio em
// lib/ligador.js). Estado: 'bloqueado' | 'liberado' | 'pagamento_parcial'.
import { supabase, isSupabaseConfigured } from './supabase.js'
import { onlyDigits } from '../utils/masks.js'

/**
 * Consulta o estado do resgate pro CPF.
 * Devolve { codigo, estado, valor } — estado='bloqueado' se não achar nada.
 * `valor` null = usa o padrão global (CONFIG_KEYS.premioGanhadorValor).
 */
export async function consultarPremio(cpf) {
  const c = onlyDigits(cpf)
  if (c.length !== 11 || !isSupabaseConfigured) return { codigo: null, estado: 'bloqueado', valor: null }
  const { data, error } = await supabase.rpc('consultar_premio', { p_cpf: c })
  if (error) return { codigo: null, estado: 'bloqueado', valor: null }
  const row = Array.isArray(data) ? data[0] : data
  return {
    codigo: row?.codigo || null,
    estado: row?.estado || 'bloqueado',
    valor: row?.valor != null ? Number(row.valor) : null,
  }
}
