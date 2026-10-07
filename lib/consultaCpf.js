// Escolhe a BASE DE CONSULTA de CPF ativa (config `base_consulta_cpf`, editável no
// /admin em "Configurações") e expõe uma função ÚNICA `consultarCpf()` pra todos os
// call-sites (login/cadastro, enriquecimento, botão "atualizar cliente", timer
// automático de telefone, script de backfill). Isso permite trocar de provedor sem
// mexer em cada lugar — útil quando um dos dois está fora do ar.
//
// Provedores suportados:
//   'serasa'  (padrão) — Serasa Experian, pago por consulta, precisa de Client
//             ID/Secret + proxy IPv4 configurados no /admin.
//   'supremo' — provedor alternativo (sem custo por consulta conhecido até aqui),
//             sem credenciais — só precisa estar no ar.
//   'work'    — Work API (módulo CPF WORK), chave `workapi_key` no /admin.

import { consultarSerasaPF, extrairSerasa, telefoneConfere, lerCredenciaisSerasa } from './serasa.js'
import { consultarSupremo, extrairSupremo } from './supremo.js'
import { consultarWork, extrairWork, registroWork, lerChaveWork } from './workapi.js'

export { telefoneConfere }

const CHAVE_BASE = 'base_consulta_cpf'

/** Lê a base ativa ('serasa', 'supremo' ou 'work'). Qualquer valor desconhecido/vazio cai em 'serasa'. */
export async function lerBaseConsultaCpf({ supaUrl, srkHeaders }) {
  const r = await fetch(
    `${supaUrl}/rest/v1/configuracoes?chave=eq.${CHAVE_BASE}&select=valor`,
    { headers: srkHeaders }
  ).catch(() => null)
  const rows = r && r.ok ? await r.json().catch(() => []) : []
  const v = rows?.[0]?.valor
  return v === 'supremo' || v === 'work' ? v : 'serasa'
}

// Consulta o CPF na base ativa. Devolve { ok, provider, data, campos }.
// `campos` já vem no formato UNIFICADO (nome/nascimento/idade/sexo/renda/telefones),
// igual nos dois provedores — os call-sites não precisam saber qual foi usado.
export async function consultarCpf(cpf, { supaUrl, srkHeaders }) {
  const provider = await lerBaseConsultaCpf({ supaUrl, srkHeaders })

  if (provider === 'supremo') {
    const { ok, data } = await consultarSupremo(cpf)
    if (!ok || !data?.success) return { ok: false, provider, data: null, campos: null }
    return { ok: true, provider, data, campos: normalizarCampos(extrairSupremo(data)) }
  }

  if (provider === 'work') {
    const apiKey = await lerChaveWork({ supaUrl, srkHeaders })
    if (!apiKey) return { ok: false, provider, data: null, campos: null, erro: 'chave da Work API não configurada' }
    const { ok, status, data } = await consultarWork(cpf, apiKey)
    if (!ok || !registroWork(data)) {
      const msg = data?.message || data?.error || data?.data?.body?.message || data?.data?.body?.error || ''
      const interno = data?.data?.status ?? data?.data?.body?.status
      const erro = !ok
        ? `Work API respondeu ${status}${msg ? `: ${msg}` : ''}`
        : `Work API não trouxe dados${interno ? ` (status ${interno})` : ''}${msg ? `: ${msg}` : ''}`
      console.log('[consultaCpf] work falhou —', erro, '|', JSON.stringify(data).slice(0, 500))
      return { ok: false, provider, data: null, campos: null, erro }
    }
    return { ok: true, provider, data, campos: normalizarCampos(extrairWork(data)) }
  }

  // Serasa (padrão) — precisa de credenciais configuradas.
  const cred = await lerCredenciaisSerasa({ supaUrl, srkHeaders })
  if (!cred.clientId || !cred.clientSecret || !cred.proxy) {
    return { ok: false, provider, data: null, campos: null } // Serasa não configurada
  }
  const { ok, data } = await consultarSerasaPF(cpf, cred)
  if (!ok || !data) return { ok: false, provider, data: null, campos: null }
  return { ok: true, provider, data, campos: normalizarCampos(extrairSerasa(data)) }
}

// Garante `telefoneRecente` presente nos dois provedores (a Serasa já traz; o
// Supremo não tem esse conceito — usa o primeiro telefone da lista).
function normalizarCampos(campos) {
  if (!campos) return campos
  return { ...campos, telefoneRecente: campos.telefoneRecente ?? campos.telefones?.[0] ?? null }
}
