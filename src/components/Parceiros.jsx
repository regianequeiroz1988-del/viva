import { parceiros } from '../data/content.js'
import { ArrowRight } from './Icons.jsx'

export default function Parceiros() {
  return (
    <section className="partners" id="parceiros">
      <div className="container">
        <div className="partners__banner">
          <div className="partners__head">
            <h2 className="partners__title">{parceiros.title}</h2>
            <a className="partners__more" href="#parceiros">
              {parceiros.cta} <ArrowRight size={16} />
            </a>
          </div>

          <div className="partners__row">
            {parceiros.items.map((p) => (
              <div className="pchip" key={p.id}>
                <div className="pchip__logo">
                  <img src={p.logo} alt={p.name} />
                </div>
                <span className="pchip__tag">{p.tag}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
