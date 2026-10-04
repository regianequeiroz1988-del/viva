import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'

// Protege rotas logadas: sem login, manda pro /autenticar (igual ao site oficial)
export default function RequireAuth({ children }) {
  const { isAuthed, loading } = useAuth()
  const location = useLocation()

  // Enquanto verifica a sessão do Supabase, não decide nada ainda
  if (loading) {
    return (
      <main className="page">
        <div className="container">
          <p className="page__p">Carregando…</p>
        </div>
      </main>
    )
  }

  if (!isAuthed) {
    return <Navigate to="/autenticar" replace state={{ from: location.pathname }} />
  }
  return children
}
