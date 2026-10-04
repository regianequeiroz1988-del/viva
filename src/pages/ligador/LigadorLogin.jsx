import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { loginLigador, getLigador } from '../../lib/ligador.js'

export default function LigadorLogin() {
  const navigate = useNavigate()
  const [usuario, setUsuario] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (getLigador()?.token) navigate('/ligador', { replace: true })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const entrar = async (e) => {
    e.preventDefault()
    setErro('')
    setBusy(true)
    const r = await loginLigador(usuario, senha)
    setBusy(false)
    if (r.ok) navigate('/ligador', { replace: true })
    else setErro(r.error || 'Não foi possível entrar.')
  }

  return (
    <main className="lig-login">
      <form className="lig-login__card" onSubmit={entrar}>
        <span className="lig-login__mark">VIVA SORTE+</span>
        <h1 className="lig-login__title">Área do Ligador</h1>
        <p className="lig-login__sub">Entre com seu usuário e senha.</p>

        <label className="lig-login__label">Usuário</label>
        <input
          className="lig-login__input"
          value={usuario}
          onChange={(e) => setUsuario(e.target.value)}
          autoFocus
          autoComplete="username"
        />

        <label className="lig-login__label">Senha</label>
        <input
          className="lig-login__input"
          type="password"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          autoComplete="current-password"
        />

        {erro && <p className="auth__erro">{erro}</p>}

        <button className="lig-login__btn" disabled={busy || !usuario || !senha}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </main>
  )
}
