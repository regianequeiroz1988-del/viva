import { instituicao } from '../data/content.js'

export default function Instituicao() {
  return (
    <section className="inst">
      <div className="container inst__box">
        <h2 className="section-title">{instituicao.title}</h2>
        <div className="inst__logo">
          {instituicao.logo ? (
            <img src={instituicao.logo} alt={instituicao.logoLabel} />
          ) : (
            instituicao.logoLabel
          )}
        </div>
      </div>
    </section>
  )
}
