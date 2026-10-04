// Backfill manual de enriquecimento (Serasa) — RODE NA SUA MÁQUINA.
//
// ⚠️ CADA CONSULTA À SERASA É PAGA. Diferente do provedor antigo (Supremo/OwnData,
//    baratos/ilimitados), aqui cada CPF processado gera custo real na conta da
//    Serasa. Por segurança, o script SÓ roda em lote (mais de 1 CPF) se você passar
//    a flag --confirmo-custo — leia o aviso que aparece antes de continuar.
//
// O que faz: pega os perfis (com CPF) que AINDA não têm dados em `dados_consulta`,
// consulta cada um na Serasa e grava nascimento/idade/sexo/renda.
//
// ── Como rodar ──────────────────────────────────────────────────────────────
//   1) No arquivo .env (na raiz do projeto) tenha:
//        SUPABASE_URL=...            (ou já existe VITE_SUPABASE_URL)
//        SUPABASE_SERVICE_ROLE_KEY=...   (pega no Supabase → Settings → API)
//      As credenciais da Serasa (Client ID/Secret/proxy IPv4) o script lê sozinho
//      do /admin → Configurações (mesmo lugar que o site usa). Se preferir, defina
//      SERASA_CLIENT_ID / SERASA_CLIENT_SECRET / SERASA_PROXY no .env — têm prioridade.
//   2) Testar com 1 CPF antes (não precisa da flag de custo):
//        node scripts/enriquecer-consultas.js 1
//   3) Rodar em lote (PAGO — exige a flag):
//        node scripts/enriquecer-consultas.js --confirmo-custo
//      Só os 10 primeiros:      node scripts/enriquecer-consultas.js 10 --confirmo-custo
//      Mais rápido (5 em paralelo): node scripts/enriquecer-consultas.js --confirmo-custo --par=5
//      Recalcular do raw salvo (0 custo): node scripts/enriquecer-consultas.js reextrair
//
// Requer Node 18+ (usa fetch nativo) e o pacote "undici" (já é dependência do projeto).

import 'dotenv/config'
import { consultarSerasaPF, extrairSerasa, telefoneConfere, lerCredenciaisSerasa } from '../lib/serasa.js'

const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY
// Modo "re-extrair": relê o `raw` já salvo e recalcula os campos, SEM chamar a Serasa
// (zero custo). Use: node scripts/enriquecer-consultas.js reextrair
const REEXTRAIR = process.argv.includes('reextrair') || process.argv.includes('--reextrair')
const CONFIRMOU_CUSTO = process.argv.includes('--confirmo-custo')
const LIMITE = parseInt(process.argv[2] || '0', 10) || 0 // 0 = todos (na consulta normal)
// Paralelismo: quantas consultas ao mesmo tempo. Padrão 3 (mais baixo que o antigo —
// são chamadas pagas, não precisa de pressa). Override: --par=5
const parFlag = process.argv.find((a) => a.startsWith('--par='))
const CONCORRENCIA = Math.max(1, parseInt(parFlag ? parFlag.split('=')[1] : '3', 10) || 3)
// Pausa (ms) entre consultas em cada worker. Ex.: --delay=400
const delayFlag = process.argv.find((a) => a.startsWith('--delay='))
const DELAY = Math.max(0, parseInt(delayFlag ? delayFlag.split('=')[1] : '0', 10) || 0)

const onlyDigits = (v) => String(v || '').replace(/\D/g, '')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const supaHeaders = { apikey: SRK, Authorization: `Bearer ${SRK}` }

// Roda `worker(item, i, total)` sobre os itens, com no máximo `n` em paralelo.
async function processarEmLote(itens, n, worker) {
  let idx = 0
  const runner = async () => {
    while (idx < itens.length) {
      const i = idx++
      await worker(itens[i], i, itens.length)
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, itens.length) }, runner))
}

function checarEnv() {
  const faltam = []
  if (!SUPA_URL) faltam.push('SUPABASE_URL (ou VITE_SUPABASE_URL)')
  if (!SRK) faltam.push('SUPABASE_SERVICE_ROLE_KEY')
  if (faltam.length) {
    console.error('❌ Faltam variáveis no .env: ' + faltam.join(', '))
    process.exit(1)
  }
}

// Lê todas as linhas de um endpoint PostgREST (paginado de 1000 em 1000).
async function lerTudo(path) {
  const out = []
  let offset = 0
  const page = 1000
  for (;;) {
    const sep = path.includes('?') ? '&' : '?'
    const r = await fetch(`${SUPA_URL}/rest/v1/${path}${sep}limit=${page}&offset=${offset}`, { headers: supaHeaders })
    const rows = await r.json().catch(() => [])
    if (!Array.isArray(rows) || rows.length === 0) break
    out.push(...rows)
    if (rows.length < page) break
    offset += page
  }
  return out
}

// Credenciais da Serasa: .env tem prioridade, senão lê do /admin (tabela configuracoes).
async function getCredenciais() {
  if (process.env.SERASA_CLIENT_ID && process.env.SERASA_CLIENT_SECRET && process.env.SERASA_PROXY) {
    return { clientId: process.env.SERASA_CLIENT_ID, clientSecret: process.env.SERASA_CLIENT_SECRET, proxy: process.env.SERASA_PROXY }
  }
  return lerCredenciaisSerasa({ supaUrl: SUPA_URL, srkHeaders: supaHeaders })
}

async function upsert(userId, cpf, campos, raw) {
  const r = await fetch(`${SUPA_URL}/rest/v1/dados_consulta`, {
    method: 'POST',
    headers: { ...supaHeaders, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ user_id: userId, cpf, ...campos, raw, updated_at: new Date().toISOString() }),
  })
  return r.ok // false se a tabela não existe / RLS / etc — pra não fingir que salvou
}

// Garante que a tabela dados_consulta existe e é gravável ANTES de começar.
async function checarTabela() {
  const r = await fetch(`${SUPA_URL}/rest/v1/dados_consulta?select=user_id&limit=1`, { headers: supaHeaders })
  if (!r.ok) {
    const t = await r.text().catch(() => '')
    console.error('\n❌ Não consegui acessar a tabela "dados_consulta".')
    console.error('   Você já rodou o SQL em supabase/dados_consulta_setup.sql no Supabase (SQL Editor)?')
    console.error('   Resposta do Supabase:', r.status, t.slice(0, 200), '\n')
    process.exit(1)
  }
}

// Re-extrai os campos a partir do `raw` já salvo (sem chamar a Serasa → zero custo).
// Conserta registros antigos depois de a gente melhorar a extração.
async function reextrair() {
  await checarTabela()
  const rows = await lerTudo('dados_consulta?select=user_id,cpf,raw')
  console.log(`Re-extraindo ${rows.length} registros do raw salvo (sem gastar nada)…\n`)
  let ok = 0, falhou = 0
  await processarEmLote(rows, CONCORRENCIA, async (r, i, total) => {
    const campos = extrairSerasa(r.raw)
    const salvou = await upsert(r.user_id, r.cpf, campos, r.raw)
    if (salvou) {
      ok++
      console.log(
        `[${i + 1}/${total}] ${r.cpf} — ✅  ${campos.nome || '—'} · ${campos.nascimento || '—'} · ${campos.sexo || '—'} · renda ${campos.renda || '—'}`
      )
    } else {
      falhou++
      console.log(`[${i + 1}/${total}] ${r.cpf} — ⚠️ falhou ao salvar`)
    }
  })
  console.log(`\n──────── FIM (re-extração) ────────\n✅ Atualizados: ${ok}\n⚠️ Falharam: ${falhou}`)
}

async function main() {
  checarEnv()

  if (REEXTRAIR) { await reextrair(); return }

  await checarTabela() // aborta com mensagem clara se o SQL não foi rodado

  const cred = await getCredenciais()
  if (!cred.clientId || !cred.clientSecret || !cred.proxy) {
    console.error('❌ Serasa não configurada: preencha Client ID, Client Secret e o proxy IPv4 em /admin → Configurações')
    console.error('   (ou defina SERASA_CLIENT_ID / SERASA_CLIENT_SECRET / SERASA_PROXY no .env).')
    process.exit(1)
  }

  console.log('Buscando perfis pendentes…')
  const [jaConsultados, perfis] = await Promise.all([
    lerTudo('dados_consulta?select=user_id,nascimento,renda,sexo'),
    lerTudo('profiles?select=id,cpf,nome,telefone&cpf=not.is.null'),
  ])
  // "Já feito" = só quem tem ao menos UM dado preenchido. Linhas all-null (consulta
  // vazia salva antes do ajuste, ou blip) voltam a ser pendentes pra tentar de novo.
  const jaSet = new Set(
    jaConsultados.filter((x) => x.nascimento || x.renda || x.sexo).map((x) => x.user_id)
  )
  let pendentes = perfis.filter((p) => onlyDigits(p.cpf).length === 11 && !jaSet.has(p.id))
  if (LIMITE > 0) pendentes = pendentes.slice(0, LIMITE)

  console.log(`Total de perfis: ${perfis.length} · já consultados: ${jaSet.size} · a processar agora: ${pendentes.length}\n`)
  if (pendentes.length === 0) { console.log('✅ Nada pendente. Tudo já está atualizado.'); return }

  // Trava de segurança: acima de 1 CPF, cada consulta é PAGA — exige confirmação explícita.
  if (pendentes.length > 1 && !CONFIRMOU_CUSTO) {
    console.error(`\n⚠️  Isso vai rodar ${pendentes.length} consultas PAGAS na Serasa.`)
    console.error('   Rode com --confirmo-custo pra prosseguir, ou teste com 1 CPF antes:')
    console.error('   node scripts/enriquecer-consultas.js 1\n')
    process.exit(1)
  }

  let ok = 0, falhou = 0, vazios = 0

  async function processarUm(p, i, total) {
    const cpf = onlyDigits(p.cpf)
    const tag = `[${i + 1}/${total}] ${p.nome || ''} (${cpf})`
    try {
      const { ok: respOk, status, data } = await consultarSerasaPF(cpf, cred)
      if (!respOk) {
        falhou++
        const motivo = String(data?.message || data?.error || data?.raw || `status ${status}`)
        console.log(`${tag} — ⚠️ ERRO: ${motivo}`)
        return
      }
      const campos = extrairSerasa(data)
      const temDados = !!(campos.nome || campos.nascimento || campos.renda || campos.sexo || campos.telefones.length)
      if (!temDados) {
        // Respondeu mas não trouxe NENHUM dado (CPF sem base ou blip): NÃO salva —
        // fica pendente pra tentar de novo numa próxima rodada.
        vazios++
        console.log(`${tag} — ⚪ sem dados (não salvo — tenta de novo na próxima rodada)`)
        return
      }
      const confere = telefoneConfere(p.telefone, campos.telefones)
      const { telefoneRecente, ...camposSalvar } = campos
      const salvou = await upsert(p.id, cpf, { ...camposSalvar, telefone_confere: confere }, data)
      // Sem telefone no cadastro → preenche com o mais recente da Serasa (o digitado vence).
      if (salvou && onlyDigits(p.telefone).length < 10 && telefoneRecente) {
        await fetch(`${SUPA_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(p.id)}`, {
          method: 'PATCH',
          headers: { ...supaHeaders, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ telefone: telefoneRecente }),
        }).catch(() => {})
      }
      if (salvou) {
        ok++
        console.log(
          `${tag} — ✅\n` +
          `   Nome:       ${campos.nome || '—'}\n` +
          `   Nascimento: ${campos.nascimento || '—'} (idade ${campos.idade ?? '—'})\n` +
          `   Sexo:       ${campos.sexo || '—'}\n` +
          `   Renda:      ${campos.renda || '—'}\n` +
          `   Confere:    ${confere === true ? 'SIM' : confere === false ? 'NÃO bate ⚠️' : '—'}`
        )
      } else {
        falhou++
        console.log(`${tag} — ⚠️ puxou dado mas FALHOU ao salvar no banco (tabela/RLS?)`)
      }
    } catch (e) {
      falhou++
      console.log(`${tag} — falha: ${e.message}`)
    }
    if (DELAY) await sleep(DELAY)
  }

  console.log(`Rodando ${CONCORRENCIA} em paralelo${DELAY ? ` (pausa ${DELAY}ms)` : ''}…\n`)
  await processarEmLote(pendentes, CONCORRENCIA, processarUm)

  console.log(`\n──────── FIM ────────\n✅ Atualizados: ${ok}\n⚪ Sem dados (vão tentar de novo): ${vazios}\n⚠️ Falharam (erro/502/503): ${falhou}`)
}

main().catch((e) => { console.error('Erro fatal:', e); process.exit(1) })
