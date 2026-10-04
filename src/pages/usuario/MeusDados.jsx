import { useState, useEffect } from 'react'
import { useAuth } from '../../context/AuthContext.jsx'
import { supabase, isSupabaseConfigured } from '../../lib/supabase.js'
import { maskCpf, maskTelefone } from '../../utils/masks.js'

export default function MeusDados() {
  const { user, refreshProfile } = useAuth()
  const [form, setForm] = useState({ nome: '', nascimento: '', genero: '', telefone: '', email: '' })
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!user) return
    const p = user.profile || {}
    setForm({
      nome: p.nome || (user.name !== 'Cliente' ? user.name : ''),
      nascimento: p.nascimento || '',
      genero: p.genero || '',
      telefone: user.telefone || p.telefone || '',
      email: user.email || p.email || '',
    })
  }, [user])

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const salvar = async (e) => {
    e.preventDefault()
    if (!isSupabaseConfigured || !user) {
      setStatus('Salvo (modo demonstração).')
      return
    }
    setBusy(true)
    setStatus('')
    const { error } = await supabase
      .from('profiles')
      .update({
        nome: form.nome,
        nascimento: form.nascimento || null,
        genero: form.genero || null,
        telefone: form.telefone,
        email: form.email,
      })
      .eq('id', user.id)
    setBusy(false)
    if (error) setStatus('Erro ao salvar: ' + error.message)
    else {
      setStatus('Dados salvos com sucesso!')
      refreshProfile()
    }
  }

  return (
    <main className="page">
      <div className="container">
        <div className="pagehead">
          <h1>Meus dados</h1>
        </div>

        <form className="usr-form" onSubmit={salvar}>
          <h2 className="usr-form__title">Dados pessoais</h2>
          <p className="usr-muted">
            Talvez alguns dados não sejam alteráveis. Caso precise, entre em contato com
            nosso atendimento.
          </p>

          <div className="cad__field">
            <label>Nome completo <span className="cad__req">*</span></label>
            <input value={form.nome} onChange={(e) => set('nome', e.target.value)} placeholder="Seu nome completo" />
          </div>

          <label className="usr-check"><input type="checkbox" /> Usar nome social</label>

          <div className="usr-grid2">
            <div className="cad__field">
              <label>CPF <span className="cad__req">*</span></label>
              <input value={maskCpf(user?.cpf) || '—'} disabled />
            </div>
            <div className="cad__field">
              <label>Data de nascimento</label>
              <input type="date" value={form.nascimento || ''} onChange={(e) => set('nascimento', e.target.value)} />
            </div>
          </div>

          <div className="cad__field">
            <label>Gênero</label>
            <select value={form.genero || ''} onChange={(e) => set('genero', e.target.value)}>
              <option value="">Selecione</option>
              <option>Feminino</option>
              <option>Masculino</option>
              <option>Outro</option>
              <option>Prefiro não informar</option>
            </select>
          </div>

          <div className="cad__field">
            <label>Telefone / Whatsapp</label>
            <input value={form.telefone} inputMode="numeric" onChange={(e) => set('telefone', maskTelefone(e.target.value))} placeholder="(00) 00000-0000" />
          </div>

          <div className="cad__field">
            <label>E-mail</label>
            <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="voce@email.com" />
          </div>

          {status && <p className="usr-status">{status}</p>}

          <button type="submit" className="btn btn--buy usr-save" disabled={busy}>
            {busy ? 'Salvando…' : 'Salvar'}
          </button>
        </form>
      </div>
    </main>
  )
}
