// Dispatcher ÚNICO das rotas admin (rota dinâmica do Vercel).
// A Vercel no plano Hobby limita a 12 Serverless Functions por deployment; por isso
// as ações do /admin ficam numa só função e a lógica vive em lib/admin-handlers.js.
//   /api/admin/enriquecer   → action = 'enriquecer'
//   /api/admin/serasa-test  → action = 'serasa-test'

import { enriquecerHandler, serasaTestHandler } from '../../lib/admin-handlers.js'

const handlers = {
  enriquecer: enriquecerHandler,
  'serasa-test': serasaTestHandler,
}

export default function handler(req, res) {
  const action = String(req.query?.action || '')
  const fn = handlers[action]
  if (!fn) return res.status(404).json({ error: `Endpoint admin não encontrado: ${action}` })
  return fn(req, res)
}
