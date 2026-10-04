import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { useCart } from '../context/CartContext.jsx'
import { Home, Trophy, Wallet, UserIcon, CartIcon } from './Icons.jsx'

// Barra de navegação inferior — estilo aplicativo (só aparece no mobile via CSS).
export default function BottomNav() {
  const { isAuthed } = useAuth()
  const { count } = useCart()
  const { pathname } = useLocation()
  const navigate = useNavigate()

  const itens = isAuthed
    ? [
        { to: '/', label: 'Início', Icon: Home, match: (p) => p === '/' },
        { to: '/resultados', label: 'Resultados', Icon: Trophy, match: (p) => p.startsWith('/resultados') },
        { to: '/checkout', label: 'Carrinho', Icon: CartIcon, match: (p) => p.startsWith('/checkout'), badge: count },
        { to: '/usuario/minha-carteira', label: 'Carteira', Icon: Wallet, match: (p) => p.startsWith('/usuario/minha-carteira') },
        { to: '/usuario/perfil', label: 'Conta', Icon: UserIcon, match: (p) => p.startsWith('/usuario') && !p.startsWith('/usuario/minha-carteira') },
      ]
    : [
        { to: '/', label: 'Início', Icon: Home, match: (p) => p === '/' },
        { to: '/resultados', label: 'Resultados', Icon: Trophy, match: (p) => p.startsWith('/resultados') },
        { to: '/checkout', label: 'Carrinho', Icon: CartIcon, match: (p) => p.startsWith('/checkout'), badge: count },
        { to: '/autenticar', label: 'Entrar', Icon: UserIcon, match: (p) => p.startsWith('/autenticar') },
      ]

  return (
    <nav className="botnav" aria-label="Navegação rápida">
      {itens.map(({ to, label, Icon, match, badge }) => {
        const active = match(pathname)
        const cls = `botnav__item ${active ? 'is-active' : ''}`
        const conteudo = (
          <>
            <span className="botnav__ico">
              <Icon size={23} />
              {badge > 0 && <span className="botnav__badge">{badge > 9 ? '9+' : badge}</span>}
            </span>
            <span className="botnav__label">{label}</span>
          </>
        )
        // /checkout vai por <button> + navigate(): a UTMify intercepta <a href="/checkout">
        // na fase de captura e o react-router nunca recebia o clique.
        return to === '/checkout' ? (
          <button key={to} type="button" className={cls} onClick={() => navigate('/checkout')}>
            {conteudo}
          </button>
        ) : (
          <Link key={to} to={to} className={cls}>
            {conteudo}
          </Link>
        )
      })}
    </nav>
  )
}
