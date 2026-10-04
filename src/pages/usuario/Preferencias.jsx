import { useState } from 'react'
import { preferencias } from '../../data/usuario.js'

export default function Preferencias() {
  const [on, setOn] = useState(
    () => new Set([...preferencias.categorias, ...preferencias.meios])
  )
  const toggle = (k) =>
    setOn((s) => {
      const n = new Set(s)
      n.has(k) ? n.delete(k) : n.add(k)
      return n
    })

  return (
    <main className="page">
      <div className="container">
        <div className="pagehead">
          <h1>Preferências</h1>
        </div>

        <div className="usr-prefs">
          <div className="usr-prefs__col">
            <h2 className="usr-form__title">Categorias e assuntos de comunicação</h2>
            <p className="usr-muted">
              Defina sobre quais categorias de assuntos podemos entrar em contato com você.
            </p>
            {preferencias.categorias.map((c) => (
              <label className="usr-check" key={c}>
                <input type="checkbox" checked={on.has(c)} onChange={() => toggle(c)} /> {c}
              </label>
            ))}
          </div>

          <div className="usr-prefs__col">
            <h2 className="usr-form__title">Meios de comunicação</h2>
            <p className="usr-muted">
              Defina por quais meios de comunicação podemos entrar em contato com você.
            </p>
            {preferencias.meios.map((m) => (
              <label className="usr-check" key={m}>
                <input type="checkbox" checked={on.has(m)} onChange={() => toggle(m)} /> {m}
              </label>
            ))}
          </div>
        </div>

        <button type="button" className="btn btn--login usr-save-wide">Salvar</button>
      </div>
    </main>
  )
}
