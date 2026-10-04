import { Navigate } from 'react-router-dom'
import { getLigador } from '../lib/ligador.js'

// Protege a área do ligador: precisa de uma sessão (token) válida.
export default function RequireLigador({ children }) {
  return getLigador()?.token ? children : <Navigate to="/ligador/entrar" replace />
}
