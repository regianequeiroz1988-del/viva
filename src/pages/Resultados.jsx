import { resultadosCategorias } from '../data/paginas.js'
import { ChevronRight } from '../components/Icons.jsx'

export default function Resultados() {
  return (
    <main className="page">
      <div className="container">
        <div className="pagehead">
          <h1>Resultados</h1>
        </div>
        <p className="page__lead">
          Selecione uma categoria abaixo para visualizar os resultados dos sorteios.
        </p>

        <div className="reslist">
          {resultadosCategorias.map((c) => (
            <button className="rescat" key={c.id} type="button">
              <span className="rescat__icon">
                {c.img ? (
                  <img src={c.img} alt="" />
                ) : (
                  <span
                    className="rescat__badge"
                    style={{ background: c.badge.color, color: c.badge.fg }}
                  >
                    {c.badge.text}
                  </span>
                )}
              </span>
              <span className="rescat__txt">
                <strong>{c.title}</strong>
                <span>{c.subtitle}</span>
              </span>
              <ChevronRight size={20} />
            </button>
          ))}
        </div>
      </div>
    </main>
  )
}
