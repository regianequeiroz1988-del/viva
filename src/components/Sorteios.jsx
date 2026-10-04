import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { sorteios } from '../data/content.js'
import { fetchActiveRaffles, rafflesToGroups } from '../data/api.js'
import { useCart } from '../context/CartContext.jsx'
import { formatBRL } from '../utils/format.js'
import { Plus, Minus, CartIcon, Clock, Check } from './Icons.jsx'

function SorteioCard({ item }) {
  const { addToCart, items } = useCart()
  const navigate = useNavigate()
  const [qty, setQty] = useState(item.defaultQty || 1)
  const inCart = items.find((i) => i.id === item.id)

  return (
    <article className="scard">
      <div className="scard__media">
        <img className="scard__img" src={item.image} alt={item.title} referrerPolicy="no-referrer" />
      </div>

      <div className="scard__body">
        <div className="scard__pills">
          <span className="scard__pill">
            <span className="scard__pill-k">Edição nº</span>
            <span className="scard__pill-v">{item.edition}</span>
          </span>
          <span className="scard__pill">
            <span className="scard__pill-k">Sorteio em</span>
            <span className="scard__pill-v">{item.drawIn}</span>
          </span>
        </div>

        <div className="scard__head">
          <h3 className="scard__title">{item.title}</h3>
          <div className="scard__when">
            {item.dayLabel && <span className="scard__day">{item.dayLabel}</span>}
            <span className="scard__time">{item.time}</span>
          </div>
        </div>

        <p className="scard__susep">{item.susep}</p>

        {inCart ? (
          <div className="scard__added">
            <div className="scard__added-bar">
              <span className="scard__added-check">
                <Check size={15} />
              </span>
              Você adicionou {inCart.qty} {inCart.qty > 1 ? 'títulos' : 'título'} por{' '}
              {formatBRL(inCart.qty * item.price)}
            </div>
            <div className="scard__added-box">
              <strong>Falta pouco para mudar de vida!</strong>
              <span>Agora, você só precisa finalizar o seu pagamento.</span>
              <button type="button" onClick={() => navigate('/checkout')} className="btn scard__pay">
                <CartIcon size={18} /> Ir para o pagamento
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="scard__total">
              <div className="scard__total-info">
                <span>TOTAL</span>
                <strong>{formatBRL(item.price * qty)}</strong>
              </div>
              <div className="stepper stepper--sm">
                <button onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Diminuir">
                  <Minus size={16} />
                </button>
                <span>{String(qty).padStart(2, '0')}</span>
                <button onClick={() => setQty((q) => q + 1)} aria-label="Aumentar">
                  <Plus size={16} />
                </button>
              </div>
            </div>

            <button
              className="btn btn--buy scard__btn"
              onClick={() =>
                addToCart(
                  {
                    id: item.id,
                    title: item.title,
                    price: item.price,
                    image: item.image,
                    date: item.dayLabel ? `${item.dayLabel} · ${item.time}` : item.time,
                    edition: item.edition,
                    excerpt: item.excerpt,
                    kind: item.kind,
                  },
                  qty
                )
              }
            >
              <CartIcon size={18} /> Adicione ao carrinho
            </button>
          </>
        )}
      </div>
    </article>
  )
}

function SorteioGroup({ group }) {
  return (
    <div className="sgroup">
      <div className="section-head">
        <div className="sgroup__head">
          <span className="sgroup__icon" aria-hidden="true">
            {group.icon ? (
              <img className="sgroup__icon-img" src={group.icon} alt="" />
            ) : (
              <Clock size={20} />
            )}
          </span>
          <div>
            <h2 className="section-title">{group.title}</h2>
            <p className="section-sub">{group.subtitle}</p>
          </div>
        </div>
      </div>

      {/* Grid que quebra linha (igual ao oficial: 3 por linha, sem arrastar) */}
      <div className="sorteios__grid">
        {group.items.map((item) => (
          <SorteioCard key={item.id} item={item} />
        ))}
      </div>
    </div>
  )
}

function SkeletonGroups() {
  // "Carregando" suave enquanto os sorteios ao vivo não chegam — evita mostrar
  // os dados estáticos antigos e depois piscar pros atuais.
  return (
    <>
      {[0, 1].map((g) => (
        <div className="sgroup" key={g}>
          <div className="section-head">
            <div className="sgroup__head">
              <span className="skel skel--circle" />
              <div>
                <span className="skel skel--htitle" />
                <span className="skel skel--hsub" />
              </div>
            </div>
          </div>
          <div className="sorteios__grid">
            {[0, 1, 2].map((c) => (
              <article className="scard scard--skel" key={c}>
                <div className="scard__media">
                  <span className="skel skel--fill" />
                </div>
                <div className="scard__body">
                  <span className="skel skel--line" />
                  <span className="skel skel--line skel--w70" />
                  <span className="skel skel--block" />
                </div>
              </article>
            ))}
          </div>
        </div>
      ))}
    </>
  )
}

export default function Sorteios() {
  const { addToCart } = useCart()
  // null = ainda carregando (mostra skeleton). Depois vira os sorteios ao vivo,
  // ou os estáticos se a API falhar.
  const [groups, setGroups] = useState(null)

  useEffect(() => {
    let active = true
    fetchActiveRaffles()
      .then((raffles) => {
        const live = rafflesToGroups(raffles)
        if (active) setGroups(live.length ? live : sorteios.groups)
      })
      .catch(() => {
        if (active) setGroups(sorteios.groups) // fallback estático
      })
    return () => {
      active = false
    }
  }, [])

  const addAll = () =>
    (groups || []).forEach((group) =>
      group.items.forEach((it) =>
        addToCart(
          {
            id: it.id,
            title: it.title,
            price: it.price,
            image: it.image,
            date: it.dayLabel ? `${it.dayLabel} · ${it.time}` : it.time,
            edition: it.edition,
            excerpt: it.excerpt,
            kind: it.kind,
          },
          it.defaultQty || 1
        )
      )
    )

  return (
    <section className="sorteios" id="sorteios">
      <div className="container">
        {groups === null ? (
          <SkeletonGroups />
        ) : (
          groups.map((group) => <SorteioGroup key={group.id} group={group} />)
        )}

        <div className="sorteios__cta">
          <div>
            <strong>{sorteios.ctaTitle}</strong>
            <span>{sorteios.ctaSubtitle}</span>
          </div>
          <button className="btn btn--buy" onClick={addAll}>
            <CartIcon size={18} /> {sorteios.ctaButton}
          </button>
        </div>
      </div>
    </section>
  )
}
