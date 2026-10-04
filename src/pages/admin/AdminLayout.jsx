import { useEffect, useState } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext.jsx'
import { supabase } from '../../lib/supabase.js'
import { Grid, Receipt, UserIcon, Gear, Logout, ExternalLink, MapPin, Phone, TrendingUp, Monitor, Bell } from '../../components/Icons.jsx'

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

      <main className="adm__main">
        <Outlet />
      </main>
    </div>
  )
}
