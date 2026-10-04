import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { gerarNumeros } from '../utils/premio.js'
import { formatBRL } from '../utils/format.js'
import { Check } from './Icons.jsx'

// Segundos que o modal fica aberto antes de voltar sozinho pra home.
const DURACAO = 10

// Modal TEMPORÁRIO pós-pagamento: confirma a compra, mostra os números da sorte
// e a dica de ver os títulos no Perfil. Fica ~10s aberto e volta pra home sozinho.
// Usado nos dois fluxos confirmados (Pix e créditos). SEM menção a prêmio/ganho.
export default function PagamentoOk({ evento, numeros = 1, total = 0, pedidoId, nome, edicao }) {
  const navigate = useNavigate()
  // Guarda a última referência do navigate num ref: assim os efeitos NÃO dependem
  // da identidade do navigate (se ela mudasse, o setTimeout seria resetado a cada
  // segundo e nunca voltaria pra home).
  const navRef = useRef(navigate)
  navRef.current = navigate
  const cardRef = useRef(null)

  // Congela os números para não recalcular a cada tick da contagem (re-render/seg).
  const meusNumeros = useMemo(() => gerarNumeros(numeros), [numeros])
  const [verTodos, setVerTodos] = useState(false)
  const [restante, setRestante] = useState(DURACAO)
  // Qualquer interação explícita cancela o fechamento automático (deixa a pessoa ler).
  const [pausado, setPausado] = useState(false)
  const visiveis = verTodos ? meusNumeros : meusNumeros.slice(0, 12)

  const primeiroNome = (nome || '').trim().split(/\s+/)[0]
  const pedidoNum = pedidoId ? String(pedidoId).slice(0, 8).toUpperCase() : null
  const totalNum = Number(total) || 0

  const fechar = () => navRef.current('/')

  // Ao abrir: joga o foco pro modal (a11y — quem abriu o modal acabou de desmontar).
  useEffect(() => {
    cardRef.current?.focus()
  }, [])

  // Contagem regressiva + volta pra home sozinho ao chegar em 0.
  useEffect(() => {
    if (pausado) return undefined
    const timer = setTimeout(() => navRef.current('/'), DURACAO * 1000)
    const tick = setInterval(() => setRestante((s) => Math.max(0, s - 1)), 1000)
    return () => {
      clearTimeout(timer)
      clearInterval(tick)
    }
  }, [pausado])

  // Segura o fechamento automático assim que a pessoa se engaja (não puxa pra home
  // no meio da leitura/ação): teclado focando um botão, ou mouse sobre o card.
  const pausar = () => setPausado(true)
  const aoFocar = (e) => { if (e.target.tagName === 'BUTTON') setPausado(true) }

  // Esc fecha; Tab fica preso dentro do modal (foco não escapa pro Header/Footer atrás).
  const aoTeclar = (e) => {
    if (e.key === 'Escape') { navRef.current('/'); return }
    if (e.key !== 'Tab') return
    const focaveis = cardRef.current?.querySelectorAll('button')
    if (!focaveis || focaveis.length === 0) return
    const primeiro = focaveis[0]
    const ultimo = focaveis[focaveis.length - 1]
    const ativo = document.activeElement
    if (e.shiftKey && (ativo === primeiro || ativo === cardRef.current)) {
      e.preventDefault()
      ultimo.focus()
    } else if (!e.shiftKey && ativo === ultimo) {
      e.preventDefault()
      primeiro.focus()
    }
  }

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
    <div className="okmodal" role="dialog" aria-modal="true" aria-labelledby="okmodal-title" onFocusCapture={aoFocar} onKeyDown={aoTeclar}>
      <div className="okmodal__backdrop" onClick={fechar} />
      <div className="okmodal__card" ref={cardRef} tabIndex={-1} onMouseEnter={pausar}>
        <span className="okmodal__check"><Check size={30} /></span>
        <h2 className="okmodal__title" id="okmodal-title">Pagamento confirmado!</h2>
        <p className="okmodal__sub">
          {primeiroNome ? <>Tudo certo, <strong>{primeiroNome}</strong>! </> : 'Tudo certo! '}
          Sua compra{pedidoNum ? <> (pedido nº <strong>{pedidoNum}</strong>)</> : ''} foi confirmada.
        </p>

        {(totalNum > 0 || evento) && (
          <div className="okmodal__resumo">
            {evento && <span className="okmodal__resumo-ev">{evento}{edicao ? ` · Edição ${edicao}` : ''}</span>}
            {totalNum > 0 && <span className="okmodal__resumo-v">{formatBRL(totalNum)}</span>}
          </div>
        )}

        <div className="okmodal__nums">
          <span className="okmodal__nums-k">Seus números da sorte</span>
          <div className="okmodal__numgrid">
            {visiveis.map((n) => (
              <span key={n.numero} className={`cc-num ${n.premiado ? 'is-win' : ''}`}>{n.numero}</span>
            ))}
          </div>
          {meusNumeros.length > 12 && (
            <button type="button" className="okmodal__vertodos" onClick={() => { pausar(); setVerTodos((v) => !v) }}>
              {verTodos ? 'ver menos' : `ver todos (${meusNumeros.length})`}
            </button>
          )}
        </div>

        <p className="okmodal__dica">
          💡 Quer acompanhar seus títulos com detalhes? É só acessar o seu <strong>Perfil</strong>.
        </p>

        <button type="button" className="btn btn--buy okmodal__btn" onClick={() => navigate('/usuario/perfil')}>
          Ver no Perfil
        </button>
        <button type="button" className="okmodal__voltar" onClick={fechar}>
          Voltar ao início agora
        </button>

        {pausado ? (
          <div className="okmodal__timer okmodal__timer--off">Sem pressa — feche quando quiser 🙂</div>
        ) : (
          <div className="okmodal__timer">
            <span className="okmodal__timerbar" style={{ animationDuration: `${DURACAO}s` }} />
            Voltando ao início em {restante}s
          </div>
        )}
      </div>
    </div>
  )
}
