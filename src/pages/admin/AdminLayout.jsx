import { useEffect, useState } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext.jsx'
import { supabase } from '../../lib/supabase.js'
import { Grid, Receipt, UserIcon, Gear, Logout, ExternalLink, MapPin, Phone, TrendingUp, Monitor, Bell, Menu } from '../../components/Icons.jsx'
import { useTravaScroll, useVoltarFecha } from '../../lib/useTravaScroll.js'

const itens = [
  { to: '/admin', label: 'Visão geral', icon: Grid, end: true },
  { to: '/admin/notificacoes', label: 'Notificações', icon: Bell, badge: true },
  { to: '/admin/pedidos', label: 'Pedidos', icon: Receipt },
  { to: '/admin/ligadores', label: 'Ligadores', icon: Phone },
  { to: '/admin/gerentes', label: 'Gerentes', icon: UserIcon },
  { to: '/admin/transmissoes', label: 'Transmissões', icon: Monitor },
  { to: '/admin/resumo', label: 'Acompanhar Resumo', icon: TrendingUp },
  { to: '/admin/usuarios', label: 'Usuários', icon: UserIcon },
  { to: '/admin/acessos', label: 'Acessos', icon: MapPin },
  { to: '/admin/config', label: 'Configurações', icon: Gear },
]

// Atalhos da barra de baixo no celular; o resto fica no "Mais".
const PRINCIPAIS = ['/admin', '/admin/pedidos', '/admin/notificacoes', '/admin/ligadores']

export default function AdminLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const inicial = (user?.name || 'A').trim().charAt(0).toUpperCase()
  // Ativo: '/admin' só exato; os demais por prefixo. (Botão + navigate em vez de
  // <a>, pra evitar que handlers globais de clique em <a> bloqueiem a navegação.)
  const ativo = (to, end) => (end ? pathname === to : pathname === to || pathname.startsWith(to + '/'))

  // Contador de pedidos de fichas pendentes (aparece em qualquer tela do admin).
  const [notif, setNotif] = useState(0)
  useEffect(() => {
    const conta = ({ data }) => (Array.isArray(data) ? data.length : 0)
    const ler = () => Promise.all([supabase.rpc('listar_solicitacoes_fichas'), supabase.rpc('listar_solicitacoes_gerente')])
      .then(([lig, ger]) => setNotif(conta(lig) + conta(ger)))
    ler()
    const t = setInterval(ler, 15000)
    return () => clearInterval(t)
  }, [pathname])

  const [maisAberto, setMaisAberto] = useState(false)
  useEffect(() => setMaisAberto(false), [pathname])
  useTravaScroll(maisAberto)
  useVoltarFecha(maisAberto, () => setMaisAberto(false))
  const atual = itens.find((i) => ativo(i.to, i.end))
  const maisAtivo = !!atual && !PRINCIPAIS.includes(atual.to)
  // Com o "Mais" aberto, substitui a entrada extra do histórico (a do overlay).
  const ir = (to) => { navigate(to, { replace: maisAberto }); setMaisAberto(false) }

  return (
    <div className="adm">
      <aside className="adm__side">
        <div className="adm__brand">
          <span className="adm__brand-mark">VS</span>
          <span className="adm__brand-txt">
            Viva Sorte<span className="adm__brand-plus">+</span>
            <small>Painel administrativo</small>
          </span>
        </div>

        <nav className="adm__nav">
          <span className="adm__nav-label">Geral</span>
          {itens.map((i) => {
            const Icon = i.icon
            return (
              <button
                key={i.to}
                type="button"
                className={`adm__link ${ativo(i.to, i.end) ? 'is-active' : ''}`}
                onClick={() => navigate(i.to)}
              >
                <Icon size={18} />
                <span>{i.label}</span>
                {i.badge && notif > 0 && <span className="adm__link-badge">{notif}</span>}
              </button>
            )
          })}
        </nav>

        <div className="adm__foot">
          <div className="adm__user">
            <span className="adm__avatar">{inicial}</span>
            <span className="adm__user-info">
              <strong>{user?.name || 'Administrador'}</strong>
              <small>Administrador</small>
            </span>
          </div>
          <button type="button" className="adm__back" onClick={() => navigate('/')}><ExternalLink size={15} /> <span>Ver site</span></button>
          <button type="button" className="adm__logout" onClick={logout}><Logout size={15} /> <span>Sair</span></button>
        </div>
      </aside>

      <header className="adm__appbar">
        <span className="adm__brand-mark">VS</span>
        <h1 className="adm__appbar-tit">{atual?.label || 'Painel'}</h1>
      </header>

      <nav className="adm__tabbar" aria-label="Navegação">
        {itens.filter((i) => PRINCIPAIS.includes(i.to)).map((i) => {
          const Icon = i.icon
          return (
            <button key={i.to} type="button" className={ativo(i.to, i.end) && !maisAberto ? 'is-active' : ''} onClick={() => ir(i.to)}>
              <span className="adm__tabbar-ic"><Icon size={22} />{i.badge && notif > 0 && <em>{notif}</em>}</span>
              <span>{i.to === '/admin' ? 'Início' : i.label}</span>
            </button>
          )
        })}
        <button type="button" className={maisAtivo || maisAberto ? 'is-active' : ''} onClick={() => setMaisAberto((v) => !v)} aria-expanded={maisAberto}>
          <span className="adm__tabbar-ic"><Menu size={22} /></span>
          <span>Mais</span>
        </button>
      </nav>

      {maisAberto && (
        <div className="adm__sheet-fundo" onClick={() => setMaisAberto(false)}>
          <div className="adm__sheet" role="dialog" aria-label="Menu" onClick={(e) => e.stopPropagation()}>
            <span className="adm__sheet-alca" />
            {itens.map((i) => {
              const Icon = i.icon
              return (
                <button key={i.to} type="button" className={`adm__sheet-item ${ativo(i.to, i.end) ? 'is-active' : ''}`} onClick={() => ir(i.to)}>
                  <Icon size={20} /><span>{i.label}</span>
                  {i.badge && notif > 0 && <em className="adm__link-badge">{notif}</em>}
                </button>
              )
            })}
            <hr />
            <button type="button" className="adm__sheet-item" onClick={() => ir('/')}><ExternalLink size={20} /><span>Ver site</span></button>
            <button type="button" className="adm__sheet-item is-perigo" onClick={logout}><Logout size={20} /><span>Sair</span></button>
          </div>
        </div>
      )}

      <main className="adm__main">
        <Outlet />
      </main>
    </div>
  )
}
