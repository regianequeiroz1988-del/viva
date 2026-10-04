import { useEffect, useState } from 'react'

const SESSION_KEY = 'vs_idade_confirmada'

// Presell simples exibido antes de qualquer conteúdo do site: pergunta se a
// pessoa é maior de 18 anos. "Sim" libera a tela principal (guardado na
// sessão). "Não" bloqueia o acesso e fecha a aba após alguns segundos.
export default function AgeGate({ children }) {
  const [status, setStatus] = useState(() => (
    sessionStorage.getItem(SESSION_KEY) === '1' ? 'ok' : 'pending'
  ))
  const [contador, setContador] = useState(5)

  useEffect(() => {
    if (status !== 'ok') {
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = '' }
    }
  }, [status])

  useEffect(() => {
    if (status !== 'negado') return
    if (contador <= 0) {
      window.location.href = 'https://www.google.com'
      window.close()
      return
    }
    const t = setTimeout(() => setContador((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [status, contador])

  const confirmar = () => {
    sessionStorage.setItem(SESSION_KEY, '1')
    setStatus('ok')
  }

  const negar = () => setStatus('negado')

  if (status === 'ok') return children

  return (
    <div className="agegate" role="dialog" aria-modal="true" aria-labelledby="agegate-title">
      <div className="agegate__card">
        {status === 'pending' && (
          <>
            <h1 id="agegate-title" className="agegate__title">Você é maior de 18 anos?</h1>
            <div className="agegate__actions">
              <button type="button" className="agegate__btn agegate__btn--sim" onClick={confirmar}>
                Sim
              </button>
              <button type="button" className="agegate__btn agegate__btn--nao" onClick={negar}>
                Não
              </button>
            </div>
          </>
        )}

        {status === 'negado' && (
          <>
            <h1 id="agegate-title" className="agegate__title">Acesso restrito a maiores de 18 anos</h1>
            <p className="agegate__sub">Esta janela será fechada em {contador}s.</p>
          </>
        )}
      </div>
    </div>
  )
}
