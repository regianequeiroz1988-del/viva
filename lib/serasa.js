// Integração com a API da Serasa Experian (login + relatório de crédito PF/PJ).
// A Serasa exige que a requisição chegue de um IPv4 autorizado — por isso as
// chamadas passam por um proxy dedicado (dispatcher undici), configurado no
// /admin em Configurações. Uso INTERNO do backend — nunca exposto ao navegador.
//
// ⚠️ Usamos o fetch() do PRÓPRIO pacote "undici" (não o fetch global do Node) ao
//    passar um dispatcher: o Node já embute sua própria versão do undici e passar
//    um dispatcher de uma versão diferente pro fetch global quebra com
//    "invalid onRequestStart method" (incompatibilidade de interceptors).

export const SERASA_BASE = 'https://api.serasaexperian.com.br'
const LOGIN_PATH = '/security/iam/v1/client-identities/login'
const PF_PATH = '/credit-services/person-information-report/v1/creditreport'
const PJ_PATH = '/credit-services/business-information-report/v1/reports'

const onlyDigits = (v) => String(v || '').replace(/\D/g, '')

// Proxy salvo no formato "ip:porta:usuario:senha" (padrão dos provedores de
// proxy residencial/IPv4 dedicado). Por padrão é tratado como SOCKS5 (o que os
// provedores de IPv4 dedicado normalmente entregam). Pra usar proxy HTTP, prefixe
// com "http://" → "http://ip:porta:usuario:senha".
// Devolve { tipo: 'socks5' | 'http', host, porta, usuario, senha } ou null se inválido.
export function parseProxy(proxyStr) {
  let s = String(proxyStr || '').trim()
  let tipo = 'socks5'
  const m = /^(socks5?|https?):\/\//i.exec(s)
  if (m) {
    tipo = m[1].toLowerCase().startsWith('http') ? 'http' : 'socks5'
    s = s.slice(m[0].length)
  }
  const partes = s.split(':')
  if (partes.length !== 4) return null
  const [host, porta, usuario, senha] = partes
  if (!host || !porta || !usuario || !senha || !/^\d+$/.test(porta)) return null
  return { tipo, host, porta: Number(porta), usuario, senha }
}

// Mantido pro endpoint de teste validar o formato. URL só faz sentido pro tipo http.
export function montarProxyUrl(proxyStr) {
  const p = parseProxy(proxyStr)
  if (!p) return null
  return `${p.tipo}://${encodeURIComponent(p.usuario)}:${encodeURIComponent(p.senha)}@${p.host}:${p.porta}`
}

// Monta { fetch, dispatcher } a partir do proxy salvo. dispatcher null se não
// configurado/inválido → usa o fetch global do Node (sem proxy) nesse caso.
async function montarCliente(proxyStr) {
  const p = parseProxy(proxyStr)
  if (!p) return { fetchFn: fetch, dispatcher: null }
  const undici = await import('undici')
  if (p.tipo === 'http') {
    return { fetchFn: undici.fetch, dispatcher: new undici.ProxyAgent(montarProxyUrl(proxyStr)) }
  }
  // SOCKS5: o ProxyAgent do undici só fala HTTP CONNECT — pra SOCKS usamos o
  // fetch-socks, que cria um Agent do undici conectando via handshake SOCKS5.
  const { socksDispatcher } = await import('fetch-socks')
  const dispatcher = socksDispatcher({ type: 5, host: p.host, port: p.porta, userId: p.usuario, password: p.senha })
  return { fetchFn: undici.fetch, dispatcher }
}

// Exportado só pro endpoint de teste validar o formato antes de gastar uma chamada.
export async function montarProxyDispatcher(proxyStr) {
  const { dispatcher } = await montarCliente(proxyStr)
  return dispatcher
}

async function parseResposta(r) {
  const text = await r.text()
  let data
  try { data = JSON.parse(text) } catch { data = { raw: text } }
  return data
}

// Faz login (client credentials) e devolve o accessToken. { ok, status, token, data }
export async function serasaLogin({ clientId, clientSecret, proxy }) {
  const { fetchFn, dispatcher } = await montarCliente(proxy)
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const r = await fetchFn(`${SERASA_BASE}${LOGIN_PATH}`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: '{}',
    ...(dispatcher ? { dispatcher } : {}),
  })
  const data = await parseResposta(r)
  return { ok: r.ok, status: r.status, token: data?.accessToken || null, data }
}

// Relatório PF (pessoa física). cpf só dígitos. { ok, status, data }
export async function serasaConsultarPF({ token, cpf, reportName = 'RELATORIO_AVANCADO_PF', proxy }) {
  const { fetchFn, dispatcher } = await montarCliente(proxy)
  const r = await fetchFn(`${SERASA_BASE}${PF_PATH}?reportName=${encodeURIComponent(reportName)}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'x-document-id': onlyDigits(cpf),
      Accept: 'application/json',
    },
    ...(dispatcher ? { dispatcher } : {}),
  })
  const data = await parseResposta(r)
  return { ok: r.ok, status: r.status, data }
}

// Relatório PJ (pessoa jurídica). cnpj só dígitos. { ok, status, data }
export async function serasaConsultarPJ({ token, cnpj, reportName = 'RELATORIO_AVANCADO_PJ_PME', proxy }) {
  const { fetchFn, dispatcher } = await montarCliente(proxy)
  const r = await fetchFn(`${SERASA_BASE}${PJ_PATH}?reportName=${encodeURIComponent(reportName)}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'x-document-id': onlyDigits(cnpj),
      Accept: 'application/json',
    },
    ...(dispatcher ? { dispatcher } : {}),
  })
  const data = await parseResposta(r)
  return { ok: r.ok, status: r.status, data }
}

// Lê as credenciais/proxy salvas no /admin (tabela `configuracoes`, service role).
export async function lerCredenciaisSerasa({ supaUrl, srkHeaders }) {
  const ler = async (chave) => {
    const r = await fetch(
      `${supaUrl}/rest/v1/configuracoes?chave=eq.${encodeURIComponent(chave)}&select=valor`,
      { headers: srkHeaders }
    ).catch(() => null)
    const rows = r && r.ok ? await r.json().catch(() => []) : []
    return rows?.[0]?.valor || ''
  }
  const [clientId, clientSecret, proxy] = await Promise.all([
    ler('serasa_client_id_key'),
    ler('serasa_client_secret_key'),
    ler('serasa_proxy_key'),
  ])
  return { clientId, clientSecret, proxy }
}

// Login + consulta PF num passo só (mesmo formato de retorno do antigo consultarSupremo,
// pra facilitar a troca nos call-sites). Devolve { ok, status, data } — data no formato
// cru da Serasa (usar extrairSerasa() pra pegar os campos).
export async function consultarSerasaPF(cpf, { clientId, clientSecret, proxy }) {
  const login = await serasaLogin({ clientId, clientSecret, proxy })
  if (!login.ok || !login.token) {
    return { ok: false, status: login.status, data: login.data, etapa: 'login' }
  }
  const { ok, status, data } = await serasaConsultarPF({ token: login.token, cpf, proxy })
  return { ok, status, data, etapa: 'consulta' }
}

// ---- extração dos campos do relatório PF ----------------------------------
// Mapeamento EXATO do RELATORIO_AVANCADO_PF (ver extrairSerasa) + busca genérica
// por nome de campo como fallback, caso a Serasa mude/acrescente seções.

function pegarCampo(obj, regex, profundidade = 0) {
  if (!obj || typeof obj !== 'object' || profundidade > 6) return ''
  for (const k of Object.keys(obj)) {
    const v = obj[k]
    if ((typeof v === 'string' || typeof v === 'number') && regex.test(k) && String(v).trim())
      return String(v).trim()
  }
  for (const k of Object.keys(obj)) {
    if (obj[k] && typeof obj[k] === 'object') {
      const achado = pegarCampo(obj[k], regex, profundidade + 1)
      if (achado) return achado
    }
  }
  return ''
}

function pegarLista(obj, regex, profundidade = 0) {
  if (!obj || typeof obj !== 'object' || profundidade > 6) return []
  for (const k of Object.keys(obj)) {
    const v = obj[k]
    if (Array.isArray(v) && regex.test(k) && v.length) return v
  }
  for (const k of Object.keys(obj)) {
    if (obj[k] && typeof obj[k] === 'object') {
      const achado = pegarLista(obj[k], regex, profundidade + 1)
      if (achado.length) return achado
    }
  }
  return []
}

function formatarNome(s) {
  const nome = String(s || '').trim().toLowerCase()
  if (!nome) return ''
  const minus = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'di', 'du'])
  return nome
    .split(/\s+/)
    .map((w, i) => (i > 0 && minus.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
}

function fmtData(v) {
  if (!v) return ''
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v))
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`
  return String(v).trim()
}

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

function normSexo(s) {
  const t = String(s || '').trim().toUpperCase()
  if (!t) return null
  if (t === 'M' || t.startsWith('MASC')) return 'Masculino'
  if (t === 'F' || t.startsWith('FEM')) return 'Feminino'
  return String(s).trim() || null
}

function extrairTelefones(arr) {
  if (!Array.isArray(arr)) return []
  const vistos = new Set()
  const out = []
  for (const t of arr) {
    const d = onlyDigits(typeof t === 'object' ? (t?.numero || t?.number || t?.phone || '') : t)
    if (d.length >= 10 && d.length <= 13 && !vistos.has(d)) {
      vistos.add(d)
      out.push(d)
    }
  }
  return out
}

// Extrai os campos do retorno da Serasa. Volta null nos campos ausentes (viram
// "—" no /admin). Mesmo formato de saída do antigo extrairSupremo().
//
// Formato real do RELATORIO_AVANCADO_PF (verificado em 2026-09-25):
//   { reports: [ { reportName, registration: {
//       documentNumber, consumerName, motherName, consumerGender: "M"|"F",
//       consumerGenderDescription: "Masculino", birthDate: "1978-10-28",
//       address: { city, state, ... }, addresses: [...],
//       phones: [ { regionCode: 55, areaCode: 61, phoneNumber: 995939401, phoneType, updateDate } ]
//     }, negativeData: {...}, facts: {...} } ] }
// Renda/score NÃO vêm neste relatório — ficam null (a busca genérica abaixo cobre
// o caso de a Serasa passar a incluir).
export function extrairSerasa(raw) {
  const rep = Array.isArray(raw?.reports) ? raw.reports[0] : raw?.reports || raw
  const reg = rep?.registration || {}

  const nome = reg.consumerName || pegarCampo(raw, /(^nome$|nome.?completo|^name$|consumer.?name|razao.?social)/i)
  const nascimento = fmtData(reg.birthDate || pegarCampo(raw, /(nasc|birth.?date|dt.?nasc)/i))
  const sexo = reg.consumerGenderDescription || reg.consumerGender || pegarCampo(raw, /(^sexo$|^genero$|gender)/i)

  // phones[] da Serasa: DDD e número separados → junta em só dígitos (DDD + número).
  const phones = Array.isArray(reg.phones) ? reg.phones : pegarLista(raw, /(telefone|phone|contato)/i)
  const telefones = extrairTelefones(
    phones.map((t) => (t && typeof t === 'object' && t.phoneNumber != null ? `${t.areaCode ?? ''}${t.phoneNumber}` : t))
  )

  // Telefone mais recente (maior updateDate) — usado pra preencher o perfil SÓ quando
  // a pessoa não informou telefone no cadastro (o digitado sempre tem preferência).
  const maisRecente = phones
    .filter((t) => t && typeof t === 'object' && t.phoneNumber != null)
    .sort((a, b) => String(b.updateDate || '').localeCompare(String(a.updateDate || '')))[0]
  const telefoneRecente = maisRecente
    ? extrairTelefones([`${maisRecente.areaCode ?? ''}${maisRecente.phoneNumber}`])[0] || null
    : telefones[0] || null

  return {
    nome: formatarNome(nome) || null,
    nascimento: nascimento || null,
    idade: calcIdade(nascimento),
    sexo: normSexo(sexo),
    renda: pegarCampo(raw, /(renda|income|faixa.?renda)/i) || null,
    telefones,
    telefoneRecente,
  }
}

// Compara o telefone CADASTRADO com os telefones PUXADOS (se a Serasa trouxer algum —
// normalmente não traz, ver aviso acima). null se faltar dado pra comparar.
export function telefoneConfere(telefoneCadastrado, telefonesPuxados) {
  const reg = onlyDigits(telefoneCadastrado)
  if (reg.length < 8 || !Array.isArray(telefonesPuxados) || !telefonesPuxados.length) return null
  const regTail = reg.slice(-8)
  return telefonesPuxados.some((t) => onlyDigits(t).slice(-8) === regTail)
}
