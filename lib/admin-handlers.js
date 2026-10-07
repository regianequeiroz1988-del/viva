// Handlers do dispatcher /api/admin/[action] — mantido num único arquivo/função
// (Vercel Hobby limita a 12 Serverless Functions por deployment).
//   /api/admin/enriquecer   → action = 'enriquecer'
//   /api/admin/serasa-test  → action = 'serasa-test'
//
// ⚠️ SÓ ADMIN: todo handler valida o token do admin logado (auth.users) e confere
//    is_admin no profiles antes de fazer qualquer coisa. Sem sessão de admin → 401/403.

import { montarProxyUrl, serasaLogin, consultarSerasaPF } from './serasa.js'
import { consultarCpf, telefoneConfere } from './consultaCpf.js'

const onlyDigits = (v) => String(v || '').replace(/\D/g, '')

const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
const srkHeaders = { apikey: SRK, Authorization: `Bearer ${SRK}` }

// Valida o token do chamador e confirma que é ADMIN. { ok, error?, status? }
async function exigirAdmin(req) {
  const auth = String(req.headers.authorization || '')
  return validarTokenAdmin(auth.startsWith('Bearer ') ? auth.slice(7).trim() : '')
}

export async function validarTokenAdmin(token) {
  if (!token) return { ok: false, status: 401, error: 'Não autenticado.' }

  // 1) O Supabase valida assinatura/expiração do token e devolve o dono.
  const u = await fetch(`${SUPA_URL}/auth/v1/user`, {
    headers: { apikey: ANON || SRK, Authorization: `Bearer ${token}` },
  }).catch(() => null)
  if (!u || !u.ok) return { ok: false, status: 401, error: 'Sessão inválida.' }
  const user = await u.json().catch(() => null)
  if (!user?.id) return { ok: false, status: 401, error: 'Sessão inválida.' }

  // 2) is_admin no banco (service_role, ignora RLS — não confia em nada do front).
  const r = await fetch(
    `${SUPA_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=is_admin`,
    { headers: srkHeaders }
  ).catch(() => null)
  const rows = r && r.ok ? await r.json().catch(() => []) : []
  if (!rows?.[0]?.is_admin) return { ok: false, status: 403, error: 'Acesso restrito a administradores.' }

  return { ok: true }
}

// Lê uma config salva (service_role, ignora RLS). '' se não existir.
async function lerConfig(chave) {
  const r = await fetch(
    `${SUPA_URL}/rest/v1/configuracoes?chave=eq.${encodeURIComponent(chave)}&select=valor`,
    { headers: srkHeaders }
  ).catch(() => null)
  const rows = r && r.ok ? await r.json().catch(() => []) : []
  return rows?.[0]?.valor || ''
}

// POST /api/admin/enriquecer — re-roda a CONSULTA (Serasa) de um usuário e atualiza
// o nome no profile + o enriquecimento em dados_consulta. Serve pra corrigir contas
// que ficaram como "Cliente" (a consulta falhou/veio vazia no cadastro).
// Body: { userId }  (o CPF/telefone são lidos do próprio profile, não do cliente).
export async function enriquecerHandler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!SUPA_URL || !SRK) return res.status(500).json({ error: 'Supabase service role não configurado no servidor.' })

  const admin = await exigirAdmin(req)
  if (!admin.ok) return res.status(admin.status).json({ error: admin.error })

  const userId = String(req.body?.userId || '').trim()
  if (!userId) return res.status(400).json({ error: 'userId obrigatório.' })

  // CPF/telefone vêm do PRÓPRIO profile (não do body) — fonte de verdade.
  const pr = await fetch(
    `${SUPA_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,cpf,nome,telefone`,
    { headers: srkHeaders }
  ).catch(() => null)
  const prof = pr && pr.ok ? (await pr.json().catch(() => []))?.[0] : null
  if (!prof) return res.status(404).json({ error: 'Usuário não encontrado.' })

  const cpf = onlyDigits(prof.cpf)
  if (cpf.length !== 11) return res.status(400).json({ error: 'Este usuário não tem CPF válido para consultar.' })

  // Consulta o provedor ATIVO (Serasa ou Supremo, conforme Configurações).
  // try/catch: falha de rede/timeout não pode virar 500 sem JSON.
  let ok, data, campos, provider, erro
  try {
    ;({ ok, data, campos, provider, erro } = await consultarCpf(cpf, { supaUrl: SUPA_URL, srkHeaders }))
  } catch {
    return res.status(502).json({
      error: 'Não foi possível falar com o provedor de consulta agora (rede/timeout/proxy). Confira as Configurações.',
    })
  }
  if (!ok || !campos) {
    return res.status(502).json({
      error: `A consulta falhou (base ativa: ${provider})${erro ? ` — ${erro}` : ''}. Confira as credenciais/configuração em Configurações.`,
    })
  }
  const temDados = !!(campos.nome || campos.nascimento || campos.renda || campos.sexo || campos.telefones.length)
  if (!temDados) {
    // Respondeu, mas sem base para este CPF (não sobrescreve nada).
    return res.status(200).json({ ok: false, vazio: true, message: 'A consulta respondeu, mas não trouxe dados para este CPF.' })
  }

  const confere = telefoneConfere(prof.telefone, campos.telefones)

  // Monta o enriquecimento SÓ com o que a consulta REALMENTE trouxe. Não mandar
  // campos null: o merge (ON CONFLICT DO UPDATE) sobrescreveria com null um dado
  // bom já salvo (ex.: renda/nascimento de uma consulta anterior mais rica). Mesmo
  // cuidado do auth-cpf.js, que grava payload PARCIAL de propósito.
  const novo = {}
  if (campos.nome) novo.nome = campos.nome
  if (campos.nascimento) novo.nascimento = campos.nascimento
  if (campos.idade != null) novo.idade = campos.idade
  if (campos.sexo) novo.sexo = campos.sexo
  if (campos.renda) novo.renda = campos.renda
  if (campos.telefones.length) novo.telefones = campos.telefones
  if (confere !== null) novo.telefone_confere = confere // null = não deu p/ comparar → não zera

  await fetch(`${SUPA_URL}/rest/v1/dados_consulta`, {
    method: 'POST',
    headers: { ...srkHeaders, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ user_id: userId, cpf, ...novo, raw: data, updated_at: new Date().toISOString() }),
  }).catch(() => {})

  // Atualiza o profile SÓ com o que a consulta trouxe: nome (não zera o atual) e
  // telefone APENAS se a pessoa não informou nenhum no cadastro — o digitado vence.
  const patchProfile = {}
  if (campos.nome) patchProfile.nome = campos.nome
  const semTelefone = onlyDigits(prof.telefone).length < 10
  if (semTelefone && campos.telefoneRecente) patchProfile.telefone = campos.telefoneRecente
  if (Object.keys(patchProfile).length) {
    await fetch(`${SUPA_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      headers: { ...srkHeaders, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(patchProfile),
    }).catch(() => {})
  }

  return res.status(200).json({
    ok: true,
    nome: campos.nome || prof.nome || null,
    telefone: patchProfile.telefone || null, // preenchido pela Serasa (só quando estava vazio)
    consulta: novo, // só o que mudou → o front faz merge sem apagar o resto
  })
}

// POST /api/admin/serasa-test — testa as credenciais + proxy IPv4 salvos no /admin
// fazendo só o LOGIN (emissão de token) — não gasta consulta paga. { ok, message, status? }
export async function serasaTestHandler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!SUPA_URL || !SRK) return res.status(500).json({ error: 'Supabase service role não configurado no servidor.' })

  const admin = await exigirAdmin(req)
  if (!admin.ok) return res.status(admin.status).json({ error: admin.error })

  const [clientId, clientSecret, proxy] = await Promise.all([
    lerConfig('serasa_client_id_key'),
    lerConfig('serasa_client_secret_key'),
    lerConfig('serasa_proxy_key'),
  ])

  if (!clientId || !clientSecret) {
    return res.status(200).json({ ok: false, message: 'Preencha e salve o Client ID e o Client Secret antes de testar.' })
  }
  if (!proxy) {
    return res.status(200).json({ ok: false, message: 'Preencha e salve o proxy IPv4 antes de testar (a Serasa exige IPv4 autorizado).' })
  }

  if (!montarProxyUrl(proxy)) {
    return res.status(200).json({ ok: false, message: 'Proxy em formato inválido. Use ip:porta:usuario:senha.' })
  }

  try {
    const { ok, status, token, data } = await serasaLogin({ clientId, clientSecret, proxy })
    if (!ok || !token) {
      const motivo = data?.message || data?.error || data?.raw || `status ${status}`
      return res.status(200).json({ ok: false, message: `A Serasa recusou o login: ${motivo}`, probe: { status } })
    }
    return res.status(200).json({ ok: true, message: 'Login OK — credenciais e proxy funcionando.', probe: { status } })
  } catch (e) {
    return res.status(200).json({
      ok: false,
      message: 'Não foi possível falar com a Serasa pelo proxy configurado (rede/timeout/credenciais do proxy). ' + (e.message || ''),
    })
  }
}
