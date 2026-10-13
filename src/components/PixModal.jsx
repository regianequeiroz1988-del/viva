import { useState } from 'react'

// Modal em que o ganhador informa a chave Pix pra receber o prêmio.
// Etapas: escolher tipo + digitar → conferir os dados → confirmação final.
const TIPOS = [
  { id: 'cpf', label: 'CPF', placeholder: '000.000.000-00', mode: 'numeric' },
  { id: 'telefone', label: 'Telefone', placeholder: '(00) 00000-0000', mode: 'tel' },
  { id: 'email', label: 'E-mail', placeholder: 'seuemail@exemplo.com', mode: 'email' },
  { id: 'cnpj', label: 'CNPJ', placeholder: '00.000.000/0000-00', mode: 'numeric' },
  { id: 'aleatoria', label: 'Aleatória', placeholder: '00000000-0000-0000-0000-000000000000', mode: 'text' },
]

const dig = (v) => String(v || '').replace(/\D/g, '')
const fmtCpf = (v) => {
  const d = dig(v).slice(0, 11)
  return [d.slice(0, 3), d.slice(3, 6), d.slice(6, 9)].filter(Boolean).join('.') + (d.length > 9 ? `-${d.slice(9)}` : '')
}
const fmtCnpj = (v) => {
  const d = dig(v).slice(0, 14)
  let s = d.slice(0, 2)
  if (d.length > 2) s += `.${d.slice(2, 5)}`
  if (d.length > 5) s += `.${d.slice(5, 8)}`
  if (d.length > 8) s += `/${d.slice(8, 12)}`
  if (d.length > 12) s += `-${d.slice(12)}`
  return s
}
const fmtTel = (v) => {
  let d = dig(v)
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2)
  d = d.slice(0, 11)
  if (d.length <= 2) return d.length ? `(${d}` : ''
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}
const hex = (v) => String(v || '').toLowerCase().replace(/[^0-9a-f]/g, '')
const fmtAleatoria = (v) => {
  const h = hex(v).slice(0, 32)
  return [h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20)].filter(Boolean).join('-')
}
const formatar = (tipo, v) => {
  if (tipo === 'cpf') return fmtCpf(v)
  if (tipo === 'cnpj') return fmtCnpj(v)
  if (tipo === 'telefone') return fmtTel(v)
  if (tipo === 'aleatoria') return fmtAleatoria(v)
  return String(v || '').replace(/\s/g, '').slice(0, 77)
}
const valida = (tipo, v) => {
  if (tipo === 'cpf') return dig(v).length === 11
  if (tipo === 'cnpj') return dig(v).length === 14
  if (tipo === 'telefone') return dig(v).length === 10 || dig(v).length === 11
  if (tipo === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)
  if (tipo === 'aleatoria') return hex(v).length === 32
  return false
}
const tipoLabel = (id) => TIPOS.find((x) => x.id === id)?.label || id

export default function PixModal({ nome, cpf, onClose, onConfirmado }) {
  const [tipo, setTipo] = useState('cpf')
  const [chave, setChave] = useState(fmtCpf(cpf))
  const [etapa, setEtapa] = useState('digitar') // digitar | conferir | pronto
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const [salvo, setSalvo] = useState(null)
  const t = TIPOS.find((x) => x.id === tipo)
  const ok = valida(tipo, chave)

  const trocarTipo = (id) => {
    setTipo(id)
    setChave(id === 'cpf' ? fmtCpf(cpf) : '')
    setErro('')
  }

  const confirmar = async () => {
    setEnviando(true)
    setErro('')
    try {
      const r = await fetch('/api/ganhador?acao=pix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cpf: dig(cpf), tipo, chave }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Não foi possível salvar a chave Pix.')
      const tp = j.tipo || tipo
      setSalvo({ tipo: tp, chave: j.chave ? formatar(tp, j.chave) : chave, jaInformada: j.jaInformada })
      setEtapa('pronto')
      onConfirmado?.()
    } catch (e) {
      setErro(e.message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="pixm" role="dialog" aria-modal="true" aria-label="Chave Pix para receber o prêmio">
      <div className="pixm__box">
        {etapa === 'digitar' && (
          <>
            <h3 className="pixm__title">💸 Para onde enviamos seu prêmio?</h3>
            <p className="pixm__sub">Escolha o tipo e informe sua chave Pix. A conta precisa estar no CPF <strong>{fmtCpf(cpf)}</strong>.</p>
            <div className="pixm__tipos">
              {TIPOS.map((x) => (
                <button key={x.id} type="button" className={`pixm__tipo ${tipo === x.id ? 'is-active' : ''}`} onClick={() => trocarTipo(x.id)}>
                  {x.label}
                </button>
              ))}
            </div>
            <label className="pixm__label" htmlFor="pixm-chave">Chave Pix ({t.label})</label>
            <input
              id="pixm-chave"
              className="pixm__input"
              inputMode={t.mode}
              type={tipo === 'email' ? 'email' : 'text'}
              autoComplete="off"
              placeholder={t.placeholder}
              value={chave}
              onChange={(e) => setChave(formatar(tipo, e.target.value))}
            />
            {chave && !ok && <span className="pixm__hint">Confira a chave: formato de {t.label} incompleto.</span>}
            <div className="pixm__acoes">
              <button type="button" className="pixm__btn pixm__btn--ghost" onClick={onClose}>Cancelar</button>
              <button type="button" className="pixm__btn" disabled={!ok} onClick={() => setEtapa('conferir')}>Continuar</button>
            </div>
          </>
        )}

        {etapa === 'conferir' && (
          <>
            <h3 className="pixm__title">Confira seus dados</h3>
            <dl className="pixm__dados">
              <div><dt>Nome</dt><dd>{nome || '—'}</dd></div>
              <div><dt>CPF</dt><dd>{fmtCpf(cpf)}</dd></div>
              <div><dt>Tipo de chave</dt><dd>{t.label}</dd></div>
              <div><dt>Chave Pix</dt><dd className="pixm__chave">{chave}</dd></div>
            </dl>
            {erro && <p className="pixm__erro">{erro}</p>}
            <div className="pixm__acoes">
              <button type="button" className="pixm__btn pixm__btn--ghost" onClick={() => setEtapa('digitar')} disabled={enviando}>Corrigir</button>
              <button type="button" className="pixm__btn" onClick={confirmar} disabled={enviando}>{enviando ? 'Enviando…' : 'Confirmar chave Pix'}</button>
            </div>
          </>
        )}

        {etapa === 'pronto' && salvo && (
          <>
            <div className="pixm__ok">✅</div>
            <h3 className="pixm__title">{salvo.jaInformada ? 'Sua chave Pix já está cadastrada' : 'Chave Pix confirmada!'}</h3>
            <dl className="pixm__dados">
              <div><dt>Nome</dt><dd>{nome || '—'}</dd></div>
              <div><dt>CPF</dt><dd>{fmtCpf(cpf)}</dd></div>
              <div><dt>Chave Pix ({tipoLabel(salvo.tipo)})</dt><dd className="pixm__chave">{salvo.chave}</dd></div>
            </dl>
            <p className="pixm__sucesso">💰 Assim que a nossa equipe liberar, o pagamento cai na sua conta <strong>em alguns minutos</strong>.</p>
            <div className="pixm__acoes">
              <button type="button" className="pixm__btn" onClick={onClose}>Fechar</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
