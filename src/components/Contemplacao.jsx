import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import confetti from 'canvas-confetti'
import { QRCodeSVG } from 'qrcode.react'
import { formatBRL } from '../utils/format.js'
import { getConfig, CONFIG_KEYS } from '../lib/config.js'
import { BILHETE_PREMIADO, PREMIO_INSTANTANEO, bilhetePremiadoStr, gerarNumeros } from '../utils/premio.js'
import VideoMensagem from './VideoMensagem.jsx'
import PixModal from './PixModal.jsx'
import { consultarPremio } from '../lib/premioResgate.js'

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

const CORES = ['#ffd21e', '#ffb800', '#fff', '#1e3fcf', '#25ad4b', '#ff4d6d']

// Sequência de fogos/confete (canvas-confetti) — dura ~6s
function dispararFogos() {
  if (prefersReducedMotion()) return () => {}
  let cancelado = false

  // Estouro inicial dos dois lados (canhão)
  confetti({ particleCount: 140, spread: 90, startVelocity: 55, origin: { y: 0.6 }, colors: CORES, zIndex: 4000 })

  // Chuva contínua dos cantos + fogos aleatórios
  const fim = Date.now() + 5200
  const frame = () => {
    if (cancelado) return
    confetti({ particleCount: 4, angle: 60, spread: 60, startVelocity: 45, origin: { x: 0, y: 0.7 }, colors: CORES, zIndex: 4000 })
    confetti({ particleCount: 4, angle: 120, spread: 60, startVelocity: 45, origin: { x: 1, y: 0.7 }, colors: CORES, zIndex: 4000 })
    if (Date.now() < fim) requestAnimationFrame(frame)
  }
  frame()

  // Fogos pontuais no alto (bursts)
  const bursts = [600, 1300, 2100, 3000, 4000].map((t) =>
    setTimeout(() => {
      if (cancelado) return
      confetti({
        particleCount: 80,
        spread: 100,
        startVelocity: 35,
        origin: { x: 0.2 + Math.random() * 0.6, y: 0.2 + Math.random() * 0.25 },
        colors: CORES,
        zIndex: 4000,
        scalar: 1.1,
      })
    }, t)
  )

  return () => {
    cancelado = true
    bursts.forEach(clearTimeout)
  }
}

// Contador animado (0 → alvo) com easing
function useCountUp(target, duration, ativo) {
  const [valor, setValor] = useState(0)
  useEffect(() => {
    if (!ativo) return
    if (prefersReducedMotion()) {
      setValor(target)
      return
    }
    let raf
    let inicio
    const easeOut = (t) => 1 - Math.pow(1 - t, 3)
    const passo = (ts) => {
      if (inicio === undefined) inicio = ts
      const p = Math.min(1, (ts - inicio) / duration)
      setValor(Math.round(target * easeOut(p)))
      if (p < 1) raf = requestAnimationFrame(passo)
    }
    raf = requestAnimationFrame(passo)
    // Garante o valor final mesmo se o rAF for pausado (aba em segundo plano)
    const fallback = setTimeout(() => setValor(target), duration + 250)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(fallback)
    }
  }, [target, duration, ativo])
  return valor
}

export default function Contemplacao({ nome, cpf, evento, numeros = 1, dados = null, mostrarMinha = true, mostrarWhatsapp = true, compact = false, onResgatar = null }) {
  const [step, setStep] = useState(0) // controla a revelação encenada
  const [whatsapp, setWhatsapp] = useState('')
  const [video, setVideo] = useState('')
  // Valor do prêmio instantâneo: padrão R$ 50.000, mas o ligador pode alterar
  // no próprio painel (/ligador) — vale pra todo mundo que acessa o /ganhador.
  const [premioValor, setPremioValor] = useState(PREMIO_INSTANTANEO)
  // Resgate do prêmio: começa bloqueado até o ligador liberar (ver painel do
  // ligador). Faz polling pra destravar o botão sozinho, sem recarregar a página.
  // estado: 'bloqueado' | 'liberado' | 'pagamento_parcial'.
  const [resgate, setResgate] = useState({ codigo: null, estado: 'bloqueado', valor: null })
  const [revelado, setRevelado] = useState(false)
  const [copiado, setCopiado] = useState(false)
  const [pixAberto, setPixAberto] = useState(false)

  const meusNumeros = gerarNumeros(numeros)

  const cpfDigits = String(cpf || '').replace(/\D/g, '')
  const cpfMask =
    cpfDigits.length === 11
      ? `${cpfDigits.slice(0, 3)}.${cpfDigits.slice(3, 6)}.${cpfDigits.slice(6, 9)}-${cpfDigits.slice(9)}`
      : cpf || '—'
  const primeiroNome = nome ? String(nome).split(' ')[0] : ''
  // Link do grupo (já vem "trim"); normaliza pra ter https:// senão o <a> quebra.
  const grupoUrl = whatsapp && !/^https?:\/\//i.test(whatsapp) ? `https://${whatsapp}` : whatsapp

  const premio = useCountUp(premioValor, 1400, step >= 3)

  // Revelação encenada (cada etapa entra com um atraso)
  useEffect(() => {
    const ts = [200, 700, 1200, 1800, 2600, 3200].map((t, i) =>
      setTimeout(() => setStep((s) => Math.max(s, i + 1)), t)
    )
    return () => ts.forEach(clearTimeout)
  }, [])

  // Fogos ao montar
  useEffect(() => {
    const parar = dispararFogos()
    return parar
  }, [])

  // Busca o link do grupo do WhatsApp, o vídeo da premiação (configuráveis no
  // /admin) e o valor do prêmio instantâneo (configurável pelo /ligador).
  useEffect(() => {
    let on = true
    getConfig(CONFIG_KEYS.whatsappGanhadores).then((v) => on && setWhatsapp((v || '').trim()))
    getConfig(CONFIG_KEYS.videoPremiacao).then((v) => on && setVideo((v || '').trim()))
    getConfig(CONFIG_KEYS.premioGanhadorValor).then((v) => {
      const n = Number(v)
      if (on && v && Number.isFinite(n) && n >= 0) setPremioValor(n)
    })
    return () => { on = false }
  }, [])

  // Estado do resgate (bloqueado/liberado/pagamento_parcial + código + valor
  // próprio deste CPF) — checa de novo a cada poucos segundos, pra destravar
  // (ou travar de novo, no caso de pagamento parcial) o botão sozinho.
  useEffect(() => {
    if (!cpf) return
    let on = true
    const checar = () =>
      consultarPremio(cpf).then((r) => {
        if (!on) return
        setResgate(r)
        if (r.valor != null) setPremioValor(r.valor) // valor próprio deste CPF sobrescreve o padrão
        if (r.estado !== 'liberado') setRevelado(false) // código antigo pode ter sido limpo no servidor
      })
    checar()
    const id = setInterval(checar, 4000)
    return () => { on = false; clearInterval(id) }
  }, [cpf])

  const copiarCodigo = async () => {
    if (!resgate.codigo) return
    try {
      await navigator.clipboard.writeText(resgate.codigo)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      /* ignore */
    }
  }

  const cls = (n) => `cmp-rise ${step >= n ? 'is-in' : ''}`

  return (
    <div className={`cmp ${compact ? 'cmp--compact' : ''}`}>
      <div className="cmp__glow" aria-hidden="true" />
      <div className="cmp__rays" aria-hidden="true" />

      <div className="cmp__inner">
        <div className={`cmp__trophy ${step >= 1 ? 'is-in' : ''}`} aria-hidden="true">🏆</div>

        <span className={`cmp__badge ${cls(1)}`}>🎉 VOCÊ FOI SORTEADO(A)! 🎉</span>

        <h2 className={`cmp__title ${cls(1)}`}>
          Parabéns{primeiroNome ? `, ${primeiroNome}` : ''}!
        </h2>
        <p className={`cmp__lead ${cls(2)}`}>
          Você acaba de ser sorteado(a) com um <strong>número premiado</strong>!
        </p>

        {dados && dados.length > 0 && (
          <div className={`cmp__dados ${cls(2)}`}>
            <span className="cmp__dados-k">Dados confirmados do ganhador</span>
            <dl className="cmp__dados-grid">
              {dados.map(({ label, value }) => (
                <div className="cmp__dado" key={label}>
                  <dt>{label}</dt>
                  <dd>{value || '—'}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        <div className={`cmp__ticket ${cls(2)}`}>
          <span className="cmp__ticket-k">Seu bilhete premiado</span>
          <strong className="cmp__ticket-n">
            {bilhetePremiadoStr.split('').map((d, i) => (
              <span key={i} className="cmp__digit" style={{ animationDelay: `${0.9 + i * 0.08}s` }}>{d}</span>
            ))}
          </strong>
          {evento && (
            <span className="cmp__ticket-ev">
              no sorteio <strong>{evento}</strong>
            </span>
          )}
        </div>

        {meusNumeros.length > 1 && (
          <div className={`cmp__nums ${cls(2)}`}>
            <span className="cmp__nums-k">
              {meusNumeros.length} números da sorte adquiridos — um deles foi premiado! 👇
            </span>
            <div className="cmp__nums-grid">
              {meusNumeros.map((n) => (
                <span key={n.numero} className={`cmp__num ${n.premiado ? 'is-win' : ''}`}>
                  {n.numero}
                  {n.premiado && <em>PREMIADO</em>}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className={`cmp__prize ${cls(3)}`}>
          <span className="cmp__prize-k">Você ganhou agora</span>
          <strong className="cmp__prize-v">{formatBRL(premio)}</strong>
          <span className="cmp__prize-sub">na hora! 💰</span>
        </div>

        <div className={`cmp__resgate ${cls(3)}`}>
          {resgate.estado === 'pagamento_parcial' ? (
            <div className="cmp__resgate-parcial">
              <strong>💸 Pagamento parcial realizado.</strong>
              <span>Aguarde a nova liberação.</span>
            </div>
          ) : !revelado ? (
            <button
              type="button"
              className={`cmp__resgate-btn ${resgate.estado === 'liberado' ? 'is-liberado' : 'is-bloqueado'}`}
              disabled={resgate.estado !== 'liberado'}
              onClick={async () => { if (onResgatar && (await onResgatar())) return; setPixAberto(true) }}
            >
              {resgate.estado === 'liberado' ? '🎁 Resgatar meu prêmio!' : '🔒 Resgatar meu prêmio!'}
            </button>
          ) : (
            <div className="cmp__resgate-codigo">
              <span className="cmp__resgate-k">Escaneie o QR Code ou copie o código abaixo</span>
              {resgate.codigo && (
                <div className="cmp__resgate-qr">
                  <QRCodeSVG value={resgate.codigo} size={170} level="M" marginSize={2} />
                </div>
              )}
              <div className="cmp__resgate-copyrow">
                <input readOnly value={resgate.codigo || ''} onFocus={(e) => e.target.select()} aria-label="Código de resgate (copia e cola)" />
                <button type="button" className="cmp__resgate-copy" onClick={copiarCodigo}>
                  {copiado ? '✓ Copiado!' : '📋 Copiar código'}
                </button>
              </div>
            </div>
          )}
          {resgate.estado === 'bloqueado' && (
            <span className="cmp__resgate-aguarde">Aguardando liberação da nossa equipe…</span>
          )}
        </div>

        {pixAberto && (
          <PixModal nome={nome} cpf={cpfDigits} onClose={() => setPixAberto(false)} onConfirmado={() => setRevelado(true)} />
        )}

        <p className={`cmp__concorre ${cls(4)}`}>
          E não para por aí: você <strong>continua concorrendo ao prêmio total!</strong> 🍀
        </p>

        {video && (
          <div className={`cmp__video ${cls(4)}`}>
            <VideoMensagem url={video} titulo="🎥 Uma mensagem do Renato pra você" />
          </div>
        )}

        <div className={`cmp__aviso ${cls(5)}`}>
          <strong>📱 Fique ligado(a) no seu telefone!</strong>
          <p>
            Dentro de <strong>24 horas</strong> entraremos em contato para realizar o
            pagamento do seu prêmio. Mantenha o número cadastrado por perto.
          </p>
        </div>

        <div className={`cmp__cpf ${cls(5)}`}>
          <strong>Importante:</strong> somente o(a) portador(a) do CPF da conta premiada
          <span className="cmp__cpf-n"> {cpfMask} </span>
          poderá receber o prêmio.
        </div>

        <div className={`cmp__acoes ${cls(6)}`}>
          {mostrarWhatsapp && grupoUrl && (
            <a
              className="cmp__wpp"
              href={grupoUrl}
              target="_blank"
              rel="noreferrer noopener"
            >
              <span className="cmp__wpp-ico" aria-hidden="true">🟢</span>
              Entrar no grupo dos ganhadores
            </a>
          )}
          {mostrarMinha && (
            <Link className="cmp__btn" to="/usuario/minhas-contemplacoes">
              Ver minha contemplação
            </Link>
          )}
          <Link className="cmp__home" to="/">
            Voltar para a página inicial
          </Link>
        </div>
      </div>
    </div>
  )
}
