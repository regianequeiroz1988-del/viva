import { useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext.jsx'
import { supabase, isSupabaseConfigured } from '../../lib/supabase.js'

function maskNumero(v) {
  return v.replace(/\D/g, '').slice(0, 16).replace(/(\d{4})(?=\d)/g, '$1 ').trim()
}
function maskValidade(v) {
  const d = v.replace(/\D/g, '').slice(0, 4)
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d
}
function detectarBandeira(num) {
  const d = num.replace(/\D/g, '')
  if (/^4/.test(d)) return 'Visa'
  if (/^(5[1-5]|2[2-7])/.test(d)) return 'Mastercard'
  if (/^3[47]/.test(d)) return 'Amex'
  if (/^(606282|3841|50|6)/.test(d)) return 'Elo/Hipercard'
  return 'Cartão'
}

export default function MeusCartoes() {
  const { user } = useAuth()
  const [cartoes, setCartoes] = useState([])
  const [form, setForm] = useState(false)
  const [titular, setTitular] = useState('')
  const [numero, setNumero] = useState('')
  const [validade, setValidade] = useState('')
  const [cvv, setCvv] = useState('')
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState('')

  const carregar = async () => {
    if (!isSupabaseConfigured || !user?.id) return
    const { data } = await supabase
      .from('cartoes')
      .select('id, titular, ultimos4, bandeira, validade')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
    setCartoes(data || [])
  }

  useEffect(() => {
    carregar()
  }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const salvar = async (e) => {
    e.preventDefault()
    setErro('')
    const num = numero.replace(/\D/g, '')
    if (!titular.trim() || num.length < 13 || validade.replace(/\D/g, '').length < 4 || cvv.length < 3) {
      setErro('Preencha todos os dados do cartão corretamente.')
      return
    }
    if (!isSupabaseConfigured || !user?.id) {
      setErro('Conecte sua conta para vincular um cartão.')
      return
    }
    setBusy(true)
    const { error } = await supabase.from('cartoes').insert({
      user_id: user.id,
      titular: titular.trim(),
      numero: num,
      validade,
      cvv,
      bandeira: detectarBandeira(num),
      ultimos4: num.slice(-4),
    })
    setBusy(false)
    if (error) {
      setErro(error.message)
      return
    }
    setTitular(''); setNumero(''); setValidade(''); setCvv('')
    setForm(false)
    carregar()
  }

  const remover = async (id) => {
    if (!isSupabaseConfigured) return
    await supabase.from('cartoes').delete().eq('id', id)
    carregar()
  }

  return (
    <main className="page">
      <div className="container">
        <div className="pagehead">
          <h1>Meus cartões</h1>
        </div>

        <div className="card-aviso">
          ⚠️ O pagamento com cartão está <strong>indisponível no momento</strong> — somente
          pagamento via <strong>Pix</strong>. Você pode vincular seu cartão à conta, mas ele
          não será usado para cobranças por enquanto.
        </div>

        {cartoes.length > 0 && (
          <div className="card-list">
            {cartoes.map((c) => (
              <div className="card-item" key={c.id}>
                <div className="card-item__chip" aria-hidden="true" />
                <div className="card-item__info">
                  <strong>{c.bandeira}</strong>
                  <span>•••• •••• •••• {c.ultimos4}</span>
                  <small>{c.titular} · {c.validade}</small>
                </div>
                <button type="button" className="card-item__del" onClick={() => remover(c.id)}>
                  Remover
                </button>
              </div>
            ))}
          </div>
        )}

        {!form ? (
          <div className="usr-empty usr-empty--cards">
            {cartoes.length === 0 && (
              <>
                <p className="usr-muted">
                  Aqui você pode visualizar e gerenciar seus cartões de crédito cadastrados.
                </p>
                <p>Você ainda não adicionou nenhum cartão em sua conta.</p>
              </>
            )}
            <button type="button" className="btn btn--login usr-add" onClick={() => setForm(true)}>
              + Adicionar novo cartão
            </button>
          </div>
        ) : (
          <form className="card-form" onSubmit={salvar}>
            <label>Nome do titular (como no cartão)</label>
            <input value={titular} onChange={(e) => setTitular(e.target.value)} placeholder="NOME SOBRENOME" autoFocus />

            <label>Número do cartão</label>
            <input value={numero} onChange={(e) => setNumero(maskNumero(e.target.value))} placeholder="0000 0000 0000 0000" inputMode="numeric" />

            <div className="card-form__row">
              <div>
                <label>Validade</label>
                <input value={validade} onChange={(e) => setValidade(maskValidade(e.target.value))} placeholder="MM/AA" inputMode="numeric" />
              </div>
              <div>
                <label>CVV</label>
                <input value={cvv} onChange={(e) => setCvv(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="123" inputMode="numeric" />
              </div>
            </div>

            {erro && <p className="ck-erro">{erro}</p>}

            <div className="card-form__actions">
              <button type="button" className="usr-btn" onClick={() => { setForm(false); setErro('') }}>Cancelar</button>
              <button type="submit" className="usr-btn usr-btn--primary" disabled={busy}>
                {busy ? 'Salvando…' : 'Vincular cartão'}
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  )
}
