import { useEffect, useState } from 'react'
import { ganhadores } from '../data/content.js'
import { fetchWinners } from '../data/api.js'
import { ArrowRight } from './Icons.jsx'

export default function Ganhadores() {
  const [items, setItems] = useState(ganhadores.items)
  // live = já recebemos os ganhadores reais da API (vários sorteios recentes)
  const [live, setLive] = useState(false)

  useEffect(() => {
    let on = true
    fetchWinners(4)
      .then((data) => {
        if (on && data.items.length) {
          setItems(data.items)
          setLive(true)
        }
      })
      .catch(() => {}) // mantém o conteúdo estático como fallback
    return () => {
      on = false
    }
  }, [])

  return (
    <section className="winners" id="ganhadores">
      <div className="container">
        <div className="section-head">
          <div>
            <h2 className="section-title">{ganhadores.title}</h2>
            <p className="section-sub">
              {live ? (
                'Confira os ganhadores mais recentes dos nossos sorteios'
              ) : (
                <>
                  Confira os ganhadores do sorteio da edição{' '}
                  <strong className="winners__edition">{ganhadores.edition}</strong> de{' '}
                  <strong className="winners__date">{ganhadores.date}</strong>
                </>
              )}
            </p>
          </div>
          <button className="btn btn--ghost">
            Ver mais <ArrowRight size={18} />
          </button>
        </div>

        <div className="winners__grid">
          {items.map((g) => (
            <article className="wcard" key={g.id}>
              <div className="wcard__photo">
                <img src={g.photo} alt={g.name} referrerPolicy="no-referrer" />
              </div>
              <div className="wcard__value">{g.value}</div>
              <h3 className="wcard__name">{g.name}</h3>
              <p className="wcard__city">{g.city}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
