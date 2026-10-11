import { useEffect, useMemo, useRef, useState } from 'react'
import { buscarBancos } from '../data/bancos.js'

// Campo que abre pra baixo com a lista de bancos. Mostra nome e código (sem logo).
// Busca por nome, código COMPE ou ISPB.
export default function BancoPicker({ valor, onChange, id }) {
  const [aberto, setAberto] = useState(false)
  const [busca, setBusca] = useState('')
  const raiz = useRef(null)

  const lista = useMemo(() => buscarBancos(busca), [busca])
  const atual = valor ? { nome: valor.nome, codigo: valor.codigo } : null

  // Ao abrir, traz o campo pro meio da tela: a lista não fica cortada na borda.
  useEffect(() => {
    if (!aberto) return
    const id = setTimeout(() => raiz.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 30)
    return () => clearTimeout(id)
  }, [aberto])

  useEffect(() => {
    if (!aberto) return
    const fechar = (e) => { if (raiz.current && !raiz.current.contains(e.target)) setAberto(false) }
    document.addEventListener('mousedown', fechar)
    document.addEventListener('touchstart', fechar)
    return () => {
      document.removeEventListener('mousedown', fechar)
      document.removeEventListener('touchstart', fechar)
    }
  }, [aberto])

  return (
    <div className="decl-banco" ref={raiz}>
      <button
        type="button"
        id={id}
        className={`decl-banco__campo ${aberto ? 'is-aberto' : ''}`}
        onClick={() => setAberto((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={aberto}
      >
        <span className="decl-banco__nome">{atual ? atual.nome : 'Escolha o banco'}</span>
        {atual && <span className="decl-banco__cod">{atual.codigo}</span>}
        <span className="decl-banco__seta" aria-hidden="true">▾</span>
      </button>

      {aberto && (
        <div className="decl-banco__lista" role="listbox">
          <input
            className="decl-banco__busca"
            placeholder="Buscar por nome ou código"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            autoFocus
            inputMode="search"
          />
          <div className="decl-banco__scroll">
            {lista.length === 0 && <p className="decl-banco__vazio">Nenhum banco encontrado.</p>}
            {lista.map((b) => (
              <button
                type="button"
                key={b.codigo + b.nome}
                role="option"
                aria-selected={atual?.codigo === b.codigo}
                className={`decl-banco__item ${atual?.codigo === b.codigo ? 'is-on' : ''}`}
                onClick={() => { onChange(b); setAberto(false); setBusca('') }}
              >
                <span className="decl-banco__item-nome">{b.nome}</span>
                <span className="decl-banco__cod">{b.codigo}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
