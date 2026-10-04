import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { supabase, isSupabaseConfigured } from '../lib/supabase.js'
import AdminLogin from '../pages/admin/AdminLogin.jsx'

// Protege o painel: precisa ser ADMIN e ter passado o 2º FATOR (aal2 do Supabase MFA).
// Enquanto não estiver em aal2, mostra a tela de login própria do /admin (e-mail + senha
// + Google Authenticator). A RLS continua por Supabase Auth (o admin tem sessão real).
function Restrito({ onSair }) {
  return (
    <main className="page">
      <div className="container ph-page__box">
        <h1>Acesso restrito</h1>
        <p className="page__p">Esta área é exclusiva para administradores.</p>
        <button onClick={onSair} style={{ marginTop: 12, padding: '10px 18px', borderRadius: 999, border: 'none', background: '#3552ff', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>Sair</button>
      </div>
    </main>
  )
}

export default function RequireAdmin({ children }) {
  const { isAuthed, loading, user, logout } = useAuth()
  const [aal, setAal] = useState('aal1')
  const [aalLoading, setAalLoading] = useState(true)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!isSupabaseConfigured) { setAalLoading(false); return }
    if (!isAuthed) { setAal('aal1'); setAalLoading(false); return }
    let on = true
    setAalLoading(true)
    supabase.auth.mfa
      .getAuthenticatorAssuranceLevel()
      .then(({ data }) => { if (on) setAal(data?.currentLevel || 'aal1') })
      .catch(() => { if (on) setAal('aal1') })
      .finally(() => { if (on) setAalLoading(false) })
    return () => { on = false }
  }, [isAuthed, user?.id, tick])

  if (loading || (isSupabaseConfigured && isAuthed && aalLoading)) {
    return (
      <main className="page">
        <div className="container"><p className="page__p">Carregando…</p></div>
      </main>
    )
  }

  // Modo mock (dev sem Supabase): comportamento antigo, sem 2FA.
  if (!isSupabaseConfigured) {
    if (!isAuthed) return <Navigate to="/autenticar" replace />
    if (!user?.isAdmin) return <Restrito onSair={logout} />
    return children
  }

  // Logado, mas não é admin → acesso restrito.
  if (isAuthed && !user?.isAdmin) return <Restrito onSair={logout} />

  // Não logado como admin, ou ainda sem o 2º fator → tela de login do admin.
  if (!isAuthed || aal !== 'aal2') return <AdminLogin onDone={() => setTick((t) => t + 1)} />

  return children
}
