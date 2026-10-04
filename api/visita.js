// POST /api/visita — registra UMA visita com a cidade aproximada do visitante.
// A cidade/UF/país vêm de geolocalização por IP (lib/geoip.js) — funciona em
// qualquer host. Grava na tabela `acessos` via service_role.
//
// ⚠️ Só funciona no site PUBLICADO: no localhost o /api não roda.
//    Requer SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.

import { geolocalizarIp } from '../lib/geoip.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const srk = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !srk) return res.status(200).json({ ok: false, skipped: 'sem-supabase' })

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || String(req.headers['x-real-ip'] || '')
  const { cidade, uf, pais } = await geolocalizarIp(ip)
  const path = String(req.body?.path || '').slice(0, 200)
  const ua = String(req.headers['user-agent'] || '').slice(0, 300)
  const vid = String(req.body?.vid || '').slice(0, 64) || null

  try {
    await fetch(`${url}/rest/v1/acessos`, {
      method: 'POST',
      headers: {
        apikey: srk,
        Authorization: `Bearer ${srk}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ ip, cidade, uf, pais, path, user_agent: ua, visitor_id: vid }),
    })
  } catch {
    /* não bloqueia a resposta */
  }
  return res.status(200).json({ ok: true })
}
