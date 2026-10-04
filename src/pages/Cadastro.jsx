import { useState } from 'react'
import { cadastro } from '../data/paginas.js'
import { maskTelefone, maskCpfCnpj, maskCep } from '../utils/masks.js'

// Máscara automática por nome do campo
const MASKS = { celular: maskTelefone, telefone: maskTelefone, documento: maskCpfCnpj, cep: maskCep }
const numericos = new Set(['celular', 'telefone', 'documento', 'cep'])

export default function Cadastro({ tipo }) {
  const cfg = cadastro[tipo]
  const [form, setForm] = useState({})
  const set = (name, v) => {
    const fn = MASKS[name]
    setForm((f) => ({ ...f, [name]: fn ? fn(v) : v }))
  }

  return (
    <main className="cad">
      <div className="container">
        <div className="cad__card">
          <h1 className="cad__title">{cfg.title}</h1>
          <div className="cad__intro">
            {cfg.intro.map((l, i) => (
              <p key={i}>{l}</p>
            ))}
          </div>

          <form className="cad__form" onSubmit={(e) => e.preventDefault()}>
            {cfg.campos.map((f) => (
              <div className="cad__field" key={f.name}>
                <label>
                  {f.label} {f.required && <span className="cad__req">*</span>}
                </label>
                {f.type === 'select' ? (
                  <select
                    value={form[f.name] || ''}
                    onChange={(e) => set(f.name, e.target.value)}
                  >
                    <option value="" disabled>
                      {f.placeholder}
                    </option>
                    {f.options.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={f.type}
                    inputMode={numericos.has(f.name) ? 'numeric' : undefined}
                    placeholder={f.placeholder}
                    value={form[f.name] || ''}
                    onChange={(e) => set(f.name, e.target.value)}
                  />
                )}
                {f.hint && <span className="cad__hint">{f.hint}</span>}
              </div>
            ))}

            <p className="cad__termo">{cadastro.termo}</p>
            <button type="submit" className="btn btn--buy cad__btn">
              {cfg.cta}
            </button>
            <p className="cad__secure">{cadastro.secure}</p>
          </form>
        </div>
      </div>
    </main>
  )
}
