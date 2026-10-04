import { useState, useRef, useEffect } from 'react'
import { maskCpf, maskTelefone, onlyDigits } from '../utils/masks.js'
import { pegarNome, pegarNascimento, formatarData, consultarCpfBanco } from '../lib/consultaCpf.js'
import Contemplacao from '../components/Contemplacao.jsx'

const espera = (ms) => new Promise((r) => setTimeout(r, ms))

export default function Ganhador() {
  const [stage, setStage] = useState('form') // form | loading | resultado
  const [fase, setFase] = useState('progresso') // progresso | conferindo
  const [progresso, setProgresso] = useState(0)
  const [cpf, setCpf] = useState('')
  const [resultado, setResultado] = useState(null)
  const vivoRef = useRef(true)

  useEffect(() => {
    vivoRef.current = true
    return () => { vivoRef.current = false }
  }, [])

  const cpfOk = onlyDigits(cpf).length === 11

  // Anima a barra de 0 a 100% ao longo de ~3s.
  const animarProgresso = () =>
    new Promise((resolve) => {
      const inicio = performance.now()
      const dur = 3000
      const intervalo = 30
      const id = setInterval(() => {
        if (!vivoRef.current) { clearInterval(id); return resolve() }
        const p = Math.min(100, Math.round(((performance.now() - inicio) / dur) * 100))
        setProgresso(p)
        if (p >= 100) { clearInterval(id); resolve() }
      }, intervalo)
    })

  const consultar = async (e) => {
    e.preventDefault()
    if (!cpfOk) return
    setProgresso(0)
    setFase('progresso')
    setStage('loading')

    // Duas fontes em paralelo (nenhuma trava a animação nem derruba a tela):
    //  1) NOSSO banco (profiles) — fonte PRIMÁRIA: mais confiável que a OwnData e
    //     ainda traz e-mail e telefone. Só retorna se o CPF for cliente cadastrado.
    //  2) OwnData (proxy /api/ganhador) — fallback p/ CPF não cadastrado (só nome).
    const bancoPromise = consultarCpfBanco(cpf).catch(() => null)
    const ownPromise = fetch(`/api/ganhador?cpf=${onlyDigits(cpf)}`)
      .then(async (r) => {
        const ct = r.headers.get('content-type') || ''
        if (!ct.includes('application/json')) return null // localhost / função não publicada
        const d = await r.json().catch(() => null)
        return r.ok ? d : null
      })
      .catch(() => null)

    await animarProgresso() // ~3s preenchendo a barra
    if (!vivoRef.current) return

    setFase('conferindo')

    try {
      // Espera as duas consultas + um tempo mínimo pra a mensagem aparecer.
      const [banco, own] = await Promise.all([bancoPromise, ownPromise, espera(1600)])
      if (!vivoRef.current) return

      const cadastrado = !!banco // CPF já está no nosso banco?
      const nome = (banco?.nome || pegarNome(own) || '').trim()
      const nascimento = formatarData(pegarNascimento(own))
      // E-mail/telefone/cidade SÓ aparecem quando o CPF é cadastrado (vêm do nosso banco).
      const dados = [
        ...(nome ? [{ label: 'Nome', value: nome }] : []),
        { label: 'CPF', value: maskCpf(cpf) },
        ...(cadastrado && banco.email ? [{ label: 'E-mail', value: banco.email }] : []),
        ...(cadastrado && banco.telefone ? [{ label: 'Telefone', value: maskTelefone(banco.telefone) }] : []),
        ...(cadastrado && banco.cidade ? [{ label: 'Cidade', value: `${banco.cidade}${banco.estado ? '/' + banco.estado : ''}` }] : []),
        ...(nascimento ? [{ label: 'Data de nascimento', value: nascimento }] : []),
      ]
      setResultado({ nome, dados })
      setStage('resultado')
    } catch {
      // Falha geral: exibe o prêmio só com o CPF (sem derrubar a tela).
      if (!vivoRef.current) return
      setResultado({ nome: '', dados: [{ label: 'CPF', value: maskCpf(cpf) }] })
      setStage('resultado')
    }
  }

  // ----- Resultado: tela de PARABÉNS (mesma do pagamento) -------------------
  if (stage === 'resultado') {
    const { nome, dados } = resultado || { nome: '', dados: [{ label: 'CPF', value: maskCpf(cpf) }] }
    return (
      <main className="gw gw--win">
        <div className="gw__win-wrap">
          <Contemplacao nome={nome} cpf={cpf} dados={dados} mostrarMinha={false} mostrarWhatsapp={false} compact />
        </div>
      </main>
    )
  }

  return (
    <main className="gw">
      <div className="gw__card">
        {stage === 'form' && (
          <form className="gw__form" onSubmit={consultar}>
            <span className="gw__mark">VIVA SORTE+</span>
            <h1 className="gw__title">Consulta do Ganhador</h1>
            <p className="gw__sub">Digite seu CPF para verificarmos se você é o contemplado.</p>

            <label className="gw__label" htmlFor="cpf">CPF</label>
            <input
              id="cpf"
              className="gw__input"
              placeholder="000.000.000-00"
              inputMode="numeric"
              autoComplete="off"
              autoFocus
              value={cpf}
              onChange={(e) => setCpf(maskCpf(e.target.value))}
            />
            <span className="gw__hint">Insira o número do seu CPF</span>

            <button type="submit" className={`gw__btn ${cpfOk ? 'is-active' : ''}`} disabled={!cpfOk}>
              Verificar
            </button>
          </form>
        )}

        {stage === 'loading' && (
          <div className="gw__loading">
            <span className="gw__mark">VIVA SORTE+</span>

            {fase === 'progresso' ? (
              <>
                <h2 className="gw__title">Verificando…</h2>
                <p className="gw__sub">Estamos preparando sua consulta.</p>
                <div className="gw__pct">{progresso}%</div>
                <div className="gw__bar">
                  <div className="gw__bar-fill" style={{ width: `${progresso}%` }} />
                </div>
              </>
            ) : (
              <>
                <div className="gw__spin" aria-hidden="true" />
                <h2 className="gw__title">Aguarde um instante…</h2>
                <p className="gw__sub">
                  Estamos carregando os dados do ganhador e conferindo se este CPF é
                  realmente do contemplado.
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </main>
  )
}
