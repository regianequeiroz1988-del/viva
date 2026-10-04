import { Link, useLocation } from 'react-router-dom'

export default function Placeholder() {
  const { pathname } = useLocation()
  return (
    <main className="ph-page">
      <div className="container ph-page__box">
        <h1>Página em construção</h1>
        <p>
          A seção <code>{pathname}</code> ainda será desenvolvida nesta versão do site.
        </p>
        <Link to="/" className="btn btn--login">Voltar ao início</Link>
      </div>
    </main>
  )
}
