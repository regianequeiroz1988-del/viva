import Hero from '../components/Hero.jsx'
import Sorteios from '../components/Sorteios.jsx'
import AdBanners from '../components/AdBanners.jsx'
import Ganhadores from '../components/Ganhadores.jsx'
import Parceiros from '../components/Parceiros.jsx'
import Instituicao from '../components/Instituicao.jsx'

export default function Home() {
  return (
    <main id="inicio">
      <Hero />
      <Sorteios />
      <AdBanners />
      <Ganhadores />
      <Parceiros />
      <Instituicao />
    </main>
  )
}
