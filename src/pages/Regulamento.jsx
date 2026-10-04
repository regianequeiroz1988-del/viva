import { regulamentoItens } from '../data/paginas.js'
import { ChevronRight } from '../components/Icons.jsx'

export default function Regulamento() {
  return (
    <main className="page">
      <div className="container">
        <div className="pagehead">
          <h1>Regulamento</h1>
        </div>

        <div className="reglist">
          {regulamentoItens.map((r, i) => (
            <button className="regitem" key={i} type="button">
              <span>{r}</span>
              <ChevronRight size={18} />
            </button>
          ))}
        </div>
      </div>
    </main>
  )
}
