import { brand, footer } from '../data/content.js'
import { social } from './Icons.jsx'

export default function Footer() {
  return (
    <footer className="ft" id="footer">
      <div className="container">
        {/* Marca + redes */}
        <div className="ft__brand">
          <a href="#inicio" className="hd__logo ft__logo">
            <img
              className="hd__logo-img"
              src={brand.logo}
              alt={`${brand.name}${brand.plus}`}
            />
          </a>
          <div className="ft__social">
            {footer.social.map((s) => {
              const Ico = social[s.id]
              return (
                <a key={s.id} href={s.href} aria-label={s.label} className="ft__social-link">
                  {Ico ? <Ico size={18} /> : s.label}
                </a>
              )
            })}
          </div>
        </div>

        <p className="ft__legal">{footer.legal}</p>

        {/* Creditos + selos */}
        <div className="ft__mid">
          <div className="ft__credits">
            {footer.credits.map((c) => (
              <div className="ft__credit" key={c.id}>
                <span>{c.label}</span>
                {c.logo ? (
                  <div className="ft__credit-logo">
                    <img src={c.logo} alt={c.name} />
                  </div>
                ) : (
                  <div className="ft__credit-name">{c.name}</div>
                )}
              </div>
            ))}
          </div>

          {footer.seals?.length > 0 && (
            <div className="ft__seals">
              {footer.seals.map((s) => (
                <div className="ft__seal" key={s.id}>
                  <img src={s.image} alt={s.label} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Links + contatos */}
        <nav className="ft__links" aria-label="Links do rodapé">
          {footer.links.map((l) => (
            <a key={l.label} href={l.href}>
              {l.label}
            </a>
          ))}
          <span className="ft__contact">{footer.sac}</span>
          <span className="ft__contact">{footer.ouvidoria}</span>
        </nav>

        <div className="ft__bottom">
          <span>{footer.company}</span>
        </div>
      </div>
    </footer>
  )
}
