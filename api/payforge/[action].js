// Dispatcher ÚNICO da PayForge (rota dinâmica do Vercel).
// pix/status/webhook/health ficam numa só função por conta do limite de functions no plano Hobby.

import { pixHandler, statusHandler, webhookHandler, healthHandler } from '../../lib/payforge-handlers.js'

const handlers = {
  pix: pixHandler,
  status: statusHandler,
  webhook: webhookHandler,
  health: healthHandler,
}

export default function handler(req, res) {
  const action = String(req.query?.action || '')
  const fn = handlers[action]
  if (!fn) return res.status(404).json({ error: `Endpoint PayForge não encontrado: ${action}` })
  return fn(req, res)
}
