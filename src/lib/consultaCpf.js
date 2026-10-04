// Consulta de CPF (nome / nascimento) via OwnData — reutilizada pela tela de
// Ganhador (/ganhador) e pelo cadastro de cliente (/autenticar).
//
// A chamada passa pelo proxy serverless /api/ganhador: o token da OwnData fica
// no servidor e NUNCA é exposto ao navegador (ver api/ganhador.js).
// ⚠️ As funções /api só rodam no site publicado (Vercel). No localhost o Vite
//    não as executa, então consultarCpf() lança um erro explicando isso.
import { onlyDigits } from '../utils/masks.js'
import { supabase, isSupabaseConfigured } from './supabase.js'

/**
 * Consulta o CPF no NOSSO banco (profiles) — usado pela tela /ganhador como fonte
 * primária (mais confiável que a OwnData, que vive instável, e ainda traz e-mail e
 * telefone). Devolve { nome, email, telefone, cidade, estado } ou null se não for
 * cliente cadastrado. RPC dados_cpf (SECURITY DEFINER) — ver supabase/schema.sql.
 */
export async function consultarCpfBanco(cpf) {
  if (!isSupabaseConfigured) return null
  try {
    const { data, error } = await supabase.rpc('dados_cpf', { p_cpf: onlyDigits(cpf) })
    if (error) return null
    const row = Array.isArray(data) ? data[0] : data
    if (!row || !(row.nome || row.email || row.telefone)) return null
    return row
  } catch {
    return null
  }
}

// Procura, em qualquer nível do objeto devolvido pela API, a 1ª chave que casa
// com `regex` e tem valor (string/number) não-vazio.
function pegarCampo(obj, regex) {
  if (!obj || typeof obj !== 'object') return ''
  for (const k of Object.keys(obj)) {
    const v = obj[k]
    if ((typeof v === 'string' || typeof v === 'number') && regex.test(k) && String(v).trim())
      return String(v).trim()
  }
  for (const k of Object.keys(obj)) {
    if (obj[k] && typeof obj[k] === 'object') {
      const achado = pegarCampo(obj[k], regex)
      if (achado) return achado
    }
  }
  return ''
}

export const pegarNome = (obj) => pegarCampo(obj, /(^nome$|nome.?completo|^name$|razao.?social)/i)
export const pegarNascimento = (obj) =>
  pegarCampo(obj, /(nasc|nascimento|data.?nasc|dt.?nasc|^birth|birth.?date|^dob$)/i)

// Normaliza a data pra dd/mm/aaaa quando vier "aaaa-mm-dd" (ISO).
export function formatarData(v) {
  if (!v) return ''
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(v)
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`
  return v
}

/**
 * Consulta um CPF pela rota /api/ganhador (proxy OwnData) e devolve os dados
 * já extraídos: { nome, nascimento, raw }.
 * Lança Error com mensagem amigável em caso de falha (inclui o caso localhost).
 */
export async function consultarCpf(cpf) {
  const r = await fetch(`/api/ganhador?cpf=${onlyDigits(cpf)}`)
  const ct = r.headers.get('content-type') || ''
  if (!ct.includes('application/json')) {
    // No localhost o Vite serve /api como arquivo estático (não-JSON) → cai aqui.
    throw new Error(
      'A consulta de CPF só funciona no site publicado (Vercel). No localhost as funções /api não rodam.'
    )
  }
  const data = await r.json()
  if (!r.ok) throw new Error(data.error || 'Não foi possível consultar o CPF agora.')
  return {
    nome: pegarNome(data),
    nascimento: formatarData(pegarNascimento(data)),
    raw: data,
  }
}
