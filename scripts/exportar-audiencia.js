// Exporta a base de clientes (Supabase profiles) pra montar a Custom Audience do Meta.
// RODE LOCAL:  node scripts/exportar-audiencia.js
// Lê SUPABASE_URL (ou VITE_SUPABASE_URL) e SUPABASE_SERVICE_ROLE_KEY do .env.
// Escreve um JSON no scratchpad (só e-mail/telefone/nome/cidade/UF/CEP) — sem segredo.
import 'dotenv/config'
import fs from 'node:fs'

const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPA_URL || !SRK) {
  console.error('❌ Faltam SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no .env')
  process.exit(1)
}

const OUT = 'C:/Users/Ryko/AppData/Local/Temp/claude/C--Users-Ryko-Documents-VivaLaSuerte/68e9ee2b-0cc0-47db-8412-cdc1053612fe/scratchpad/audiencia.json'

const headers = { apikey: SRK, Authorization: `Bearer ${SRK}` }
// Só clientes reais (sem admin). Traz os campos úteis pro match do Meta.
const url = `${SUPA_URL}/rest/v1/profiles?select=email,telefone,nome,cidade,estado,cep&is_admin=eq.false`

const r = await fetch(url, { headers })
if (!r.ok) {
  console.error('❌ Erro Supabase', r.status, await r.text())
  process.exit(1)
}
const rows = await r.json()
// Mantém só quem tem e-mail OU telefone (senão não casa no Meta).
const limpos = rows.filter((u) => (u.email && u.email.includes('@')) || (u.telefone && String(u.telefone).replace(/\D/g, '').length >= 10))
fs.writeFileSync(OUT, JSON.stringify(limpos))
console.log(`✅ ${rows.length} perfis lidos, ${limpos.length} com e-mail/telefone.`)
console.log('Escrito em:', OUT)
