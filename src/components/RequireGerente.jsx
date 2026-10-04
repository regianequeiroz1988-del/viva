import { Navigate } from 'react-router-dom'
import { getGerente } from '../lib/gerente.js'

export default function RequireGerente({ children }) {
  return getGerente()?.token ? children : <Navigate to="/gerente/entrar" replace />
}
