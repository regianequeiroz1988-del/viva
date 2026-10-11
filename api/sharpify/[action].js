import { pixHandler, statusHandler, webhookHandler, healthHandler } from '../../lib/sharpify-handlers.js'

const handlers = {
  pix: pixHandler,
  status: statusHandler,
  webhook: webhookHandler,
  health: healthHandler,
}

export default function handler(req, res) {
  const action = String(req.query?.action || '')
  const fn = handlers[action]
  if (!fn) return res.status(404).json({ error: `Endpoint Sharpify não encontrado: ${action}` })
  return fn(req, res)
}
