import { pixHandler, statusHandler, webhookHandler, healthHandler } from '../../lib/umbrella-handlers.js'

const handlers = {
  pix: pixHandler,
  status: statusHandler,
  webhook: webhookHandler,
  health: healthHandler,
}

export default function handler(req, res) {
  const action = String(req.query?.action || '')
  const fn = handlers[action]
  if (!fn) return res.status(404).json({ error: `Endpoint Umbrella não encontrado: ${action}` })
  return fn(req, res)
}
