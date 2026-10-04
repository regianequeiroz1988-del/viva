// Consulta OwnData (workbuscas) + extração dos dados de enriquecimento — uso INTERNO
// do backend (nunca exposto ao navegador). Reaproveitado pelo api/ganhador.js.

export const OWNDATA_BASE = 'https://completa.workbuscas.com/api'

const onlyDigits = (v) => String(v || '').replace(/\D/g, '')

// Consulta o CPF na OwnData (módulo cpf). Devolve { ok, status, data }.
// `dispatcher` (opcional) — agent do undici p/ rotear por proxy (usado pelo script local).
export async function consultarOwnData(cpf, token, dispatcher) {
  const url = `${OWNDATA_BASE}?token=${encodeURIComponent(token)}&modulo=cpf&consulta=${onlyDigits(cpf)}`
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

// Profissão: a OwnData costuma devolver o CÓDIGO CBO (ex.: "252105") e, em outro
// campo, o NOME. Esta função pega o NOME (valor com letras), ignorando o código
// puro e o placeholder "Sem descrição.". Volta null se só houver código.
function pegarProfissao(raw) {
  // Considera "nome válido" só texto com letras, fora o placeholder "Sem descrição.".
  const limpo = (s) => {
    const t = String(s || '').trim()
    return t && !/^sem\s+descri/i.test(t) && /[a-zà-ÿ]/i.test(t) ? t : ''
  }
  // Fonte principal: raw.profissao.cboDescricao (nome da ocupação).
  const desc = limpo(raw?.profissao?.cboDescricao)
  if (desc) return desc
  // Fallback: histórico de empregos (cargo/ocupação do registro mais recente).
  const emp = raw?.empregos
  if (Array.isArray(emp)) {
    for (const e of emp) {
      const cargo = limpo(e?.cargo) || limpo(e?.cboDescricao) || limpo(e?.ocupacao) || limpo(e?.descricao)
      if (cargo) return cargo
    }
  }
  return null
}

// Normaliza data pra dd/mm/aaaa quando vier ISO (aaaa-mm-dd).
function fmtData(v) {
  if (!v) return ''
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v))
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`
  return String(v).trim()
}

// Calcula a idade a partir de dd/mm/aaaa (ou aaaa-mm-dd).
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

// Extrai os campos de enriquecimento da resposta crua da OwnData.
// Se algum campo não vier no plano/módulo contratado, volta null (vira "—" no /admin).
// Title-case de nome BR: "ERICA BARRETO DE SOUZA" → "Erica Barreto de Souza"
// (mantém conectores em minúsculo).
function formatarNome(s) {
  const nome = String(s || '').trim().toLowerCase()
  if (!nome) return ''
  const minus = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'di', 'du'])
  return nome
    .split(/\s+/)
    .map((w, i) => (i > 0 && minus.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
}

export function extrairConsulta(raw) {
  const basicos = raw?.DadosBasicos || {}
  const eco = raw?.DadosEconomicos || {}

  // Nome COMPLETO do titular (fonte confiável — o cadastro pode vir digitado errado).
  const nome = formatarNome(basicos.nome)

  // Nascimento/idade — direto do TITULAR (DadosBasicos), nunca de parente/vizinho.
  const nascimento = fmtData(basicos.dataNascimento || basicos.nascimento || '')
  const idade = calcIdade(nascimento)

  // Profissão — profissao.cboDescricao (com fallback em empregos).
  const profissao = pegarProfissao(raw)

  // Score — DadosEconomicos.score.scoreCSB (é um objeto). Fallback p/ scoreCSBA / valor direto.
  const sc = eco.score
  const score = sc && typeof sc === 'object'
    ? (String(sc.scoreCSB || sc.scoreCSBA || '').trim() || null)
    : (sc != null && sc !== '' ? String(sc).trim() : null)

  // Renda — DadosEconomicos.renda.
  const renda = String(eco.renda || '').trim() || null

  return {
    nome: nome || null,
    nascimento: nascimento || null,
    idade: Number.isFinite(idade) ? idade : null,
    profissao: profissao || null,
    score,
    renda,
  }
}
