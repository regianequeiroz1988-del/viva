import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { formatBRL } from '../utils/format.js'
import { consultarStatusPedido } from '../lib/pagamentos.js'
import PagamentoOk from './PagamentoOk.jsx'
import { Check } from './Icons.jsx'
import { metaTrack } from '../lib/metapixel.js'
import { googleConversao } from '../lib/googletag.js'

function useCountdown(expiresAt) {
  const [left, setLeft] = useState(() => Math.max(0, (expiresAt || 0) - Date.now()))
  useEffect(() => {
    const id = setInterval(() => {
      setLeft(Math.max(0, (expiresAt || 0) - Date.now()))
    }, 1000)
    return () => clearInterval(id)
  }, [expiresAt])
  return { expired: left <= 0 }
}

// "Pague até DD/MM HH:MM" (igual ao oficial)
const prazoLabel = (expiresAt) => {
  if (!expiresAt) return ''
  const d = new Date(expiresAt)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
}

export default function PixPagamento({
  pix,
  total,
  pedidoId,
  gateway = 'pagarme',
  podeTrocar = false,
  onTrocarGateway,
  onPaid,
  onBack,
  celebracao = true,
  nome,
  cpf,
  evento,
  edicao,
  numeros,
}) {
  const [copiado, setCopiado] = useState(false)
  const [pago, setPago] = useState(false)
  // Snapshot do valor pago: onPaid()/clearCart zera o carrinho (logo, o `total`),
  // então guardamos o valor no momento da confirmação para exibir na tela de sucesso.
  const [totalPago, setTotalPago] = useState(0)
  const [trocando, setTrocando] = useState(false)
  const [erroTroca, setErroTroca] = useState('')
  const { expired } = useCountdown(pix?.expiresAt)
  const pollRef = useRef(null)

  // Rodízio: gera o Pix por outra gate (quando o cliente não consegue pagar nesta).
  const trocar = async () => {
    if (!onTrocarGateway || trocando) return
    setErroTroca('')
    setTrocando(true)
    setCopiado(false)
    try {
      await onTrocarGateway()
    } catch (e) {
      setErroTroca(e?.message || 'Não foi possível gerar por outro banco agora. Tente novamente.')
    }
    setTrocando(false)
  }

  const pagoFiredRef = useRef(false)
  const confirmar = () => {
    setPago(true)
    setTotalPago(Number(total) || 0) // captura antes do clearCart zerar o carrinho
    // Meta Pixel: pagamento confirmado = Purchase (uma vez), value em BRL.
    if (!pagoFiredRef.current) {
      pagoFiredRef.current = true
      metaTrack('Purchase', { value: Number(total) || 0, currency: 'BRL' })
      googleConversao('compra', { value: Number(total) || 0, currency: 'BRL', transaction_id: String(pedidoId || '') })
    }
    onPaid && onPaid()
  }

  // Polling do status do pedido até confirmar o pagamento
  useEffect(() => {
    if (!pedidoId || pix?.demo) return
    pollRef.current = setInterval(async () => {
      const { status } = await consultarStatusPedido(pedidoId, gateway)
      if (status === 'pago') {
        clearInterval(pollRef.current)
        confirmar()
      }
    }, 5000)
    return () => clearInterval(pollRef.current)
  }, [pedidoId, pix?.demo, gateway]) // eslint-disable-line react-hooks/exhaustive-deps

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(pix?.qrCode || '')
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2500)
    } catch {
      /* ignore */
    }
  }

  if (pago) {
    if (celebracao) return <PagamentoOk evento={evento} numeros={numeros} total={totalPago} pedidoId={pedidoId} nome={nome} edicao={edicao} />
    return (
      <div className="pixpay pixpay--ok">
        <span className="pixpay__okicon"><Check size={42} /></span>
        <h2 className="pixpay__oktitle">Depósito confirmado!</h2>
        <p className="pixpay__oksub">Seus créditos já estão disponíveis na sua carteira. 🎉</p>
        <Link className="btn btn--buy pixpay__okbtn" to="/usuario/minha-carteira">Ver minha carteira</Link>
      </div>
    )
  }

  return (
    <div className="pixpay2">
      <div className="pixpay2__head">Pagamento</div>

      <div className="pixpay2__valor">
        <span>Valor <strong>{formatBRL(total)}</strong></span>
        <span className={`pixpay2__prazo ${expired ? 'is-exp' : ''}`}>
          {expired ? 'Código expirado' : `Pague até ${prazoLabel(pix?.expiresAt)}`}
        </span>
      </div>

      {pix?.demo && (
        <p className="pixpay__demo">Modo demonstração — configure o gateway para gerar cobranças reais.</p>
      )}

      <div className="pixpay2__pixrow">
        <span className="pixpay2__pixlogo">
          <span className="pixpay2__pixmark" aria-hidden="true" />Pix
        </span>
        <p>Copie o código Pix abaixo e cole no app do seu banco para finalizar a compra.</p>
      </div>

      <div className="pixpay2__qrrow">
        <div className="pixpay2__qr">
          {pix?.qrCodeUrl ? (
            <img src={pix.qrCodeUrl} alt="QR Code Pix" referrerPolicy="no-referrer" />
          ) : pix?.qrCode ? (
            <QRCodeSVG value={pix.qrCode} size={170} level="M" marginSize={2} />
          ) : (
            <div className="pixpay__qr-ph" aria-hidden="true">QR&nbsp;CODE</div>
          )}
        </div>
        <div className="pixpay2__copy">
          <input readOnly value={pix?.qrCode || ''} onFocus={(e) => e.target.select()} aria-label="Pix copia e cola" />
          <button type="button" onClick={copiar} className={`pixpay2__copybtn ${copiado ? 'is-ok' : ''}`}>
            {copiado ? 'Copiado!' : 'Copiar código Pix'}
          </button>
        </div>
      </div>

      <div className="pixpay2__status">
        <span className="pixpay__spin" aria-hidden="true" /> Aguardando pagamento…
      </div>

      <h3 className="pixpay2__como">Como pagar?</h3>
      <div className="pixpay2__steps">
        <div className="pixpay2__step">
          <span className="pixpay2__stepic">⧉</span>
          <p>Clique no botão acima para <strong>copiar o código Pix</strong>, e logo em seguida abra o app do seu banco ou carteira digital de preferência.</p>
        </div>
        <div className="pixpay2__step">
          <span className="pixpay2__stepic"><Check size={16} /></span>
          <p>Localize a função <strong>Pix</strong>, cole o código Pix no app e confirme o pagamento.</p>
        </div>
      </div>

      {podeTrocar && !pix?.demo && (
        <div className="pixpay2__troca">
          <p className="pixpay2__trocahint">Não conseguiu pagar? Gere um novo Pix por outro banco.</p>
          <button type="button" className="pixpay2__trocabtn" onClick={trocar} disabled={trocando}>
            {trocando ? 'Gerando novo Pix…' : 'Gerar Pix por outro banco'}
          </button>
          {erroTroca && <p className="ck-erro" style={{ marginTop: 8, textAlign: 'center' }}>{erroTroca}</p>}
        </div>
      )}

      <button type="button" className="pixpay2__mudar" onClick={onBack}>
        Mudar método de pagamento
      </button>

      {pix?.demo && (
        <button type="button" className="pixpay__simular" onClick={confirmar}>
          Simular confirmação de pagamento (demo)
        </button>
      )}
    </div>
  )
}
