// Consulta de CPF via Work API (módulo "CPF WORK") — provedor alternativo à Serasa.
// Uso INTERNO do backend — a chave nunca vai pro navegador.
//   GET https://api.workapi.dev/v1/gateway/work-cpf?cpf=<11 dígitos>   (header x-api-key)
//   → { data: { status, body: { data: [ { name, sex, birthDate, income, phones:[{areaCode, number, typeId}] } ] } } }
// Limite da conta: 2.000 consultas/dia.

export const WORKAPI_URL = 'https://api.workapi.dev/v1/gateway/work-cpf'
const TIMEOUT_MS = 15000

const onlyDigits = (v) => String(v || '').replace(/\D/g, '')

// Chave: config `workapi_key` (/admin → Configurações) ou env WORKAPI_KEY.
export async function lerChaveWork({ supaUrl, srkHeaders }) {
  const r = await fetch(
    `${supaUrl}/rest/v1/configuracoes?chave=eq.workapi_key&select=valor`,
    { headers: srkHeaders }
  ).catch(() => null)
  const rows = r && r.ok ? await r.json().catch(() => []) : []
  return (rows?.[0]?.valor || '').trim() || process.env.WORKAPI_KEY || ''
}

// Devolve { ok, status, data }.
export async function consultarWork(cpf, apiKey) {
  const r = await fetch(`${WORKAPI_URL}?cpf=${onlyDigits(cpf)}`, {
    headers: { 'x-api-key': apiKey, Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const text = await r.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    data = { raw: text }
  }
  return { ok: r.ok, status: r.status, data }
}

// O registro da pessoa (o primeiro da lista), ou null se a base não tem o CPF.
export function registroWork(raw) {
  const lista = raw?.data?.body?.data
  return Array.isArray(lista) && lista[0] ? lista[0] : null
}

// "ERICA BARRETO DE SOUZA" → "Erica Barreto de Souza".
function formatarNome(s) {
  const nome = String(s || '').trim().toLowerCase()
  if (!nome) return ''
  const minus = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'di', 'du'])
  return nome
    .split(/\s+/)
    .map((w, i) => (i > 0 && minus.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
}

// "1971-05-03 00:00:00" → "03/05/1971" (vazio se vier mascarado/inválido).
function fmtData(v) {
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''))
  return iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : ''
}

function calcIdade(dataBr) {
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dataBr || '')
  if (!br) return null
  const [d, m, a] = [+br[1], +br[2], +br[3]]
  const hoje = new Date()
  let idade = hoje.getFullYear() - a
  if (hoje.getMonth() < m - 1 || (hoje.getMonth() === m - 1 && hoje.getDate() < d)) idade -= 1
  return idade >= 0 && idade < 130 ? idade : null
}

function normSexo(s) {
  const t = String(s || '').trim().toUpperCase()
  if (t === 'M') return 'Masculino'
  if (t === 'F') return 'Feminino'
  return t ? String(s).trim() : null
}

// DDD + número, só dígitos, sem repetição. Celular (typeId 3) primeiro.
function extrairTelefones(phones) {
  if (!Array.isArray(phones)) return []
  const ordenados = [...phones].sort((a, b) => (b?.typeId === 3) - (a?.typeId === 3))
  const vistos = new Set()
  const out = []
  for (const p of ordenados) {
    const d = onlyDigits(`${p?.areaCode ?? ''}${p?.number ?? ''}`)
    if (d.length >= 10 && d.length <= 11 && !vistos.has(d)) {
      vistos.add(d)
      out.push(d)
    }
  }
  return out
}

// Mesmos campos dos outros provedores (nome/nascimento/idade/sexo/renda/telefones).
export function extrairWork(raw) {
  const p = registroWork(raw) || {}
  const nascimento = fmtData(p.birthDate)
  return {
    nome: formatarNome(p.name) || null,
    nascimento: nascimento || null,
    idade: calcIdade(nascimento),
    sexo: normSexo(p.sex),
    renda: String(p.income || p.purchasingPower?.income || '').trim() || null,
    telefones: extrairTelefones(p.phones),
  }
}
