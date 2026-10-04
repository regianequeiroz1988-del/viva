import { createContext, useContext, useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured, onlyDigits } from '../lib/supabase.js'
import { getUtms } from '../lib/utm.js'

const AuthContext = createContext(null)
const STORAGE_KEY = 'vs_user' // usado só no modo mock (sem chaves do Supabase)

// Monta o objeto `user` da UI a partir da sessão + perfil do banco
function buildUser(session, profile) {
  return {
    id: session.user.id,
    cpf: profile?.cpf || '',
    name: profile?.nome || 'Cliente',
    isAdmin: profile?.is_admin === true,
    email: profile?.email || '',
    telefone: profile?.telefone || '',
    points: profile?.pontos ?? 0,
    creditosNaoSacaveis: profile?.creditos_nao_sacaveis ?? 0,
    saldoSaque: profile?.saldo_saque ?? 0,
    totalSacado: profile?.total_sacado ?? 0,
    preferencias: profile?.preferencias || null,
    profile: profile || null,
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    if (isSupabaseConfigured) return null
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || null
    } catch {
      return null
    }
  })
  const [loading, setLoading] = useState(isSupabaseConfigured)

  const loadProfile = async (session) => {
    if (!session?.user) {
      setUser(null)
      return
    }
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .maybeSingle()
    setUser(buildUser(session, profile))
  }

  useEffect(() => {
    if (!isSupabaseConfigured) return
    supabase.auth.getSession().then(({ data }) => {
      loadProfile(data.session).finally(() => setLoading(false))
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      loadProfile(session)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  // ---- modo MOCK (sem Supabase) -------------------------------------------
  const mockLogin = (data = {}) => {
    const u = { name: data.nome || data.name || 'Cliente', cpf: data.cpf || '', points: 0, ...data }
    setUser(u)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(u))
    } catch {
      /* ignore */
    }
  }

  // ---- AUTENTICACAO (por CPF, SEM SENHA) ----------------------------------
  // Passo 1: consulta a API pelo CPF e cria/acha a conta no servidor. Devolve só
  // o nome (pra saudação) — nada sensível (telefones ficam no backend).
  const consultarCadastro = async (cpf) => {
    if (!isSupabaseConfigured) return { ok: true, nome: '', jaCadastrado: false }
    // Origem do tráfego (UTM) capturada na chegada — grava na ficha p/ saber de
    // qual link/campanha o cliente veio ("PROPRIO-..." = nosso anúncio).
    const u = getUtms()
    const origem = String(u.utm_campaign || u.utm_source || '').slice(0, 200)
    try {
      const r = await fetch('/api/auth-cpf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: 'consultar', cpf: onlyDigits(cpf), origem }),
      })
      const ct = r.headers.get('content-type') || ''
      if (!ct.includes('application/json'))
        return { ok: false, error: 'A consulta de CPF só funciona no site publicado.' }
      const data = await r.json()
      if (!r.ok) return { ok: false, error: data.error || 'Não foi possível consultar agora.' }
      // Conta que já tem telefone: o servidor já devolve a sessão → entra direto,
      // sem passar pela tela do WhatsApp.
      if (data.session) {
        const { error } = await supabase.auth.setSession(data.session)
        if (error) return { ok: false, error: error.message }
        return { ok: true, nome: data.nome || '', jaCadastrado: !!data.jaCadastrado, logado: true }
      }
      return { ok: true, nome: data.nome || '', jaCadastrado: !!data.jaCadastrado, logado: false }
    } catch (e) {
      return { ok: false, error: e.message || 'Falha de conexão.' }
    }
  }

  // Passo 2: salva o WhatsApp digitado, roda a comparação (só registra) e ENTRA —
  // o servidor devolve a sessão e aqui a gente assenta com setSession.
  const entrarPorTelefone = async ({ cpf, telefone }) => {
    if (!isSupabaseConfigured) {
      mockLogin({ cpf })
      return { ok: true, confere: null }
    }
    try {
      const r = await fetch('/api/auth-cpf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: 'confirmar', cpf: onlyDigits(cpf), telefone: onlyDigits(telefone) }),
      })
      const ct = r.headers.get('content-type') || ''
      if (!ct.includes('application/json'))
        return { ok: false, error: 'O cadastro só funciona no site publicado.' }
      const data = await r.json()
      if (!r.ok || !data.session) return { ok: false, error: data.error || 'Não foi possível entrar agora.' }
      // Assenta a sessão do Supabase → dispara onAuthStateChange → carrega o perfil.
      const { error } = await supabase.auth.setSession(data.session)
      if (error) return { ok: false, error: error.message }
      return { ok: true, confere: data.confere }
    } catch (e) {
      return { ok: false, error: e.message || 'Falha de conexão.' }
    }
  }

  const logout = async () => {
    if (isSupabaseConfigured) {
      await supabase.auth.signOut()
      setUser(null)
    } else {
      try {
        localStorage.removeItem(STORAGE_KEY)
      } catch {
        /* ignore */
      }
      setUser(null)
    }
  }

  // Recarrega o perfil do banco (chamar após salvar dados)
  const refreshProfile = async () => {
    if (!isSupabaseConfigured) return
    const { data } = await supabase.auth.getSession()
    await loadProfile(data.session)
  }

  return (
    <AuthContext.Provider
      value={{ user, isAuthed: !!user, loading, consultarCadastro, entrarPorTelefone, logout, refreshProfile }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth precisa estar dentro de <AuthProvider>')
  return ctx
}
