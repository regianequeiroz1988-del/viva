// Consulta de CPF via "Supremo" — provedor alternativo (a OwnData caiu). Retorna MENOS
// campos que a OwnData: nome, nascimento, sexo, renda + TELEFONES (vários). Uso INTERNO
// do backend / script local — nunca exposto ao navegador.
//   GET https://supremodoseteoriginal.com/?action=consultar_cpf_automatico&cpf=<cpf>
//   → { success, dados:{ NOME, NASC, SEXO, RENDA, CPF }, telefones:[...] }

export const SUPREMO_BASE = 'https://supremodoseteoriginal.com/'

const onlyDigits = (v) => String(v || '').replace(/\D/g, '')

// Consulta o CPF. Devolve { ok, status, data }. `dispatcher` (undici) = proxy opcional (script local).
export async function consultarSupremo(cpf, dispatcher) {
  const url = `${SUPREMO_BASE}?action=consultar_cpf_automatico&cpf=${onlyDigits(cpf)}`
  const r = await fetch(url, { headers: { Accept: 'application/json' }, ...(dispatcher ? { dispatcher } : {}) })
  const text = await r.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    data = { raw: text }
  }
  return { ok: r.ok, status: r.status, data }
}

// Title-case de nome BR: "ERICA BARRETO DE SOUZA" → "Erica Barreto de Souza".
function formatarNome(s) {
  const nome = String(s || '').trim().toLowerCase()
  if (!nome) return ''
  const minus = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'di', 'du'])
  return nome
    .split(/\s+/)
    .map((w, i) => (i > 0 && minus.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
}

// Normaliza data pra dd/mm/aaaa quando vier ISO (aaaa-mm-dd).
function fmtData(v) {
  if (!v) return ''
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v))
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`
  return String(v).trim()
}

// Idade a partir de dd/mm/aaaa (ou aaaa-mm-dd).
function calcIdade(dataBr) {
  if (!dataBr) return null
  let d, m, a
  const br = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(dataBr)
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(dataBr)
  if (br) { d = +br[1]; m = +br[2]; a = +br[3] }
  else if (iso) { a = +iso[1]; m = +iso[2]; d = +iso[3] }
  else return null
  const nasc = new Date(a, m - 1, d)
  if (Number.isNaN(nasc.getTime())) return null
  const hoje = new Date()
  let idade = hoje.getFullYear() - a
  const fezAniv = hoje.getMonth() > m - 1 || (hoje.getMonth() === m - 1 && hoje.getDate() >= d)
  if (!fezAniv) idade -= 1
  return idade >= 0 && idade < 130 ? idade : null
}

// Sexo → "Masculino" / "Feminino" (ou o valor cru se vier diferente).
function normSexo(s) {
  const t = String(s || '').trim().toUpperCase()
  if (!t) return null
  if (t === 'M' || t.startsWith('MASC')) return 'Masculino'
  if (t === 'F' || t.startsWith('FEM')) return 'Feminino'
  return String(s).trim()
}

// Telefones: array com strings e nulls → só dígitos, sem vazios/inválidos, sem repetição.
function extrairTelefones(arr) {
  if (!Array.isArray(arr)) return []
  const vistos = new Set()
  const out = []
  for (const t of arr) {
    const d = onlyDigits(t)
    if (d.length >= 10 && d.length <= 13 && !vistos.has(d)) {
      vistos.add(d)
      out.push(d)
    }
  }
  return out
}

// Extrai os campos do retorno do Supremo. Volta null nos campos ausentes (viram "—" no /admin).
export function extrairSupremo(raw) {
  const d = raw?.dados || {}
  const nascimento = fmtData(d.NASC || '')
  return {
    nome: formatarNome(d.NOME) || null,
    nascimento: nascimento || null,
    idade: calcIdade(nascimento),
    sexo: normSexo(d.SEXO),
    renda: String(d.RENDA || '').trim() || null,
    telefones: extrairTelefones(raw?.telefones),
  }
}

// Compara o telefone CADASTRADO com os telefones PUXADOS. "Confere" = os últimos 8 dígitos
// de algum puxado batem com os do cadastrado (lenient com DDD/9º dígito). null se faltar dado.
export function telefoneConfere(telefoneCadastrado, telefonesPuxados) {
  const reg = onlyDigits(telefoneCadastrado)
  if (reg.length < 8 || !Array.isArray(telefonesPuxados) || !telefonesPuxados.length) return null
  const regTail = reg.slice(-8)
  return telefonesPuxados.some((t) => onlyDigits(t).slice(-8) === regTail)
}
