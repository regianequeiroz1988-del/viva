import { useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext.jsx'
import { supabase, isSupabaseConfigured } from '../../lib/supabase.js'
import { criarPagamentoPixFailover, montarRodizio, GATEWAYS } from '../../lib/pagamentos.js'
import { getVisitorId } from '../../lib/visitante.js'
import { formatBRL } from '../../utils/format.js'
import { getConfig, CONFIG_KEYS } from '../../lib/config.js'
import PixPagamento from '../../components/PixPagamento.jsx'

const VALORES_RAPIDOS = [20, 50, 100, 200]

export default function MinhaCarteira() {
  const { user, refreshProfile } = useAuth()

  const [view, setView] = useState('carteira') // 'carteira' | 'deposito' | 'pix'
  const [valor, setValor] = useState('')
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState('')
  const [pix, setPix] = useState(null)
  const [pedidoId, setPedidoId] = useState(null)
  const [valorDeposito, setValorDeposito] = useState(0)
  const [gateway, setGateway] = useState('pagarme')
  const [gateways, setGateways] = useState(['pagarme']) // rodízio: lista ordenada p/ failover
  const [gatewayIndex, setGatewayIndex] = useState(0) // posição atual no rodízio

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

  const valorNum = Number(String(valor).replace(',', '.')) || 0

  const criarPedidoDeposito = async (amount) => {
    if (!isSupabaseConfigured || !user?.id) return { id: null }
    const { data, error } = await supabase
      .from('pedidos')
      .insert({
        user_id: user.id,
        total: amount,
        status: 'pendente',
        metodo: 'deposito',
        itens: [{ tipo: 'deposito', title: 'Depósito de créditos', qty: 1, price: amount }],
        visitor_id: getVisitorId(),
        pagador: { nome: user?.name, cpf: user?.cpf },
      })
      .select('id')
      .single()
    if (error) throw new Error(error.message)
    return data
  }

  // Monta o payload do Pix do depósito — reutilizado na 1ª geração e nas regerações.
  const montarPayloadDeposito = (pid, amount, regenerar = false) => ({
    pedidoId: pid,
    amount,
    items: [{ title: 'Depósito de créditos', qty: 1, price: amount }],
    descricao: { sorteios: ['Depósito de créditos na carteira'], numeros: 0 },
    metodo: 'deposito', // depósito de carteira não é venda — backend não envia à UTMify
    customer: { name: user?.name, email: user?.email, cpf: user?.cpf, phone: user?.telefone },
    ...(regenerar ? { regenerar: true } : {}),
  })

  // Rodízio manual: cliente não conseguiu pagar e pede o Pix por outra gate (em loop).
  const trocarGateway = async () => {
    if (!pedidoId || gateways.length <= 1) return
    const next = (gatewayIndex + 1) % gateways.length
    const dados = await criarPagamentoPixFailover(montarPayloadDeposito(pedidoId, valorDeposito, true), gateways, next)
    setPix(dados)
    setGatewayIndex(dados.gatewayIndex || 0)
  }

  const depositar = async () => {
    setErro('')
    if (valorNum < 5) {
      setErro('O valor mínimo de depósito é R$ 5,00.')
      return
    }
    setBusy(true)
    try {
      const pedido = await criarPedidoDeposito(valorNum)
      // Failover: percorre o rodízio até uma gate gerar o Pix (igual ao checkout).
      const dados = await criarPagamentoPixFailover(montarPayloadDeposito(pedido?.id, valorNum), gateways, 0)
      setPedidoId(pedido?.id)
      setPix(dados)
      setGatewayIndex(dados.gatewayIndex || 0)
      setValorDeposito(valorNum)
      setView('pix')
      window.scrollTo({ top: 0, behavior: 'instant' })
    } catch (e) {
      setErro(e.message || 'Não foi possível iniciar o depósito. Tente novamente.')
    }
    setBusy(false)
  }

  // ---- Tela de pagamento Pix do depósito ----------------------------------
  if (view === 'pix') {
    return (
      <main className="page">
        <div className="container" style={{ maxWidth: 560 }}>
          <PixPagamento
            pix={pix}
            total={valorDeposito}
            pedidoId={pedidoId}
            gateway={pix?.gateway || gateway}
            podeTrocar={gateways.length > 1}
            onTrocarGateway={trocarGateway}
            celebracao={false}
            onPaid={() => refreshProfile && refreshProfile()}
            onBack={() => setView('deposito')}
          />
        </div>
      </main>
    )
  }

  return (
    <main className="page">
      <div className="container">
        <div className="usr-wallet">
          <h1 className="usr-wallet__title">Minha carteira</h1>
          <div className="usr-wallet__stats">
            <div>
              <span>Créditos não sacáveis</span>
              <strong>{formatBRL(user?.creditosNaoSacaveis || 0)}</strong>
            </div>
            <div>
              <span>Saldo disponível para saque</span>
              <strong>{formatBRL(user?.saldoSaque || 0)}</strong>
            </div>
          </div>
        </div>

        <div className="usr-wallet__bar">
          <span>Total sacado até hoje</span>
          <strong>{formatBRL(user?.totalSacado || 0)}</strong>
        </div>

        <p className="usr-wallet__hello">
          <strong>Olá, {user?.name}.</strong> Gerencie seus créditos, saldo sacável e
          solicite saques em um só lugar.
        </p>

        {/* Depositar créditos via Pix */}
        <div className="usr-card wallet-dep">
          <h2>Adicionar créditos</h2>
          <p className="usr-muted">
            Deposite via Pix e use seus créditos para comprar títulos. O crédito é liberado
            assim que o pagamento for confirmado.
          </p>

          <div className="wallet-dep__chips">
            {VALORES_RAPIDOS.map((v) => (
              <button
                key={v}
                type="button"
                className={`wallet-dep__chip ${valorNum === v ? 'is-on' : ''}`}
                onClick={() => setValor(String(v))}
              >
                {formatBRL(v)}
              </button>
            ))}
          </div>

          <label className="wallet-dep__label">Ou digite um valor</label>
          <div className="wallet-dep__row">
            <div className="wallet-dep__input">
              <span>R$</span>
              <input
                inputMode="decimal"
                placeholder="0,00"
                value={valor}
                onChange={(e) => setValor(e.target.value.replace(/[^\d.,]/g, ''))}
              />
            </div>
            <button type="button" className="usr-btn usr-btn--primary" onClick={depositar} disabled={busy}>
              {busy ? 'Gerando Pix…' : 'Depositar via Pix'}
            </button>
          </div>
          {erro && <p className="ck-erro">{erro}</p>}
        </div>

        <div className="usr-wallet__actions">
          <button type="button" className="usr-btn usr-btn--primary">Solicitar saque</button>
          <button type="button" className="usr-btn">Resgatar um código</button>
        </div>

        <div className="usr-card">
          <h2>Sacar saldo</h2>
          <p className="usr-muted">O saque de saldo é feito somente através de transferência Pix.</p>
        </div>
      </div>
    </main>
  )
}
