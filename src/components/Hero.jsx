import { useEffect, useRef, useState } from 'react'
import { hero } from '../data/content.js'
import { fetchActiveRaffles, mainRaffleToCard } from '../data/api.js'
import { useCart } from '../context/CartContext.jsx'
import { formatBRL } from '../utils/format.js'
import { ArrowLeft, ArrowRight, Plus, Minus, CartIcon } from './Icons.jsx'
import { getConfig, CONFIG_KEYS } from '../lib/config.js'

export default function Hero() {
  const { slides } = hero
  const { addToCart } = useCart()
  const [card, setCard] = useState(hero.card)
  const [active, setActive] = useState(0)
  const [qty, setQty] = useState(hero.card.defaultQty)
  const [bannerUrl, setBannerUrl] = useState('')
  // Enquanto não carregam os dados ao vivo, mostramos um "carregando" suave em
  // vez dos dados estáticos (que ficavam piscando, ex.: 07/06 → 14/06).
  const [loaded, setLoaded] = useState(false)
  const timer = useRef(null)

  // Banner personalizado carregado dinamicamente ou slides padrão como fallback
  const activeSlides = bannerUrl
    ? [{ id: 'slide-custom', label: card.title || 'Banner Principal', image: bannerUrl }]
    : slides

  // Puxa o sorteio principal ao vivo (data, título e preço sempre atualizados)
  useEffect(() => {
    let on = true

    // Carrega o banner customizado do banco de dados
    getConfig(CONFIG_KEYS.heroBannerUrl)
      .then((url) => {
        if (on && url) setBannerUrl(url)
      })
      .catch(() => {})

    fetchActiveRaffles()
      .then((rs) => {
        // Atualiza título/data/preço ao vivo. A IMAGEM do banner fica sempre a
        // local (slides[].image) — o banner principal usa s.image no <img>, não
        // a imagem remota do CDN (que falhava ao carregar no site publicado).
        const live = mainRaffleToCard(rs)
        if (on && live) setCard((c) => ({ ...c, ...live }))
      })
      .catch(() => {})
      .finally(() => {
        if (on) setLoaded(true)
      })
    return () => {
      on = false
    }
  }, [])

  // Auto-rotacao do carrossel
  useEffect(() => {
    timer.current = setInterval(
      () => setActive((i) => (i + 1) % activeSlides.length),
      4500
    )
    return () => clearInterval(timer.current)
  }, [activeSlides.length])

  const go = (dir) => {
    setActive((i) => (i + dir + activeSlides.length) % activeSlides.length)
  }

  const total = qty * card.unitPrice

  const buy = () =>
    addToCart(
      {
        id: 'hero-' + active,
        title: card.title,
        price: card.unitPrice,
        image: activeSlides[active]?.image,
        date: card.weekday,
        edition: card.edition,
        excerpt: card.excerpt,
        kind: card.kind || 'MAIN',
      },
      qty
    )

  return (
    <section className="hero">
      <div className="container hero__grid">
        {/* Carrossel de banner */}
        <div className="hero__carousel">
          <div className="hero__track" style={{ transform: `translateX(-${active * 100}%)` }}>
            {activeSlides.map((s) => (
              <div className="hero__slide" key={s.id}>
                <img
                  className="hero__img"
                  src={s.image}
                  alt={s.label}
                  referrerPolicy="no-referrer"
                />
              </div>
            ))}
          </div>

          {activeSlides.length > 1 && (
            <>
              <button className="hero__arrow hero__arrow--left" onClick={() => go(-1)} aria-label="Anterior">
                <ArrowLeft size={22} />
              </button>
              <button className="hero__arrow hero__arrow--right" onClick={() => go(1)} aria-label="Próximo">
                <ArrowRight size={22} />
              </button>

              <div className="hero__dots">
                {activeSlides.map((s, i) => (
                  <button
                    key={s.id}
                    className={`hero__dot ${i === active ? 'is-active' : ''}`}
                    onClick={() => setActive(i)}
                    aria-label={`Ir para o banner ${i + 1}`}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {/* Painel de compra */}
        <aside className="hero__buy">
          {loaded ? (
            <>
              <h1 className="hero__title">{card.title}</h1>
              <p className="hero__date">{card.weekday}</p>
            </>
          ) : (
            <>
              <span className="skel hero__skel hero__skel--title" />
              <span className="skel hero__skel hero__skel--date" />
            </>
          )}
          <p className="hero__desc">{card.description}</p>

          <div className="hero__total">
            <div>
              <span className="hero__total-label">TOTAL</span>
              {loaded ? (
                <strong className="hero__total-value">{formatBRL(total)}</strong>
              ) : (
                <span className="skel hero__skel hero__skel--total" />
              )}
            </div>

            <div className="stepper">
              <button onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Diminuir">
                <Minus size={18} />
              </button>
              <span>{qty}</span>
              <button onClick={() => setQty((q) => q + 1)} aria-label="Aumentar">
                <Plus size={18} />
              </button>
            </div>
          </div>

          <button className="btn btn--buy hero__buy-btn" onClick={buy}>
            <CartIcon size={20} />
            Comprar
          </button>
        </aside>
      </div>
    </section>
  )
}
