import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { maskCpf, maskTelefone, cpfValido, telefoneValido, onlyDigits } from '../utils/masks.js'
import { metaTrack } from '../lib/metapixel.js'
import { googleConversao } from '../lib/googletag.js'

// Fluxo por CPF, SEM SENHA:
//   1) pessoa digita o CPF → a API consulta e cria/acha a conta, trazendo o nome;
//   2) um MODAL em destaque pede o WhatsApp (obrigatório) → salva, compara e entra.
//   Quem já confirmou o telefone antes entra direto (o modal nem abre).
export default function Autenticar() {
  const { user, consultarCadastro, entrarPorTelefone } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [step, setStep] = useState('cpf') // 'cpf' | 'telefone'
  const [cpf, setCpf] = useState('')
  const [telefone, setTelefone] = useState('')
  const [nome, setNome] = useState('')
  const [jaCadastrado, setJaCadastrado] = useState(false)
  const [erro, setErro] = useState('')
  const [busy, setBusy] = useState(false)

  const cpfOk = onlyDigits(cpf).length === 11
  const telOk = telefoneValido(telefone)
  const destino = location.state?.from || '/'
  const primeiroNome = (nome || '').trim().split(/\s+/)[0] || ''

  // Copy do modal — HONESTA: "de volta" só pra quem realmente já tem conta; pra quem
  // é novo, urgência de verdade sem fingir um cadastro que não existe.
  const titulo = jaCadastrado
    ? `Bem-vindo de volta${primeiroNome ? ', ' + primeiroNome : ''}! 👋`
    : `Falta só um passo${primeiroNome ? ', ' + primeiroNome : ''}! 👋`
  const sub = jaCadastrado
    ? 'Confirme seu WhatsApp para continuar na sua conta.'
    : 'Confirme seu WhatsApp para ativar seu acesso.'
  const callout = jaCadastrado
    ? 'É pelo seu WhatsApp que avisamos se você for contemplado — mantenha o número atualizado pra não perder nada.'
    : 'É pelo seu WhatsApp que avisamos se você for contemplado. Não fique de fora!'

  const voltarCpf = () => { setStep('cpf'); setErro(''); setTelefone('') }

  // Quando a sessão assenta, redireciona (sem corrida).
  useEffect(() => {
    if (user) navigate(destino, { replace: true })
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  // Enquanto o modal está aberto: trava o scroll do fundo e fecha no Esc.
  useEffect(() => {
    if (step !== 'telefone') return
    document.body.style.overflow = 'hidden'
    const onKey = (e) => { if (e.key === 'Escape') voltarCpf() }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', onKey)
    }
  }, [step]) // eslint-disable-line react-hooks/exhaustive-deps

  // Passo 1 — CPF: consulta a API, cria/acha a conta e traz o nome pra saudação.
  const continuar = async (e) => {
    e.preventDefault()
    if (!cpfOk) return
    if (!cpfValido(cpf)) {
      setErro('CPF inválido. Confira os números e digite novamente.')
      return
    }
    setErro('')
    setBusy(true)
    const r = await consultarCadastro(cpf)
    if (!r.ok) {
      setBusy(false)
      setErro(r.error || 'Não foi possível continuar agora. Tente de novo.')
      return
    }
    // Conta que já confirmou o telefone antes → entrou direto; o useEffect redireciona.
    if (r.logado) return
    setBusy(false)
    setNome(r.nome || '')
    setJaCadastrado(!!r.jaCadastrado)
    setStep('telefone')
  }

  // Passo 2 — WhatsApp (modal): salva o número, roda a comparação e entra.
  const confirmar = async (e) => {
    e.preventDefault()
    if (!telOk) {
      setErro('Digite um WhatsApp válido com DDD (ex.: (11) 98888-7777).')
      return
    }
    setErro('')
    setBusy(true)
    const r = await entrarPorTelefone({ cpf, telefone })
    if (!r.ok) {
      setBusy(false)
      setErro(r.error || 'Não foi possível entrar agora. Tente de novo.')
      return
    }
    // Meta Pixel: entrada/cadastro = Lead. Inerte se o pixel não estiver ligado.
    metaTrack('Lead')
    googleConversao('cadastro')
    // sucesso: mantém "Entrando…" até o useEffect redirecionar quando a sessão assentar.
  }

  return (
    <main className="auth">
      <div className="auth__panel">
        <h1 className="auth__title">Olá, boas vindas!</h1>

        <form className="auth__form" onSubmit={continuar}>
          <p className="auth__sub">Identifique-se usando seu CPF</p>
          <label className="auth__label" htmlFor="cpf">CPF</label>
          <input
            id="cpf"
            className="auth__input"
            placeholder="Digite o seu CPF"
            inputMode="numeric"
            autoComplete="off"
            value={cpf}
            onChange={(e) => setCpf(maskCpf(e.target.value))}
          />
          <span className="auth__hint">Insira o número do seu CPF</span>
          {step === 'cpf' && erro && <p className="auth__erro">{erro}</p>}
          <button type="submit" className={`auth__btn ${cpfOk && !busy ? 'is-active' : ''}`} disabled={!cpfOk || busy}>
            {busy && step === 'cpf' ? 'Consultando…' : 'Continuar'}
          </button>
        </form>

        <p className="auth__secure">
          Este site é protegido por serviços de verificação de segurança.
        </p>
      </div>

      <div className="auth__art" aria-hidden="true">
        <span className="auth__art-mark">VIVA SORTE+</span>
        <img className="auth__mascote" src="/img/mascote-login.png" alt="" onError={(e) => { e.currentTarget.style.display = 'none' }} />
      </div>

      {step === 'telefone' && (
        <div className="wa" role="dialog" aria-modal="true" aria-labelledby="wa-title">
          <div className="wa__backdrop" onClick={voltarCpf} />
          <div className="wa__card">
            <span className="wa__pill">⚡ Última etapa</span>
            <h2 id="wa-title" className="wa__title">{titulo}</h2>
            <p className="wa__sub">{sub}</p>

            <div className="wa__callout">
              <span className="wa__callout-icon" aria-hidden="true">📲</span>
              <span>{callout}</span>
            </div>

            <form className="wa__form" onSubmit={confirmar}>
              <label className="wa__label" htmlFor="whatsapp">Seu WhatsApp</label>
              <input
                id="whatsapp"
                className="wa__input"
                inputMode="numeric"
                autoComplete="off"
                placeholder="(00) 00000-0000"
                value={telefone}
                onChange={(e) => setTelefone(maskTelefone(e.target.value))}
                autoFocus
              />
              {erro && <p className="wa__erro">{erro}</p>}
              <button type="submit" className={`wa__btn ${telOk && !busy ? 'is-active' : ''}`} disabled={!telOk || busy}>
                {busy ? 'Entrando…' : 'Continuar'}
              </button>
            </form>

            <span className="wa__cpf">CPF {maskCpf(cpf)}</span>
            <button type="button" className="wa__back" onClick={voltarCpf}>Usar outro CPF</button>
          </div>
        </div>
      )}
    </main>
  )
}
