import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase.js'
import { useAuth } from '../../context/AuthContext.jsx'

// Login DEDICADO do /admin: e-mail + senha + 2FA (Google Authenticator / TOTP via MFA
// nativo do Supabase). Por baixo continua Supabase Auth, então a RLS (is_admin) segue
// funcionando. Chamado pelo RequireAdmin quando o admin ainda não está em aal2.
//
// Fluxo:
//   sem sessão            → passo 'senha' (e-mail + senha)
//   sessão sem 2FA        → passo 'enroll' (escaneia o QR 1x no app e ativa)
//   sessão com 2FA (aal1) → passo 'challenge' (digita o código de 6 dígitos)

const wrap = { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0e1633', padding: 20, fontFamily: 'Arial, Helvetica, sans-serif' }
const card = { width: '100%', maxWidth: 400, background: '#1b2145', color: '#fff', borderRadius: 16, padding: '28px 26px', boxShadow: '0 10px 40px rgba(0,0,0,.4)', boxSizing: 'border-box' }
const label = { display: 'block', fontSize: 13, color: '#aab3e0', margin: '14px 0 6px' }
const input = { width: '100%', boxSizing: 'border-box', padding: '12px 14px', borderRadius: 10, border: '1px solid #33407a', background: '#0e1633', color: '#fff', fontSize: 15 }
const btn = { width: '100%', marginTop: 18, padding: '13px', borderRadius: 999, border: 'none', background: '#3552ff', color: '#fff', fontWeight: 800, fontSize: 15, cursor: 'pointer' }
const linkBtn = { background: 'none', border: 'none', color: '#8aa0ff', cursor: 'pointer', fontSize: 13, marginTop: 14, textDecoration: 'underline' }
const errStyle = { color: '#ff8b8b', fontSize: 13, marginTop: 12 }

export default function AdminLogin({ onDone }) {
  const { logout } = useAuth()
  const [step, setStep] = useState('carregando') // carregando | senha | enroll | challenge
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [code, setCode] = useState('')
  const [erro, setErro] = useState('')
  const [busy, setBusy] = useState(false)
  const [enroll, setEnroll] = useState(null) // { qr, secret }
  const [factorId, setFactorId] = useState('')

  useEffect(() => {
    ;(async () => {
      const { data } = await supabase.auth.getSession()
      if (!data?.session) { setStep('senha'); return }
      await decidirMfa()
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function decidirMfa() {
    try {
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      if (aal?.currentLevel === 'aal2') { onDone?.(); return }
      const { data: f } = await supabase.auth.mfa.listFactors()
      const verificado = (f?.totp || []).find((x) => x.status === 'verified')
      if (verificado) { setFactorId(verificado.id); setStep('challenge') }
      else { await iniciarEnroll() }
    } catch (e) {
      setErro('Não foi possível iniciar o 2FA: ' + (e?.message || '') + '. Confira se o MFA está habilitado no Supabase.')
      setStep('senha')
    }
  }

  async function iniciarEnroll() {
    // Limpa fatores não-verificados órfãos (de tentativas anteriores) antes de criar um novo.
    try {
      const { data: f } = await supabase.auth.mfa.listFactors()
      for (const x of f?.all || []) {
        if (x.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: x.id }).catch(() => {})
      }
    } catch { /* ignore */ }
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Admin-' + Date.now() })
    if (error) { setErro('Falha ao gerar o 2FA: ' + error.message + ' — habilite o MFA no Supabase (Authentication → MFA).'); setStep('senha'); return }
    setEnroll({ qr: data.totp.qr_code, secret: data.totp.secret })
    setFactorId(data.id)
    setStep('enroll')
  }

  async function entrar(e) {
    e.preventDefault()
    setErro(''); setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password: senha })
    setBusy(false)
    if (error) { setErro('E-mail ou senha inválidos.'); return }
    setStep('carregando')
    await decidirMfa()
  }

  async function verificar(e) {
    e.preventDefault()
    setErro(''); setBusy(true)
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() })
    setBusy(false)
    if (error) { setErro('Código incorreto. Gere um novo no app e confira a hora do celular.'); return }
    onDone?.()
  }

  async function trocarConta() {
    await logout()
    setStep('senha'); setEmail(''); setSenha(''); setCode(''); setEnroll(null); setErro('')
  }

  return (
    <div style={wrap}>
      <div style={card}>
        <div style={{ textAlign: 'center', fontWeight: 800, letterSpacing: 1, color: '#8aa0ff', marginBottom: 6 }}>PAINEL ADMIN</div>

        {step === 'carregando' && <p style={{ textAlign: 'center', color: '#aab3e0' }}>Carregando…</p>}

        {step === 'senha' && (
          <form onSubmit={entrar}>
            <h1 style={{ fontSize: 20, textAlign: 'center', margin: '4px 0 10px' }}>Acesso restrito</h1>
            <label style={label}>E-mail</label>
            <input style={input} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="seu@email.com" />
            <label style={label}>Senha</label>
            <input style={input} type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} />
            {erro && <p style={errStyle}>{erro}</p>}
            <button style={btn} disabled={busy || !email || !senha}>{busy ? 'Entrando…' : 'Entrar'}</button>
          </form>
        )}

        {step === 'enroll' && enroll && (
          <form onSubmit={verificar} style={{ textAlign: 'center' }}>
            <h1 style={{ fontSize: 19, margin: '4px 0 8px' }}>Ative o 2FA</h1>
            <p style={{ fontSize: 13, color: '#aab3e0', margin: '0 0 14px' }}>Abra o <strong>Google Authenticator</strong> e escaneie o QR:</p>
            <img src={enroll.qr} alt="QR do 2FA" style={{ width: 190, height: 190, background: '#fff', borderRadius: 10, padding: 6, boxSizing: 'border-box' }} />
            <p style={{ fontSize: 12, color: '#8891bd', margin: '10px 0 4px' }}>Ou digite este código no app:</p>
            <code style={{ display: 'block', fontSize: 13, color: '#cdd6ff', wordBreak: 'break-all', marginBottom: 6 }}>{enroll.secret}</code>
            <p style={{ fontSize: 11, color: '#ffb26b', margin: '0 0 12px' }}>⚠️ Guarde esse código num lugar seguro — é seu backup se perder o celular.</p>
            <label style={label}>Código de 6 dígitos do app</label>
            <input style={{ ...input, textAlign: 'center', letterSpacing: 6, fontSize: 20 }} inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="000000" />
            {erro && <p style={errStyle}>{erro}</p>}
            <button style={btn} disabled={busy || code.length !== 6}>{busy ? 'Ativando…' : 'Ativar e entrar'}</button>
            <button type="button" style={linkBtn} onClick={trocarConta}>Usar outra conta</button>
          </form>
        )}

        {step === 'challenge' && (
          <form onSubmit={verificar} style={{ textAlign: 'center' }}>
            <h1 style={{ fontSize: 20, margin: '4px 0 8px' }}>Verificação em 2 fatores</h1>
            <p style={{ fontSize: 13, color: '#aab3e0', margin: '0 0 16px' }}>Digite o código de 6 dígitos do <strong>Google Authenticator</strong>.</p>
            <input style={{ ...input, textAlign: 'center', letterSpacing: 6, fontSize: 22 }} inputMode="numeric" maxLength={6} autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="000000" />
            {erro && <p style={errStyle}>{erro}</p>}
            <button style={btn} disabled={busy || code.length !== 6}>{busy ? 'Verificando…' : 'Verificar'}</button>
            <button type="button" style={linkBtn} onClick={trocarConta}>Usar outra conta</button>
          </form>
        )}
      </div>
    </div>
  )
}
