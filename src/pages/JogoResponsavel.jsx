import { jogoResponsavel as j } from '../data/paginas.js'

export default function JogoResponsavel() {
  return (
    <main className="page">
      <div className="container">
        <div className="pagehead">
          <h1>{j.title}</h1>
        </div>

        <p className="page__p">{j.intro}</p>

        <h2 className="page__h2">{j.sectionTitle}</h2>
        <p className="page__p">{j.sectionText}</p>

        <div className="jr__dicas">
          {j.dicas.map((d, i) => (
            <div className="jr__dica" key={i}>
              <span className="jr__emoji">{d.emoji}</span>
              <div className="jr__dica-txt">
                <strong>{d.title}</strong>
                <span>{d.text}</span>
              </div>
            </div>
          ))}
        </div>

        <h2 className="page__h2">{j.maisInfoTitle}</h2>
        <ul className="jr__links">
          {j.maisInfo.map((m, i) => (
            <li key={i}>
              {m.text} —{' '}
              <a href={m.href} target="_blank" rel="noreferrer">
                {m.href}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </main>
  )
}
