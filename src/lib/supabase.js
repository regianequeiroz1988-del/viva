import { createClient } from '@supabase/supabase-js'

/**
 * Cliente Supabase.
 * As chaves vêm do .env (Vite expõe só as variáveis com prefixo VITE_):
 *   VITE_SUPABASE_URL=https://xxxxx.supabase.co
 *   VITE_SUPABASE_ANON_KEY=eyJ...   (chave "anon public" — pode ir no front)
 *
 * Enquanto não houver chaves, `supabase` é null e o app continua no
 * modo de login SIMULADO (mock) sem quebrar.
 */
const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(url && anonKey)

export const supabase = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null

// Login do site é por CPF. O Supabase Auth é por e-mail, então usamos um
// e-mail "sintético" derivado do CPF — o cliente loga com CPF + senha, mas
// por baixo o Supabase usa este e-mail. O e-mail real do cliente fica no perfil.
// O Supabase valida o domínio do e-mail (rejeita domínios falsos/sem MX), então
// o cadastro usa o e-mail REAL do cliente. O login é por CPF: uma função no banco
// (email_do_cpf) devolve o e-mail daquele CPF e aí autenticamos por e-mail + senha.
export const onlyDigits = (v) => String(v || '').replace(/\D/g, '')
