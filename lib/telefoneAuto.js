// Preenchimento AUTOMÁTICO de telefone via a base de consulta ATIVA (Serasa ou
// Supremo, configurável em /admin → Configurações) — pra clientes que só
// informaram o CPF no cadastro e nunca confirmaram o WhatsApp (ficam com
// telefone vazio pra sempre, sem isso). Roda periodicamente a partir de um
// timer no server.js (ver rodarTimerTelefoneAuto).
//
// Regras (pedidas explicitamente):
//   - só mexe em quem NÃO tem telefone;
//   - só depois de 10 MINUTOS do cadastro (dá tempo da pessoa confirmar
//     o WhatsApp sozinha, sem a gente atropelar);
//   - roda tanto em quem ainda não foi atribuído a ligador quanto em quem já
//     foi (mesmo já enviado a um ligador, se continua sem telefone, precisa
//     ser preenchido — não faz sentido ficar travado pra sempre);
//   - cada cliente só é tentado UMA VEZ (telefone_auto_verificado), ache ou
//     não o telefone — pra não gastar Serasa de novo no mesmo CPF pra sempre.
//
// Primeiro tenta reaproveitar o que a Serasa JÁ tinha devolvido no cadastro
// (dados_consulta.telefones, gravado em api/auth-cpf.js) — sem gastar uma
// consulta nova. Só faz uma consulta Serasa NOVA se não tiver nada salvo.

import { consultarCpf } from './consultaCpf.js'

const onlyDigits = (v) => String(v || '').replace(/\D/g, '')

function env() {
  const supaUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const srk = process.env.SUPABASE_SERVICE_ROLE_KEY
  return { supaUrl, srk, srkHeaders: { apikey: srk, Authorization: `Bearer ${srk}` } }
}

async function marcarVerificado(supaUrl, srkHeaders, id, patch = {}) {
  await fetch(`${supaUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { ...srkHeaders, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ telefone_auto_verificado: true, ...patch }),
  }).catch(() => {})
}

// Roda UMA passada: busca até `limite` candidatos e tenta preencher o telefone
// de cada um. Devolve { processados, preenchidos } (útil pra log).
export async function preencherTelefonesAutomaticamente(limite = 20) {
  const { supaUrl, srk, srkHeaders } = env()
  if (!supaUrl || !srk) return { processados: 0, preenchidos: 0 }

  const dezMinAtras = new Date(Date.now() - 10 * 60 * 1000).toISOString()
  const url =
    `${supaUrl}/rest/v1/profiles?select=id,cpf,created_at` +
    `&telefone=is.null` +
    `&telefone_auto_verificado=is.false&created_at=lte.${encodeURIComponent(dezMinAtras)}` +
    `&limit=${limite}`
  const r = await fetch(url, { headers: srkHeaders }).catch(() => null)
  const candidatos = r && r.ok ? await r.json().catch(() => []) : []
  if (!candidatos.length) return { processados: 0, preenchidos: 0 }

  let preenchidos = 0

  for (const p of candidatos) {
    const cpf = onlyDigits(p.cpf)
    if (cpf.length !== 11) { await marcarVerificado(supaUrl, srkHeaders, p.id); continue }

    // 1) Reaproveita o que a Serasa já trouxe no cadastro (sem gastar de novo).
    let telefone = null
    const dc = await fetch(
      `${supaUrl}/rest/v1/dados_consulta?user_id=eq.${encodeURIComponent(p.id)}&select=telefones`,
      { headers: srkHeaders }
    ).then((x) => (x.ok ? x.json() : [])).catch(() => [])
    if (Array.isArray(dc?.[0]?.telefones) && dc[0].telefones.length) {
      telefone = dc[0].telefones[0]
    }

    // 2) Nada salvo ainda: consulta o provedor ATIVO agora (Serasa ou Supremo).
    if (!telefone) {
      try {
        const { ok, data, campos } = await consultarCpf(cpf, { supaUrl, srkHeaders })
        if (ok && campos) {
          telefone = campos.telefoneRecente
          await fetch(`${supaUrl}/rest/v1/dados_consulta`, {
            method: 'POST',
            headers: { ...srkHeaders, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify({
              user_id: p.id, cpf,
              ...(campos.nome ? { nome: campos.nome } : {}),
              ...(campos.nascimento ? { nascimento: campos.nascimento } : {}),
              ...(campos.idade != null ? { idade: campos.idade } : {}),
              ...(campos.sexo ? { sexo: campos.sexo } : {}),
              ...(campos.telefones.length ? { telefones: campos.telefones } : {}),
              raw: data,
              updated_at: new Date().toISOString(),
            }),
          }).catch(() => {})
        }
      } catch { /* segue sem telefone — marca verificado do mesmo jeito, abaixo */ }
    }

    if (telefone) {
      await marcarVerificado(supaUrl, srkHeaders, p.id, { telefone: onlyDigits(telefone) })
      preenchidos++
    } else {
      await marcarVerificado(supaUrl, srkHeaders, p.id)
    }
  }

  return { processados: candidatos.length, preenchidos }
}

// Liga o timer (chamado uma vez a partir de server.js). Roda a cada
// `intervaloMin` minutos; a granularidade não precisa ser fina — os 10 min de
// espera já dão folga de sobra.
export function rodarTimerTelefoneAuto(intervaloMin = 5) {
  const rodar = () => {
    preencherTelefonesAutomaticamente().then(({ processados, preenchidos }) => {
      if (processados) console.log(`[telefoneAuto] ${preenchidos}/${processados} telefone(s) preenchido(s) automaticamente.`)
    }).catch((e) => console.error('[telefoneAuto] falhou:', e.message))
  }
  setInterval(rodar, intervaloMin * 60 * 1000)
  setTimeout(rodar, 30 * 1000) // primeira passada logo depois de subir, sem atropelar o boot
}
