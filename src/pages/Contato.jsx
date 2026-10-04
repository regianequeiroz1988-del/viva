import { contato } from '../data/paginas.js'
import { Whatsapp } from '../components/Icons.jsx'

export default function Contato() {
  return (
    <main className="page page--center">
      <div className="container contato">
        <h1 className="contato__title">{contato.title}</h1>
        <p className="contato__sub">{contato.sub}</p>

        <div className="contato__row">
          <div className="contato__info">
            <span className="contato__icon">
              <Whatsapp size={26} />
            </span>
            <div className="contato__txt">
              <strong>{contato.canal}</strong>
              <span>{contato.canalDesc}</span>
            </div>
          </div>
          <a
            className="btn contato__cta"
            href={contato.href}
            target="_blank"
            rel="noreferrer"
          >
            <Whatsapp size={18} /> {contato.cta}
          </a>
        </div>
      </div>
    </main>
  )
}
