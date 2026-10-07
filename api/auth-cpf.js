// POST /api/auth-cpf — LOGIN/CADASTRO SEM SENHA, por CPF.
//
// Dois passos (body JSON):
//   { step: 'consultar', cpf }            → consulta a API (base ativa em /admin), CRIA/ACHA a
//                                           conta e devolve { nome, jaCadastrado }.
//   { step: 'confirmar', cpf, telefone }  → salva o WhatsApp, compara com os
//                                           telefones puxados (SÓ registra, não
//                                           bloqueia) e emite a SESSÃO do Supabase
//                                           { access_token, refresh_token }.
//
// A senha do Supabase Auth é DERIVADA do CPF via HMAC(AUTH_CPF_SECRET, cpf): é
// determinística e NUNCA sai do backend — o cliente jamais autentica sozinho.
// Contas antigas (com senha real) são migradas de forma preguiçosa: no 'confirmar'
// a senha é re-sincronizada pra derivada (o e-mail real delas é preservado).
//
// Variáveis de ambiente (Vercel):
//   SUPABASE_URL (ou VITE_SUPABASE_URL)
//   SUPABASE_SERVICE_ROLE_KEY   → ops de admin + gravação ignorando RLS
//   AUTH_CPF_SECRET             → segredo p/ derivar a senha (defina 1x e NÃO troque)
//   SUPABASE_ANON_KEY (ou VITE_SUPABASE_ANON_KEY) → apikey do grant de senha

import crypto from 'crypto'
import { consultarCpf, telefoneConfere } from '../lib/consultaCpf.js'

const onlyDigits = (v) => String(v || '').replace(/\D/g, '')

const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
// Domínio do e-mail sintético das contas por CPF (não recebe e-mail de verdade).
const EMAIL_DOMAIN = process.env.AUTH_CPF_EMAIL_DOMAIN || 'cpf.vivasorte.app'

const srkHeaders = { apikey: SRK, Authorization: `Bearer ${SRK}` }

// Valida CPF (dígitos verificadores) — mesma regra do front (utils/masks.js) e do
// trigger cpf_e_valido no banco.
function cpfValido(v) {
  const c = onlyDigits(v)
  if (c.length !== 11) return false
  if (/^(\d)\1{10}$/.test(c)) return false
  let soma = 0
  for (let i = 0; i < 9; i++) soma += Number(c[i]) * (10 - i)
  let d1 = (soma * 10) % 11
  if (d1 === 10) d1 = 0
  if (d1 !== Number(c[9])) return false
  soma = 0
  for (let i = 0; i < 10; i++) soma += Number(c[i]) * (11 - i)
  let d2 = (soma * 10) % 11
  if (d2 === 10) d2 = 0
  return d2 === Number(c[10])
}

// Senha determinística derivada do CPF. Só quem tem AUTH_CPF_SECRET consegue calcular.
function senhaDoCpf(cpf) {
  const secret = process.env.AUTH_CPF_SECRET
  if (!secret) throw new Error('AUTH_CPF_SECRET não configurado.')
  return crypto.createHmac('sha256', secret).update(onlyDigits(cpf)).digest('base64')
}

// --- helpers REST (service role → ignora RLS) -------------------------------
async function acharProfilePorCpf(cpf) {
  const r = await fetch(
    `${SUPA_URL}/rest/v1/profiles?cpf=eq.${encodeURIComponent(onlyDigits(cpf))}&select=id,email,nome,telefone,is_admin`,
    { headers: srkHeaders }
  )
  if (!r.ok) return null
  const rows = await r.json().catch(() => [])
  return Array.isArray(rows) && rows[0] ? rows[0] : null
}

async function lerDadosConsulta(userId) {
  const r = await fetch(
    `${SUPA_URL}/rest/v1/dados_consulta?user_id=eq.${encodeURIComponent(userId)}&select=nome,telefones`,
    { headers: srkHeaders }
  )
  if (!r.ok) return null
  const rows = await r.json().catch(() => [])
  return Array.isArray(rows) && rows[0] ? rows[0] : null
}

async function upsertDadosConsulta(userId, payload) {
  await fetch(`${SUPA_URL}/rest/v1/dados_consulta`, {
    method: 'POST',
    headers: { ...srkHeaders, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ user_id: userId, ...payload, updated_at: new Date().toISOString() }),
  }).catch(() => {})
}

async function atualizarTelefoneProfile(userId, telefone) {
  await fetch(`${SUPA_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    headers: { ...srkHeaders, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ telefone: onlyDigits(telefone) }),
  }).catch(() => {})
}

async function atualizarNomeProfile(userId, nome) {
  await fetch(`${SUPA_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    headers: { ...srkHeaders, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ nome }),
  }).catch(() => {})
}

// --- helpers Supabase Auth (admin + grant) ----------------------------------
// Cria a conta (auth.users) com e-mail sintético + senha derivada. O trigger
// handle_new_user cria o profile a partir do metadata (e valida o CPF no banco).
async function criarUsuario(cpf, nome, origem) {
  const email = `${onlyDigits(cpf)}@${EMAIL_DOMAIN}`
  const r = await fetch(`${SUPA_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { ...srkHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: senhaDoCpf(cpf),
      email_confirm: true,
      user_metadata: { cpf: onlyDigits(cpf), nome: nome || 'Cliente', origem: origem || '' },
    }),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok || !data?.id) return { ok: false, error: data?.msg || data?.error_description || 'Falha ao criar conta.' }
  return { ok: true, id: data.id, email }
}

// Garante que a senha da conta é a derivada (migra contas antigas p/ o novo modelo).
// Devolve true só se o Supabase confirmou (senão o grant depois falharia sem explicação).
async function sincronizarSenha(userId, cpf) {
  const r = await fetch(`${SUPA_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'PUT',
    headers: { ...srkHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: senhaDoCpf(cpf) }),
  }).catch(() => null)
  return !!(r && r.ok)
}

// E-mail REAL do usuário no Supabase Auth (auth.users) — o grant de senha autentica
// por ESTE e-mail, não pelo profiles.email (que o cliente pode editar em "Meus dados").
async function emailDoAuthUser(userId) {
  const r = await fetch(`${SUPA_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    headers: srkHeaders,
  }).catch(() => null)
  if (!r || !r.ok) return null
  const data = await r.json().catch(() => null)
  return data?.email || null
}

// "Login" (grant de senha) → devolve a sessão { access_token, refresh_token }.
async function emitirSessao(email, cpf) {
  const r = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON || SRK, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: senhaDoCpf(cpf) }),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok || !data.access_token) return null
  return { access_token: data.access_token, refresh_token: data.refresh_token }
}

// Prepara a senha derivada e emite a sessão. Usado no 'confirmar' E no login direto
// de quem já tem telefone. Login pelo e-mail REAL do Auth (não o profiles.email, que
// é editável — usar o editável causaria lockout permanente ao trocar o e-mail).
async function abrirSessao(userId, cpf) {
  const sincronizou = await sincronizarSenha(userId, cpf)
  if (!sincronizou) return { ok: false, error: 'Não foi possível preparar seu acesso agora. Tente novamente em instantes.' }
  const authEmail = await emailDoAuthUser(userId)
  const session = authEmail ? await emitirSessao(authEmail, cpf) : null
  if (!session) return { ok: false, error: 'Não foi possível iniciar a sessão. Tente novamente.' }
  return { ok: true, session }
}

// ============================================================================
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!SUPA_URL || !SRK) return res.status(500).json({ error: 'Supabase service role não configurado no servidor.' })
  if (!process.env.AUTH_CPF_SECRET) return res.status(500).json({ error: 'AUTH_CPF_SECRET não configurado no servidor.' })

  const step = String(req.body?.step || '')
  const cpf = onlyDigits(req.body?.cpf)
  if (!cpfValido(cpf)) return res.status(400).json({ error: 'CPF inválido.' })

  try {
    if (step === 'consultar') return await consultar(cpf, String(req.body?.origem || ''), res)
    if (step === 'confirmar') return await confirmar(cpf, req.body?.telefone, res)
    return res.status(400).json({ error: 'step inválido (use "consultar" ou "confirmar").' })
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Falha no servidor.' })
  }
}

const CONSULTA_MS = 5000

// A consulta respondeu depois que o cliente já seguiu: grava nome/telefones assim mesmo.
function completarConsultaDepois(consulta, userId, cpf) {
  consulta.then(async (r) => {
    if (!r?.ok || !r.campos) return
    const c = r.campos
    await upsertDadosConsulta(userId, {
      cpf,
      nome: c.nome ?? null,
      nascimento: c.nascimento ?? null,
      idade: c.idade ?? null,
      sexo: c.sexo ?? null,
      renda: c.renda ?? null,
      telefones: c.telefones ?? [],
      raw: r.data ?? null,
    })
    if (c.nome) {
      await fetch(`${SUPA_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&or=(nome.is.null,nome.eq.Cliente)`, {
        method: 'PATCH',
        headers: { ...srkHeaders, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ nome: c.nome }),
      }).catch(() => {})
    }
    console.log('[auth-cpf] consulta atrasada gravada para', userId)
  }).catch(() => {})
}

// Passo 1: consulta a API, cria/acha a conta, guarda o enriquecimento e devolve o nome.
async function consultar(cpf, origem, res) {
  let profile = await acharProfilePorCpf(cpf)

  // Conta administrativa NÃO entra por aqui (protege a senha/2FA do /admin).
  if (profile?.is_admin) return res.status(403).json({ error: 'Conta administrativa. Entre pelo /admin.' })

  const jaCadastrado = !!profile

  // Reusa o enriquecimento já salvo (evita gastar consulta de novo p/ quem volta).
  let nome = profile?.nome || ''
  let telefones = null
  if (profile) {
    const dc = await lerDadosConsulta(profile.id)
    if (dc) {
      nome = dc.nome || nome
      telefones = Array.isArray(dc.telefones) ? dc.telefones : telefones
    }
  }

  // Consulta o provedor só se ainda não temos os telefones guardados. O cliente
  // espera no máximo CONSULTA_MS: se o provedor/proxy travar, o cadastro segue sem
  // ela e o resultado (se vier) é gravado depois, em segundo plano.
  let raw = null
  let campos = null
  let consultaAtrasada = null
  if (!telefones) {
    const consulta = consultarCpf(cpf, { supaUrl: SUPA_URL, srkHeaders }).catch(() => ({ ok: false }))
    const r = await Promise.race([consulta, new Promise((ok) => setTimeout(() => ok(null), CONSULTA_MS))])
    if (r === null) {
      console.log('[auth-cpf] consulta de CPF passou de', CONSULTA_MS, 'ms — cadastro segue sem ela')
      consultaAtrasada = consulta
    } else if (r.ok && r.campos) {
      campos = r.campos
      raw = r.data
      nome = campos.nome || nome
      telefones = campos.telefones || []
    }
  }

  // Cria a conta se ainda não existir. Se DUAS requests do mesmo CPF chegarem juntas
  // (ex.: duas abas), a 2ª criação bate na constraint UNIQUE do cpf — nesse caso
  // re-busca o profile que a 1ª criou, em vez de devolver 500 espúrio.
  if (!profile) {
    const criada = await criarUsuario(cpf, nome, origem)
    if (criada.ok) {
      profile = { id: criada.id, email: criada.email, nome, telefone: null, is_admin: false }
    } else {
      profile = await acharProfilePorCpf(cpf)
      if (!profile) return res.status(500).json({ error: criada.error })
    }
  } else if (campos?.nome && (!profile.nome || profile.nome === 'Cliente')) {
    // Conta que existia com nome vazio/"Cliente" (consulta falhou antes) e agora a
    // consulta trouxe o nome real → atualiza o profile p/ bater com a saudação.
    await atualizarNomeProfile(profile.id, campos.nome)
    profile.nome = campos.nome
  }

  if (consultaAtrasada) completarConsultaDepois(consultaAtrasada, profile.id, cpf)

  // Persiste/atualiza o enriquecimento (telefone_confere fica pro passo 2).
  if (campos || raw) {
    await upsertDadosConsulta(profile.id, {
      cpf,
      nome: campos?.nome ?? nome ?? null,
      nascimento: campos?.nascimento ?? null,
      idade: campos?.idade ?? null,
      sexo: campos?.sexo ?? null,
      renda: campos?.renda ?? null,
      telefones: telefones ?? [],
      raw: raw ?? null,
    })
  }

  // Conta que JÁ tem telefone confirmado → entra DIRETO, sem pedir o telefone de novo.
  // (Primeiro acesso / conta sem telefone continua indo pra tela do WhatsApp.)
  if (onlyDigits(profile.telefone).length >= 10) {
    const s = await abrirSessao(profile.id, cpf)
    if (s.ok) return res.status(200).json({ ok: true, nome: nome === 'Cliente' ? '' : nome || '', jaCadastrado, session: s.session })
    // Se não conseguiu abrir a sessão agora, segue o fluxo normal (pede o telefone) — não trava.
  }

  return res.status(200).json({ ok: true, nome: nome === 'Cliente' ? '' : nome || '', jaCadastrado })
}

// Passo 2: salva o WhatsApp, compara (só registra), sincroniza a senha e emite a sessão.
async function confirmar(cpf, telefoneInput, res) {
  const telefone = onlyDigits(telefoneInput)
  if (telefone.length < 10) return res.status(400).json({ error: 'Telefone inválido — informe DDD + número.' })

  const profile = await acharProfilePorCpf(cpf)
  if (!profile) return res.status(400).json({ error: 'Conta não encontrada — recomece pelo CPF.' })
  if (profile.is_admin) return res.status(403).json({ error: 'Conta administrativa. Entre pelo /admin.' })

  // Telefones puxados (guardados no passo 1). Compara — só REGISTRA, não bloqueia.
  const dc = await lerDadosConsulta(profile.id)
  const telefones = dc && Array.isArray(dc.telefones) ? dc.telefones : []
  const confere = telefoneConfere(telefone, telefones) // true | false | null

  // Salva o WhatsApp no profile e registra o resultado da comparação.
  await atualizarTelefoneProfile(profile.id, telefone)
  await upsertDadosConsulta(profile.id, { cpf, telefone_confere: confere })

  // Sincroniza a senha derivada e emite a sessão (mesmo caminho do login direto).
  const s = await abrirSessao(profile.id, cpf)
  if (!s.ok) return res.status(503).json({ error: s.error })

  return res.status(200).json({ ok: true, confere, session: s.session })
}
