import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext.jsx'
import { usuarioMenu } from '../../data/usuario.js'
import { UserIcon, ChevronRight } from '../../components/Icons.jsx'

export default function Perfil() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const sair = () => {
    logout()
    navigate('/')
  }
  return (
    <main className="page">
      <div className="container">
        <div className="usr-hero">
          <div className="usr-hero__id">
            <span className="usr-hero__avatar">
              <UserIcon size={32} />
            </span>
            <strong>Olá{user?.nomeExibicao ? `, ${user.nomeExibicao}` : ''}!</strong>
          </div>
          <div className="usr-hero__pts">
            <span>Seus pontos</span>
            <strong>{user?.points ?? 0} pts.</strong>
            <small>Total de pontos ganhos</small>
          </div>
        </div>

        <div className="usr-menu">
          {usuarioMenu
            .filter((i) => i.href !== '/usuario/perfil')
            .map((i) => (
              <Link key={i.href} to={i.href} className="usr-menu__item">
                <span>{i.label}</span>
                <ChevronRight size={18} />
              </Link>
            ))}

          {/* Sair fica sempre por último */}
          <button type="button" className="usr-menu__item usr-menu__item--sair" onClick={sair}>
            <span>Sair</span>
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
    </main>
  )
}
