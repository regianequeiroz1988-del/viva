import { useEffect } from 'react'
import { Routes, Route, Outlet, useLocation } from 'react-router-dom'
import Header from './components/Header.jsx'
import Footer from './components/Footer.jsx'
import BackToTop from './components/BackToTop.jsx'
import FloatingCart from './components/FloatingCart.jsx'
import BottomNav from './components/BottomNav.jsx'
import Toast from './components/Toast.jsx'
import RequireAuth from './components/RequireAuth.jsx'
import RequireAdmin from './components/RequireAdmin.jsx'
import Home from './pages/Home.jsx'
import Autenticar from './pages/Autenticar.jsx'
import Ganhador from './pages/Ganhador.jsx'
import Checkout from './pages/Checkout.jsx'
import Resultados from './pages/Resultados.jsx'
import Contato from './pages/Contato.jsx'
import Cadastro from './pages/Cadastro.jsx'
import JogoResponsavel from './pages/JogoResponsavel.jsx'
import Regulamento from './pages/Regulamento.jsx'
import Documento from './pages/Documento.jsx'
import Placeholder from './pages/Placeholder.jsx'
import Perfil from './pages/usuario/Perfil.jsx'
import MinhaCarteira from './pages/usuario/MinhaCarteira.jsx'
import MinhasContemplacoes from './pages/usuario/MinhasContemplacoes.jsx'
import MeusCartoes from './pages/usuario/MeusCartoes.jsx'
import MeusDados from './pages/usuario/MeusDados.jsx'
import MeusPedidos from './pages/usuario/MeusPedidos.jsx'
import MeusTitulos from './pages/usuario/MeusTitulos.jsx'
import Preferencias from './pages/usuario/Preferencias.jsx'
import ListaVazia from './pages/usuario/ListaVazia.jsx'
import AdminLayout from './pages/admin/AdminLayout.jsx'
import AdminDashboard from './pages/admin/AdminDashboard.jsx'
import AdminUsuarios from './pages/admin/AdminUsuarios.jsx'
import AdminPedidos from './pages/admin/AdminPedidos.jsx'
import AdminConfig from './pages/admin/AdminConfig.jsx'
import AdminAcessos from './pages/admin/AdminAcessos.jsx'
import AdminLigadores from './pages/admin/AdminLigadores.jsx'
import AdminResumo from './pages/admin/AdminResumo.jsx'
import AdminTransmissoes from './pages/admin/AdminTransmissoes.jsx'
import AdminNotificacoes from './pages/admin/AdminNotificacoes.jsx'
import LigadorLogin from './pages/ligador/LigadorLogin.jsx'
import LigadorPainel from './pages/ligador/LigadorPainel.jsx'
import RequireLigador from './components/RequireLigador.jsx'
import GerenteLogin from './pages/gerente/GerenteLogin.jsx'
import GerentePainel from './pages/gerente/GerentePainel.jsx'
import RequireGerente from './components/RequireGerente.jsx'
import AdminGerentes from './pages/admin/AdminGerentes.jsx'
import AgeGate from './components/AgeGate.jsx'
import { MetaPixelRouteTracker } from './lib/metapixel.js'
import { iniciarGoogleTag } from './lib/googletag.js'

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  }, [pathname])
  return null
}

export default function App() {
  const { pathname } = useLocation()
  const headerBare = pathname === '/ganhador' // /ganhador: header sem login nem menu
  // tela cheia (sem header/footer/barra-inferior do site): admin, ligador, gerente e /ganhador
  const noChrome = pathname.startsWith('/admin') || pathname.startsWith('/ligador') || pathname.startsWith('/gerente')
  const noFooter = noChrome || headerBare // /ganhador mantém só o logo, sem rodapé/barra-inferior

  useEffect(() => { iniciarGoogleTag() }, [])

  // Sem barra-inferior → remove o padding-bottom que o mobile reserva pra ela.
  useEffect(() => {
    document.body.classList.toggle('body--no-botnav', noFooter)
    return () => document.body.classList.remove('body--no-botnav')
  }, [noFooter])

  return (
    <AgeGate>
      <ScrollToTop />
      {/* Conteúdo do site — o overflow-x:clip fica AQUI (não no body), pra não
          quebrar o position:fixed da barra inferior no Safari/iOS. */}
      <div className="app-shell">
      {!noChrome && <Header bare={headerBare} />}
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/autenticar" element={<Autenticar />} />
        <Route path="/ganhador" element={<Ganhador />} />
        <Route path="/checkout" element={<Checkout />} />
        <Route path="/resultados" element={<Resultados />} />
        <Route path="/contato" element={<Contato />} />
        <Route path="/institucional/perguntas-frequentes" element={<Contato />} />
        <Route path="/seja-um-revendedor" element={<Cadastro tipo="revendedor" />} />
        <Route path="/seja-um-influenciador" element={<Cadastro tipo="influenciador" />} />
        <Route path="/institucional/jogo-responsavel" element={<JogoResponsavel />} />
        <Route path="/institucional/regulamento" element={<Regulamento />} />
        <Route path="/institucional/termos-de-uso" element={<Documento slug="termos-de-uso" />} />
        <Route path="/politica-de-privacidade" element={<Documento slug="politica-de-privacidade" />} />

        {/* Area logada do cliente */}
        <Route element={<RequireAuth><Outlet /></RequireAuth>}>
          <Route path="/usuario/perfil" element={<Perfil />} />
          <Route path="/usuario/minha-carteira" element={<MinhaCarteira />} />
          <Route path="/usuario/minhas-contemplacoes" element={<MinhasContemplacoes />} />
          <Route path="/usuario/meus-cartoes" element={<MeusCartoes />} />
          <Route path="/usuario/meus-dados" element={<MeusDados />} />
          <Route path="/usuario/preferencias" element={<Preferencias />} />
          <Route path="/usuario/meus-titulos" element={<MeusTitulos />} />
          <Route path="/usuario/meus-pedidos" element={<MeusPedidos />} />
          <Route path="/usuario/meus-resgates" element={<ListaVazia title="Meus resgates" emptyText="Nenhum resgate foi encontrado." />} />
          <Route path="/usuario/meus-saques" element={<ListaVazia title="Meus saques" emptyText="Nenhum saque foi encontrado." />} />
        </Route>

        {/* Painel administrativo */}
        <Route path="/admin" element={<RequireAdmin><AdminLayout /></RequireAdmin>}>
          <Route index element={<AdminDashboard />} />
          <Route path="pedidos" element={<AdminPedidos />} />
          <Route path="ligadores" element={<AdminLigadores />} />
          <Route path="gerentes" element={<AdminGerentes />} />
          <Route path="resumo" element={<AdminResumo />} />
          <Route path="transmissoes" element={<AdminTransmissoes />} />
          <Route path="notificacoes" element={<AdminNotificacoes />} />
          <Route path="usuarios" element={<AdminUsuarios />} />
          <Route path="acessos" element={<AdminAcessos />} />
          <Route path="config" element={<AdminConfig />} />
        </Route>

        {/* Área do ligador (call center) — login próprio usuário+senha */}
        <Route path="/ligador/entrar" element={<LigadorLogin />} />
        <Route path="/ligador" element={<RequireLigador><LigadorPainel /></RequireLigador>} />
        <Route path="/gerente/entrar" element={<GerenteLogin />} />
        <Route path="/gerente" element={<RequireGerente><GerentePainel /></RequireGerente>} />

        <Route path="*" element={<Placeholder />} />
      </Routes>
      {!noFooter && <Footer />}
      </div>
      {/* Fixos/flutuantes FORA do app-shell — assim o position:fixed funciona
          certinho no iOS (o overflow do shell não os afeta) */}
      {!noFooter && (
        <>
          <BackToTop />
          <FloatingCart />
          <Toast />
          <BottomNav />
        </>
      )}
      {/* Meta Pixel: PageView nas trocas de rota (SPA). Inerte sem ID configurado. */}
      <MetaPixelRouteTracker />
    </AgeGate>
  )
}
