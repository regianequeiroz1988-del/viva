import { useEffect, useRef, useState } from 'react'
import { exigirDeclaracao, declaracaoDoLigador, marcarPendenciaLigador, regularizarLigador, dispensarDeclaracaoLigador } from '../lib/declaracao.js'
import { formatBRL } from '../utils/format.js'

// Botão da declaração de valores, dentro da ficha do ligador (por CPF).
// Cinza = aguardando o ganhador · Verde = pronto pra verificar · Vermelho pulsando = pendente
// · Verde = liberar · Verde fixo = CPF liberado · Recusou = o ganhador não quer o prêmio.
export default function BotaoDeclaracao({ cpf }) {
  const [ativo, setAtivo] = useState(false)
  const [d, setD] = useState(null)
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState('')
  const vivo = useRef(true)

  useEffect(() => {
    vivo.current = true
    return () => { vivo.current = false }
  }, [])

  useEffect(() => {
    if (!cpf) return
    let parou = false
    exigirDeclaracao().then((v) => { if (!parou && vivo.current) setAtivo(v) })
    return () => { parou = true }
  }, [cpf])

  const carregar = async () => {
    const r = await declaracaoDoLigador(cpf)
    if (vivo.current && r) setD(r)
  }

  // Atualiza sozinho enquanto o card estiver na tela (o ganhador envia → o botão fica verde).
  useEffect(() => {
    if (!ativo || !cpf) return
    carregar()
    const id = setInterval(() => {
      if (d?.estado === 'regularizado' || d?.estado === 'recusou') return
      carregar()
    }, 4000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ativo, cpf, d?.estado])

  if (!ativo || !cpf || !d) return null

  const acao = async (fn) => {
    setBusy(true)
    setErro('')
    try {
      await fn(cpf)
      await carregar()
    } catch (e) {
      setErro(e.message || 'Não foi possível atualizar agora.')
    }
    setBusy(false)
  }

  const { estado, tevePendencia, contas } = d

  const dispensar = () => {
    if (!window.confirm('Liberar este CPF sem a declaração de valores? O ganhador recebe o código de resgate sem declarar.')) return
    acao(dispensarDeclaracaoLigador)
  }

  return (
    <div className={`decl-ficha decl-ficha--${estado}`}>
      <span className="decl-ficha__rotulo">Declaração de valores</span>

      {estado === 'aguardando' && (
        <button type="button" className="decl-ficha__btn decl-ficha__btn--cinza" disabled>
          Aguardando o ganhador declarar
        </button>
      )}

      {estado === 'recusou' && (
        <p className="decl-ficha__aviso">O ganhador não quer receber o prêmio.</p>
      )}

      {estado === 'enviada' && (
        <div className="decl-ficha__linha">
          <button
            type="button"
            className="decl-ficha__btn decl-ficha__btn--verde"
            disabled={busy}
            onClick={() => acao(tevePendencia ? regularizarLigador : marcarPendenciaLigador)}
          >
            {tevePendencia ? 'Liberar CPF' : 'Verificar declaração'}
          </button>
          {tevePendencia && (
            <button type="button" className="decl-ficha__btn decl-ficha__btn--contorno" disabled={busy} onClick={() => acao(marcarPendenciaLigador)}>
              Notificar que ainda há pendência
            </button>
          )}
        </div>
      )}

      {estado === 'pendente' && (
        <button type="button" className="decl-ficha__btn decl-ficha__btn--vermelho" disabled>
          Valores pendentes · aguardando o ganhador
        </button>
      )}

      {estado === 'regularizado' && (
        <button type="button" className="decl-ficha__btn decl-ficha__btn--liberado" disabled>
          ✓ CPF liberado
        </button>
      )}

      {(estado === 'enviada' || estado === 'pendente' || estado === 'regularizado') && contas.length > 0 && (
        <ul className="decl-ficha__contas">
          {contas.map((c, i) => (
            <li key={i}>
              <span>{c.nome} <small>({c.codigo})</small></span>
              <strong>{formatBRL(Number(String(c.saldo).replace(',', '.')) || 0)}</strong>
            </li>
          ))}
        </ul>
      )}

      {(estado === 'enviada' || estado === 'pendente' || estado === 'regularizado') && (
        <p className="decl-ficha__cartao">
          Cartão de crédito: {d.temCartao ? (d.cartaoDivida ? 'sim, com dívida' : 'sim, sem dívida') : 'não'}
          {' · '}Cheque especial/empréstimo: {d.temCheque ? 'sim' : 'não'}
        </p>
      )}

      {(estado === 'aguardando' || estado === 'enviada' || estado === 'pendente') && (
        <button type="button" className="decl-ficha__btn decl-ficha__btn--contorno" disabled={busy} onClick={dispensar}>
          Dispensar declaração deste ganhador
        </button>
      )}

      {erro && <p className="decl-ficha__erro" role="alert">{erro}</p>}
    </div>
  )
}
