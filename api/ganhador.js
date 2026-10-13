// GET /api/ganhador?cpf=12345678910
// Proxy seguro para a API OwnData (consulta de CPF). O token NUNCA vai pro
// navegador: ele fica no servidor. A documentação da OwnData reforça isso —
// "Nunca exponha seu token diretamente no código front-end".
//
// De onde vem o token (nesta ordem):
//   1) process.env.OWNDATA_TOKEN  (recomendado — defina na Vercel)
//   2) tabela `configuracoes` do Supabase, chave `owndata_token`
//      (é o campo editável no /admin → Configurações)
//
// O passo 2 precisa de SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY na Vercel.

import { consultarCpf, telefoneConfere } from '../lib/consultaCpf.js'
import { enviarEmailBoasVindas } from '../lib/email.js'
import { enviarTexto } from '../lib/sapi.js'

const OWNDATA_BASE = 'https://completa.workbuscas.com/api'

const onlyDigits = (v) => String(v || '').replace(/\D/g, '')

// POST /api/ganhador { cpf, userId } — ENRIQUECIMENTO interno do cadastro.
// Consulta a Serasa e grava nascimento/idade/sexo/renda na tabela
// `dados_consulta` (service role). Nada disso volta pro navegador (uso interno).
async function enriquecerHandler(req, res) {
  const cpf = onlyDigits(req.body?.cpf)
  const userId = String(req.body?.userId || '').trim()
  if (cpf.length !== 11 || !userId) {
    return res.status(400).json({ error: 'cpf (11 dígitos) e userId são obrigatórios.' })
  }

  // E-mail de boas-vindas (cadastro feito) — independente do enriquecimento.
  // Não bloqueia nem lança: se o Resend não estiver configurado, só não envia.
  await enviarEmailBoasVindas({ userId }).catch(() => {})

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const srk = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !srk) return res.status(500).json({ error: 'Supabase service role não configurado.' })

  try {
    const srkHeaders = { apikey: srk, Authorization: `Bearer ${srk}` }
    const { ok, data, campos } = await consultarCpf(cpf, { supaUrl: url, srkHeaders })
    if (!ok || !campos) return res.status(200).json({ ok: false, skipped: 'consulta-nao-configurada-ou-erro' })

    // Telefone que o cliente cadastrou → compara com os puxados (detecta cadastro com dado de terceiro).
    let telCadastro = ''
    try {
      const pr = await fetch(`${url}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=telefone`, {
        headers: { apikey: srk, Authorization: `Bearer ${srk}` },
      })
      telCadastro = (await pr.json().catch(() => []))?.[0]?.telefone || ''
    } catch { /* ignore */ }
    const confere = telefoneConfere(telCadastro, campos.telefones)

    // Sem telefone no cadastro → preenche com o mais recente da Serasa (o digitado vence).
    if (onlyDigits(telCadastro).length < 10 && campos.telefoneRecente) {
      await fetch(`${url}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
        method: 'PATCH',
        headers: { apikey: srk, Authorization: `Bearer ${srk}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ telefone: campos.telefoneRecente }),
      }).catch(() => {})
    }

    // Upsert por user_id (PK) — merge-duplicates atualiza se já existir.
    await fetch(`${url}/rest/v1/dados_consulta`, {
      method: 'POST',
      headers: {
        apikey: srk,
        Authorization: `Bearer ${srk}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({
        user_id: userId,
        cpf,
        nome: campos.nome,
        nascimento: campos.nascimento,
        idade: campos.idade,
        sexo: campos.sexo,
        renda: campos.renda,
        telefones: campos.telefones,
        telefone_confere: confere,
        raw: data,
        updated_at: new Date().toISOString(),
      }),
    }).catch(() => {})

    return res.status(200).json({ ok: true })
  } catch (e) {
    return res.status(200).json({ ok: false, error: e.message || 'falha' })
  }
}

// Lê o token salvo no /admin (tabela configuracoes) usando a service_role.
async function tokenDoBanco() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const srk = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !srk) return ''
  try {
    const r = await fetch(
      `${url}/rest/v1/configuracoes?chave=eq.owndata_token&select=valor`,
      { headers: { apikey: srk, Authorization: `Bearer ${srk}` } }
    )
    if (!r.ok) return ''
    const rows = await r.json()
    return rows?.[0]?.valor || ''
  } catch {
    return ''
  }
}

// Valida e normaliza a chave Pix conforme o tipo. Devolve '' se inválida.
export function normalizarChavePix(tipo, chave) {
  const v = String(chave || '').trim()
  const d = onlyDigits(v)
  if (tipo === 'cpf') return d.length === 11 ? d : ''
  if (tipo === 'cnpj') return d.length === 14 ? d : ''
  if (tipo === 'telefone') return d.length === 10 || d.length === 11 ? `+55${d}` : ''
  if (tipo === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) && v.length <= 77 ? v.toLowerCase() : ''
  if (tipo === 'aleatoria') {
    const h = v.toLowerCase().replace(/[^0-9a-f]/g, '')
    return h.length === 32 ? `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}` : ''
  }
  return ''
}

const fmtCpf = (c) => `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}`

// POST /api/ganhador?acao=pix { cpf, tipo, chave } — ganhador informa a chave Pix.
// Só aceita se o prêmio do CPF estiver liberado. Grava e avisa no WhatsApp (S-API).
async function pixHandler(req, res) {
  const cpf = onlyDigits(req.body?.cpf)
  const tipo = String(req.body?.tipo || '')
  const chave = normalizarChavePix(tipo, req.body?.chave)
  if (cpf.length !== 11) return res.status(400).json({ error: 'CPF inválido.' })
  if (!chave) return res.status(400).json({ error: 'Chave Pix inválida para o tipo escolhido.' })

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const srk = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !srk) return res.status(500).json({ error: 'Supabase service role não configurado.' })
  const h = { apikey: srk, Authorization: `Bearer ${srk}` }
  const get = async (path) => (await (await fetch(`${url}/rest/v1/${path}`, { headers: h })).json().catch(() => [])) || []

  try {
    const [premio] = await get(`premios_liberados?cpf=eq.${cpf}&select=estado,valor`)
    if (!premio || premio.estado !== 'liberado') return res.status(403).json({ error: 'Prêmio ainda não liberado para este CPF.' })
    const [decl] = await get(`premio_declaracao?cpf=eq.${cpf}&select=estado`)
    if (decl?.estado === 'recusou') return res.status(403).json({ error: 'Este prêmio foi recusado.' })
    const [ja] = await get(`premio_pix?cpf=eq.${cpf}&select=tipo,chave,nome`)
    if (ja) return res.status(200).json({ ok: true, jaInformada: true, tipo: ja.tipo, chave: ja.chave, nome: ja.nome, cpf })

    const [perfil] = await get(`profiles?cpf=eq.${cpf}&select=nome,telefone&limit=1`)
    const nome = perfil?.nome || ''
    const telefone = perfil?.telefone || ''

    const ins = await fetch(`${url}/rest/v1/premio_pix`, {
      method: 'POST',
      headers: { ...h, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ cpf, tipo, chave, nome, telefone }),
    })
    if (!ins.ok) {
      if (ins.status === 409) return res.status(200).json({ ok: true, jaInformada: true, cpf })
      return res.status(500).json({ error: 'Não foi possível salvar a chave Pix.' })
    }

    const primeiro = String(nome).split(' ')[0] || ''
    const msg = `Olá${primeiro ? `, ${primeiro}` : ''}! 🎉

Recebemos a sua chave Pix para o pagamento do prêmio:

*Nome:* ${nome || '—'}
*CPF:* ${fmtCpf(cpf)}
*Chave Pix (${tipo === 'aleatoria' ? 'aleatória' : tipo}):* ${chave}

O pagamento cairá na sua conta em alguns minutos. 💰`
    const w = telefone ? await enviarTexto(telefone, msg) : { ok: false, erro: 'Sem telefone no cadastro.' }
    await fetch(`${url}/rest/v1/premio_pix?cpf=eq.${cpf}`, {
      method: 'PATCH',
      headers: { ...h, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ whatsapp_ok: w.ok, whatsapp_erro: w.ok ? null : w.erro, updated_at: new Date().toISOString() }),
    }).catch(() => {})

    return res.status(200).json({ ok: true, tipo, chave, nome, cpf })
  } catch (e) {
    return res.status(500).json({ error: 'Erro ao salvar a chave Pix.' })
  }
}

export default async function handler(req, res) {
  if (req.method === 'POST' && req.query?.acao === 'pix') return pixHandler(req, res)
  if (req.method === 'POST') return enriquecerHandler(req, res)
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const cpf = onlyDigits(req.query?.cpf)
  if (cpf.length !== 11) {
    return res.status(400).json({ error: 'CPF inválido — informe 11 dígitos.' })
  }

  const token = process.env.OWNDATA_TOKEN || (await tokenDoBanco())
  if (!token) {
    return res.status(500).json({
      error: 'Token da API OwnData não configurado. Defina em /admin → Configurações (ou na env OWNDATA_TOKEN).',
    })
  }

  try {
    const url = `${OWNDATA_BASE}?token=${encodeURIComponent(token)}&modulo=cpf&consulta=${cpf}`
    const r = await fetch(url, { headers: { Accept: 'application/json' } })
    const text = await r.text()

    // A OwnData devolve JSON; se vier algo que não é JSON, repassamos como texto.
    let data
    try {
      data = JSON.parse(text)
    } catch {
      data = { raw: text }
    }

    if (!r.ok) {
      return res.status(502).json({ error: 'A API OwnData respondeu com erro.', status: r.status, detail: data })
    }

    return res.status(200).json(data)
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Falha ao consultar a API OwnData.' })
  }
}
