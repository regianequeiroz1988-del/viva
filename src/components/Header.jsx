import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { brand, nav } from '../data/content.js'
import { usuarioMenu } from '../data/usuario.js'
import { useAuth } from '../context/AuthContext.jsx'
import { getConfig, CONFIG_KEYS } from '../lib/config.js'
import { UserIcon, ChevronDown, Menu, Close } from './Icons.jsx'

// Link interno (router) ou externo (<a>) conforme a href
function NavA({ href, className, onClick, children }) {
  const external = /^https?:\/\//.test(href)
  if (external) {
    return (
      <a href={href} className={className} target="_blank" rel="noreferrer" onClick={onClick}>
        {children}
      </a>
    )
  }
  return (
    <NavLink
      to={href}
      end={href === '/'}
      className={({ isActive }) => `${className}${isActive ? ' is-active' : ''}`}
      onClick={onClick}
    >
      {children}
    </NavLink>
  )
}

export default function Header({ bare = false }) {
  const { user, logout } = useAuth()
  const { pathname } = useLocation()
  const [scrolled, setScrolled] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [openSub, setOpenSub] = useState(null) // submenu aberto no mobile
  // Logo no topo: liga/desliga só na PÁGINA INICIAL (/admin → Configurações).
  // Padrão ligado (fail-open) — evita "piscar" sem logo enquanto a config carrega.
  const [logoAtivo, setLogoAtivo] = useState(true)
  useEffect(() => {
    getConfig(CONFIG_KEYS.logoHomeAtivo).then((v) => setLogoAtivo(v !== 'false'))
  }, [])
  const mostrarLogo = pathname !== '/' || logoAtivo

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [mobileOpen])

  const closeMobile = () => {
    setMobileOpen(false)
    setOpenSub(null)
  }

  // Quando logado, injeta o menu "Usuário" antes de "Contato"
  const navItems = (() => {
    if (!user) return nav
    const usuarioItem = {
      label: 'Usuário',
      children: [...usuarioMenu, { label: 'Sair', action: 'logout' }],
    }
    const arr = [...nav]
    const idx = arr.findIndex((n) => n.label === 'Contato')
    arr.splice(idx >= 0 ? idx : arr.length, 0, usuarioItem)
    return arr
  })()

  const renderDropItem = (c, className) =>
    c.action === 'logout' ? (
      <button
        key={c.label}
        type="button"
        className={className}
        onClick={() => {
          logout()
          closeMobile()
        }}
      >
        {c.label}
      </button>
    ) : (
      <NavA key={c.label} href={c.href} className={className} onClick={closeMobile}>
        {c.label}
      </NavA>
    )

  return (
    <header className={`hd ${scrolled ? 'hd--scrolled' : ''}`}>
      <div className="container hd__inner">
        {bare ? (
          // /ganhador: logo apenas como marca, NÃO leva a lugar nenhum
          <span className="hd__logo hd__logo--static">
            {mostrarLogo && <img className="hd__logo-img" src={brand.logo} alt={`${brand.name}${brand.plus}`} />}
          </span>
        ) : (
          <Link to="/" className="hd__logo" onClick={closeMobile}>
            {mostrarLogo && <img className="hd__logo-img" src={brand.logo} alt={`${brand.name}${brand.plus}`} />}
          </Link>
        )}

        {/* Navegacao desktop (oculta em paginas "bare") */}
        {!bare && (
        <nav className="hd__nav" aria-label="Menu principal">
          {navItems.map((item) =>
            item.children ? (
              <div className="hd__dd" key={item.label}>
                <button className="hd__link hd__dd-btn" type="button">
                  {item.label}
                  <ChevronDown size={16} />
                </button>
                <div className="hd__dd-menu">
                  {item.children.map((c) => renderDropItem(c, 'hd__dd-item'))}
                </div>
              </div>
            ) : (
              <NavA key={item.label} href={item.href} className="hd__link">
                {item.label}
              </NavA>
            )
          )}
        </nav>
        )}

        {/* Acoes a direita (ocultas em paginas "bare", ex.: /ganhador) */}
        {!bare && (
        <div className="hd__actions">
          {user ? (
            <Link to="/usuario/perfil" className="btn btn--login hd__login" onClick={closeMobile}>
              <UserIcon size={18} />
              <span>
                {user.nomeExibicao ? <>Olá, <strong>{user.nomeExibicao.split(' ')[0]}</strong></> : <strong>Minha conta</strong>}
              </span>
            </Link>
          ) : (
            <Link to="/autenticar" className="btn btn--login hd__login" onClick={closeMobile}>
              <UserIcon size={18} />
              <span>
                entre ou <strong>cadastre-se</strong>
              </span>
            </Link>
          )}

          <button
            className="hd__burger"
            type="button"
            aria-label="Abrir menu"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((v) => !v)}
          >
            {mobileOpen ? <Close size={26} /> : <Menu size={26} />}
          </button>
        </div>
        )}
      </div>

      {/* Menu mobile */}
      {!bare && (
      <div className={`hd__mobile ${mobileOpen ? 'is-open' : ''}`}>
        <nav className="hd__mobile-nav" aria-label="Menu mobile">
          {navItems.map((item) =>
            item.children ? (
              <div className="hd__mobile-group" key={item.label}>
                <button
                  type="button"
                  className="hd__mobile-link hd__mobile-acc"
                  onClick={() => setOpenSub((s) => (s === item.label ? null : item.label))}
                  aria-expanded={openSub === item.label}
                >
                  {item.label}
                  <ChevronDown size={18} />
                </button>
                <div className={`hd__mobile-sub ${openSub === item.label ? 'is-open' : ''}`}>
                  {item.children.map((c) => renderDropItem(c, 'hd__mobile-sublink'))}
                </div>
              </div>
            ) : (
              <NavA key={item.label} href={item.href} className="hd__mobile-link" onClick={closeMobile}>
                {item.label}
              </NavA>
            )
          )}

          {user ? (
            <Link to="/usuario/perfil" className="btn btn--login hd__mobile-login" onClick={closeMobile}>
              <UserIcon size={18} />
              <span>
                {user.nomeExibicao ? <>Olá, <strong>{user.nomeExibicao.split(' ')[0]}</strong></> : <strong>Minha conta</strong>}
              </span>
            </Link>
          ) : (
            <Link to="/autenticar" className="btn btn--login hd__mobile-login" onClick={closeMobile}>
              <UserIcon size={18} />
              <span>
                entre ou <strong>cadastre-se</strong>
              </span>
            </Link>
          )}
        </nav>
      </div>
      )}
      {!bare && mobileOpen && <div className="hd__overlay" onClick={closeMobile} />}
    </header>
  )
}
