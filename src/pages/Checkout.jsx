import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useCart } from '../context/CartContext.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { supabase, isSupabaseConfigured } from '../lib/supabase.js'
import { criarPagamentoPixFailover, montarRodizio, GATEWAYS } from '../lib/pagamentos.js'
import { getConfig, CONFIG_KEYS } from '../lib/config.js'
import { getUtms } from '../lib/utm.js'
import { getVisitorId } from '../lib/visitante.js'
import { formatBRL } from '../utils/format.js'
import PixPagamento from '../components/PixPagamento.jsx'
import PagamentoOk from '../components/PagamentoOk.jsx'
import { Plus, Minus, ChevronRight, ArrowUp, Tag, Check } from './../components/Icons.jsx'

const METODOS = [
  { id: 'pix', nome: 'Pix', desc: 'Pague via Pix' },
  { id: 'creditos', nome: 'Créditos', desc: 'Use o saldo da sua carteira' },
  { id: 'cartao', nome: 'Cartão de crédito', desc: 'Indisponível no momento' },
  { id: 'picpay', nome: 'PicPay', desc: 'Indisponível no momento' },
]

const soDigitos = (v) => String(v || '').replace(/\D/g, '')
const telefoneValido = (v) => /^[1-9]{2}9?\d{8}$/.test(soDigitos(v))
function mascaraTelefone(v) {
  const d = soDigitos(v).slice(0, 11)
  if (d.length <= 2) return d ? `(${d}` : ''
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}

function MetodoIcon({ id }) {
  return <span className={`mpay__glyph mpay__glyph--${id}`} aria-hidden="true" />
}

const UPSELL = {
  titulo: 'Hoje é seu dia de sorte 🍀',
  chamada: '🚀 20 CHANCES DE GANHAR ATÉ R$ 3 MIL REAIS!',
  preco: 8.99,
  numeros: 20,
}

export default function Checkout() {
  const { items, total, count, updateQty, removeFromCart, clearCart } = useCart()
  const { user, isAuthed, loading, refreshProfile } = useAuth()
  const navigate = useNavigate()

  const [view, setView] = useState('carrinho') // 'carrinho' | 'pix'
  const [metodo, setMetodo] = useState('pix')
  const [modal, setModal] = useState(false)
  const [telModal, setTelModal] = useState(false)
  const [telValor, setTelValor] = useState('')
  const [telErro, setTelErro] = useState('')
  const [telBusy, setTelBusy] = useState(false)
  const [aceito, setAceito] = useState(true)
  const [extra, setExtra] = useState(false)
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState('')
  const [pix, setPix] = useState(null)
  const [pedidoId, setPedidoId] = useState(null)
  const [resumoAberto, setResumoAberto] = useState(true)
  const [evento, setEvento] = useState('') // sorteio principal comprado (p/ a contemplação)
  const [numerosComprados, setNumerosComprados] = useState(1) // qtd de números (capturada antes de limpar o carrinho)
  const [totalPago, setTotalPago] = useState(0) // valor pago (capturado antes de limpar o carrinho)
  const [gateway, setGateway] = useState('pagarme') // gateway de pagamento ativo (config do /admin)
  const [gateways, setGateways] = useState(['pagarme']) // rodízio: lista ordenada de gates p/ failover
  const [gatewayIndex, setGatewayIndex] = useState(0) // posição atual no rodízio (qual gate gerou o Pix)
  const [edicao, setEdicao] = useState('') // edição do sorteio (capturada antes de limpar o carrinho)
  const totalFinal = useMemo(() => total + (extra ? UPSELL.preco : 0), [total, extra])
  const fator = 1 // números sempre normais (bônus do dobro/roleta de cadastro removido)
  const numeros = (count + (extra ? UPSELL.numeros : 0)) * fator

  // Precisa estar logado (igual ao oficial: identificação antes do carrinho)
  useEffect(() => {
    if (!loading && !isAuthed) {
      navigate('/autenticar', { replace: true, state: { from: '/checkout' } })
    }
  }, [loading, isAuthed, navigate])



  // Gateway ativo + rodízio (escolhidos no /admin). Monta a fila de failover.
  useEffect(() => {
    Promise.all([
      getConfig(CONFIG_KEYS.gatewayAtivo),
      getConfig(CONFIG_KEYS.gatewayRodizio),
    ])
      .then(([ativo, rodizio]) => {
        const a = GATEWAYS.includes(ativo) ? ativo : 'pagarme'
        setGateway(a)
        setGateways(montarRodizio(a, rodizio))
      })
      .catch(() => {})
  }, [])

  // Na etapa de pagamento/confirmação, esconde o carrinho flutuante e a barra
  // inferior — a tela de Pix fica limpa (como no site oficial).
  useEffect(() => {
    const semCarrinho = view === 'pix' || view === 'contemplacao'
    document.body.classList.toggle('body--sem-carrinho', semCarrinho)
    return () => document.body.classList.remove('body--sem-carrinho')
  }, [view])

  // Contador da oferta relâmpago (3 min)
  const [restante, setRestante] = useState(180)
  useEffect(() => {
    if (restante <= 0) return
    const id = setInterval(() => setRestante((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(id)
  }, [restante])
  const mm = Math.floor(restante / 60)
  const ss = String(restante % 60).padStart(2, '0')

  const metodoSel = METODOS.find((m) => m.id === metodo)

  const escolher = (id) => {
    setMetodo(id)
    setModal(false)
  }

  const criarPedido = async () => {
    if (!isSupabaseConfigured || !user?.id) return { id: null }
    const itens = items.map((i) => ({
      id: i.id,
      title: i.title,
      qty: i.qty,
      price: i.price,
      numeros: i.qty * fator, // 1 título = 1 número (×2 com o bônus do dobro)
      edition: i.edition
    }))
    if (extra) itens.push({ id: 'upsell-dia-da-sorte', title: UPSELL.titulo, qty: 1, price: UPSELL.preco, numeros: UPSELL.numeros * fator })
    const payload = {
      user_id: user.id,
      total: totalFinal,
      status: 'pendente',
      itens,
      metodo,
      gateway, // gateway de pagamento ativo (pagarme | medusapay)
      utm: getUtms(),
      visitor_id: getVisitorId(),
      pagador: {
        nome: user?.name,
        cpf: user?.cpf,
        email: user?.email,
        telefone: user?.telefone,
      },
    }
    const inserir = (registro) => supabase.from('pedidos').insert(registro).select('id').single()
    let { data, error } = await inserir(payload)
    if (error) throw new Error(error.message)
    return data
  }

  // Monta o payload do Pix — reutilizado na 1ª geração e nas regerações do rodízio.
  // `regenerar=true` avisa o backend para NÃO reenviar UTMify/e-mail (já enviados na 1ª).
  const montarPayloadPix = (pid, regenerar = false) => {
    const itensPagamento = items.map((i) => ({ title: i.title, qty: i.qty, price: i.price }))
    if (extra) itensPagamento.push({ title: UPSELL.titulo, qty: 1, price: UPSELL.preco })
    const nomesSorteios = items.map((i) => i.title)
    if (extra) nomesSorteios.push(UPSELL.titulo)
    return {
      pedidoId: pid,
      amount: totalFinal,
      items: itensPagamento,
      descricao: { sorteios: nomesSorteios, numeros },
      metodo, // 'pix' aqui — usado pelo backend p/ separar venda de depósito na UTMify
      utm: getUtms(), // origem do tráfego, repassada à UTMify
      customer: { name: user?.name, email: user?.email, cpf: user?.cpf, phone: user?.telefone },
      ...(regenerar ? { regenerar: true } : {}),
    }
  }

  // Rodízio manual: cliente não conseguiu pagar e pede o Pix por outra gate.
  // Tenta a PRÓXIMA da fila, em loop (com failover automático se a próxima também falhar).
  const trocarGateway = async () => {
    if (!pedidoId || gateways.length <= 1) return
    const next = (gatewayIndex + 1) % gateways.length
    const dados = await criarPagamentoPixFailover(montarPayloadPix(pedidoId, true), gateways, next)
    setPix(dados)
    setGatewayIndex(dados.gatewayIndex || 0)
  }

  // Pagamento com créditos da carteira (quando há saldo suficiente)
  const pagarComCreditos = async () => {
    const saldo = Number(user?.creditosNaoSacaveis || 0)
    if (isSupabaseConfigured && saldo < totalFinal) {
      setErro('Saldo de créditos insuficiente. Adicione créditos na sua carteira ou pague via Pix.')
      return
    }
    setBusy(true)
    setEvento(items[0]?.title || '')
    setEdicao(items[0]?.edition || '')
    setNumerosComprados(numeros)
    setTotalPago(totalFinal)
    try {
      if (isSupabaseConfigured && user?.id) {
        const itens = items.map((i) => ({ id: i.id, title: i.title, qty: i.qty, price: i.price, numeros: i.qty * fator, edition: i.edition }))
        if (extra) itens.push({ id: 'upsell-dia-da-sorte', title: UPSELL.titulo, qty: 1, price: UPSELL.preco, numeros: UPSELL.numeros * fator })
        // Servidor manda: a RPC debita o crédito e cria o pedido 'pago' de forma
        // atômica. O cliente NÃO insere pedido pago nem mexe no próprio saldo
        // (antes dava pra forjar pedido pago de graça / pagar menos crédito).
        const { error } = await supabase.rpc('pagar_com_creditos', {
          p_itens: itens,
          p_metodo: 'creditos',
          p_utm: getUtms(),
          p_visitor_id: getVisitorId(),
          p_pagador: { nome: user?.name, cpf: user?.cpf, email: user?.email, telefone: user?.telefone },
        })
        if (error) {
          throw new Error(/saldo insuficiente/i.test(error.message)
            ? 'Saldo de créditos insuficiente. Adicione créditos na sua carteira ou pague via Pix.'
            : (error.message || 'Não foi possível pagar com créditos. Tente novamente.'))
        }
        await refreshProfile?.()
      }
      clearCart()
      setView('contemplacao')
      window.scrollTo({ top: 0, behavior: 'instant' })
    } catch (e) {
      setErro(e.message || 'Não foi possível pagar com créditos. Tente novamente.')
    }
    setBusy(false)
  }

  const salvarTelefone = async (e) => {
    e.preventDefault()
    setTelErro('')
    if (!telefoneValido(telValor)) {
      setTelErro('Digite um telefone válido com DDD, ex.: (11) 98765-4321.')
      return
    }
    setTelBusy(true)
    try {
      if (isSupabaseConfigured && user?.id) {
        const { error } = await supabase.from('profiles').update({ telefone: soDigitos(telValor) }).eq('id', user.id)
        if (error) throw error
        await refreshProfile()
      }
      setTelModal(false)
      setTelBusy(false)
      pagar({ telefoneOk: true })
    } catch {
      setTelErro('Não foi possível salvar o telefone. Tente novamente.')
      setTelBusy(false)
    }
  }

  const pagar = async ({ telefoneOk = false } = {}) => {
    setErro('')
    if (items.length === 0) return
    if (!aceito) {
      setErro('Você precisa aceitar os termos e condições para continuar.')
      return
    }
    if (metodo === 'cartao') {
      setErro('O pagamento com cartão está indisponível no momento. Somente pagamento via Pix.')
      return
    }
    if (metodo === 'picpay') {
      setErro('O PicPay está indisponível no momento. Somente pagamento via Pix.')
      return
    }
    if (metodo === 'creditos') {
      await pagarComCreditos()
      return
    }
    if (!telefoneOk && !telefoneValido(user?.telefone)) {
      setTelValor(mascaraTelefone(user?.telefone))
      setTelErro('')
      setTelModal(true)
      return
    }
    // PayForge exige no mínimo R$ 5,00 por transação.
    if (gateway === 'payforge' && totalFinal < 5) {
      setErro('O valor mínimo para pagamento via Pix é R$ 5,00. Adicione mais números para continuar.')
      return
    }
    setBusy(true)
    setEvento(items[0]?.title || '')
    setEdicao(items[0]?.edition || '')
    setNumerosComprados(numeros)
    let pedido = null
    try {
      pedido = await criarPedido()
      // IMPORTANTE: o valor cobrado é a SOMA dos itens enviados. Por isso a oferta
      // relâmpago (upsell) precisa entrar no payload, senão o Pix sairia só com o
      // valor dos títulos. O failover percorre o rodízio (PayForge → Pagar.me)
      // até uma gate conseguir gerar — se a 1ª recusar (ex.: teto de valor no Pix),
      // já tenta a próxima sozinho.
      const dados = await criarPagamentoPixFailover(montarPayloadPix(pedido?.id, false), gateways, 0)
      setPedidoId(pedido?.id)
      setPix(dados)
      setGatewayIndex(dados.gatewayIndex || 0)
      setView('pix')
      window.scrollTo({ top: 0, behavior: 'instant' })
    } catch (e) {
      // Nenhuma gate conseguiu gerar o Pix: apaga o pedido recém-criado para ele
      // NÃO virar "pendente fantasma" no /admin (Pix nunca gerado = impagável).
      // O cliente vê o erro e pode tentar de novo (aí nasce um pedido novo).
      if (pedido?.id && isSupabaseConfigured && !e?.stopFailover) {
        try { await supabase.from('pedidos').delete().eq('id', pedido.id) } catch { /* ignora limpeza */ }
      }
      setErro(e.message || 'Não foi possível iniciar o pagamento. Tente novamente.')
    }
    setBusy(false)
  }

  if (loading || !isAuthed) {
    return <main className="checkout2"><div className="checkout2__wrap" /></main>
  }

  // ----- Contemplação (pagamento com créditos confirmado) -------------------
  if (view === 'contemplacao') {
    return (
      <main className="checkout2">
        <div className="checkout2__wrap checkout2__wrap--narrow">
          <PagamentoOk evento={evento} edicao={edicao} numeros={numerosComprados} total={totalPago} nome={user?.name} />
        </div>
      </main>
    )
  }

  // ----- Tela de pagamento Pix ----------------------------------------------
  if (view === 'pix') {
    return (
      <main className="checkout2">
        <div className="checkout2__wrap checkout2__wrap--narrow">
          <PixPagamento
            pix={pix}
            total={totalFinal}
            pedidoId={pedidoId}
            gateway={pix?.gateway || gateway}
            podeTrocar={gateways.length > 1}
            onTrocarGateway={trocarGateway}
            nome={user?.name}
            cpf={user?.cpf}
            evento={evento}
            edicao={edicao}
            numeros={numerosComprados}
            celebracao
            onPaid={() => clearCart()}
            onBack={() => setView('carrinho')}
          />
        </div>
      </main>
    )
  }

  // ----- Carrinho (etapa 2) -------------------------------------------------
  return (
    <main className="checkout2">
      <div className="checkout2__wrap">
        {/* Stepper */}
        <div className="ck-steps">
          <Link to="/" className="ck-steps__back" aria-label="Voltar">‹</Link>
          <span className="ck-steps__done"><Check size={16} /></span>
          <div className="ck-steps__bar">
            <span className="ck-steps__label">2. Carrinho</span>
          </div>
        </div>

        {items.length === 0 ? (
          <div className="ck-empty">
            <p>Seu carrinho está vazio.</p>
            <Link to="/" className="btn btn--buy">Ver sorteios</Link>
          </div>
        ) : (
          <div className="ck-grid">
            {/* Coluna esquerda — itens + upsell */}
            <section className="ck-list">
              {items.map((it) => (
                <article className="ck-item" key={it.id}>
                  <div className="ck-item__media">
                    {it.image ? (
                      <img src={it.image} alt={it.title} referrerPolicy="no-referrer" />
                    ) : (
                      <span className="ck-item__noimg">VS+</span>
                    )}
                  </div>
                  <div className="ck-item__info">
                    <h3 className="ck-item__title">{it.title}</h3>
                    <strong className="ck-item__price">{formatBRL(it.qty * it.price)}</strong>
                  </div>
                  <div className="ck-item__right">
                    {it.date && <span className="ck-item__date">{it.date}</span>}
                    <div className="ck-item__ctrls">
                      <button
                        className="ck-item__info-btn"
                        title="Remover do carrinho"
                        onClick={() => removeFromCart(it.id)}
                        aria-label="Remover"
                      >
                        i
                      </button>
                      <div className="ck-stepper">
                        <button
                          onClick={() => (it.qty <= 1 ? removeFromCart(it.id) : updateQty(it.id, it.qty - 1))}
                          aria-label={it.qty <= 1 ? 'Remover do carrinho' : 'Diminuir'}
                          title={it.qty <= 1 ? 'Remover do carrinho' : 'Diminuir'}
                        >
                          <Minus size={16} />
                        </button>
                        <span>{it.qty}</span>
                        <button onClick={() => updateQty(it.id, it.qty + 1)} aria-label="Aumentar">
                          <Plus size={16} />
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              ))}

              {/* Oferta relâmpago (upsell) */}
              <div className={`ck-upsell ${extra ? 'is-on' : ''}`}>
                <span className="ck-upsell__expira">EXPIRA EM: {mm}m {ss}s</span>
                <div className="ck-upsell__row">
                  <span className="ck-upsell__bolt" aria-hidden="true">⚡</span>
                  <div className="ck-upsell__txt">
                    <strong>{UPSELL.titulo}</strong>
                    <span>{UPSELL.chamada}</span>
                  </div>
                </div>
                <div className="ck-upsell__foot">
                  <div className="ck-upsell__price">
                    <span className="ck-upsell__limited">🔥 OFERTA POR TEMPO LIMITADO</span>
                    <span className="ck-upsell__valor">por apenas <b>{formatBRL(UPSELL.preco)}</b></span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={extra}
                    className={`ck-switch ${extra ? 'is-on' : ''}`}
                    onClick={() => setExtra((v) => !v)}
                  >
                    <span className="ck-switch__dot" />
                  </button>
                </div>
              </div>
            </section>

            {/* Coluna direita — resumo */}
            <aside className="ck-resumo">
              <button
                className={`ck-resumo__toggle ${resumoAberto ? '' : 'is-closed'}`}
                onClick={() => setResumoAberto((v) => !v)}
                aria-label="Mostrar/ocultar resumo"
              >
                <ArrowUp size={18} />
              </button>

              <h2 className="ck-resumo__title">RESUMO<small>da sua compra</small></h2>

              {resumoAberto && (
                <div className="ck-resumo__rows">
                  <div className="ck-resumo__row">
                    <span>Números da sorte</span>
                    <strong>{numeros}</strong>
                  </div>
                </div>
              )}

              <div className="ck-resumo__total">
                <span>Total a pagar</span>
                <strong>{formatBRL(totalFinal)}</strong>
              </div>

              {/* Método de pagamento */}
              <button className="ck-metodo" onClick={() => setModal(true)}>
                <MetodoIcon id={metodo} />
                <span className="ck-metodo__nome">{metodoSel?.nome}</span>
                <span className="ck-metodo__trocar">Trocar</span>
              </button>

              {/* Cupom */}
              <div className="ck-cupom">
                <span className="ck-cupom__ico"><Tag size={18} /></span>
                <div className="ck-cupom__txt">
                  <strong>Cupom</strong>
                  <span>Nenhum cupom disponível</span>
                </div>
                <button className="ck-cupom__add" type="button">Adicionar</button>
              </div>

              {/* Termos */}
              <label className="ck-termos">
                <input type="checkbox" checked={aceito} onChange={(e) => setAceito(e.target.checked)} />
                <span>Concordo com os <Link to="/institucional/termos-de-uso">termos e condições</Link></span>
              </label>

              {erro && <p className="ck-erro">{erro}</p>}

              <button className="ck-pagar" onClick={() => pagar()} disabled={busy}>
                {busy ? 'Gerando pagamento…' : <>Pagar <ChevronRight size={18} /></>}
              </button>
            </aside>
          </div>
        )}
      </div>

      {telModal && (
        <div className="mpay" role="dialog" aria-modal="true" aria-labelledby="tel-titulo" onClick={() => !telBusy && setTelModal(false)}>
          <form className="mpay__box ck-tel" onClick={(e) => e.stopPropagation()} onSubmit={salvarTelefone}>
            <h2 id="tel-titulo">Qual é o seu telefone?</h2>
            <p>Precisamos do seu celular com DDD para gerar o Pix e avisar se você for sorteado.</p>
            <input
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              placeholder="(11) 98765-4321"
              value={telValor}
              onChange={(e) => setTelValor(mascaraTelefone(e.target.value))}
              autoFocus
            />
            {telErro && <p className="ck-erro">{telErro}</p>}
            <button type="submit" className="ck-pagar" disabled={telBusy}>
              {telBusy ? 'Salvando…' : <>Continuar para o Pix <ChevronRight size={18} /></>}
            </button>
            <button type="button" className="ck-tel__cancelar" onClick={() => setTelModal(false)} disabled={telBusy}>
              Cancelar
            </button>
          </form>
        </div>
      )}

      {/* Modal de seleção de método de pagamento */}
      {modal && (
        <div className="mpay" role="dialog" aria-modal="true" onClick={() => setModal(false)}>
          <div className="mpay__box" onClick={(e) => e.stopPropagation()}>
            <button className="mpay__back" onClick={() => setModal(false)} aria-label="Fechar">‹</button>
            <ul className="mpay__list">
              {METODOS.map((m) => (
                <li key={m.id}>
                  <button
                    className={`mpay__opt ${metodo === m.id ? 'is-sel' : ''}`}
                    onClick={() => escolher(m.id)}
                  >
                    <MetodoIcon id={m.id} />
                    <span className="mpay__opt-txt">
                      <strong>{m.nome}</strong>
                      <small>{m.desc}</small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <button
              className="mpay__card"
              type="button"
              onClick={() => { setModal(false); navigate('/usuario/meus-cartoes') }}
            >
              Adicionar novo cartão
            </button>
          </div>
        </div>
      )}
    </main>
  )
}
