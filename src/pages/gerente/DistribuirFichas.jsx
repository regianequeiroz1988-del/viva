import { useMemo, useState } from 'react'
import { enviarFichas } from '../../lib/gerente.js'
import { formatBRL } from '../../utils/format.js'

const TIPOS = [
  ['todos', 'Todas'],
  ['pago', 'Pagos'],
  ['pendente', 'Pendentes'],
  ['cadastro', 'Só cadastro'],
]
const ROTULO = { pago: 'Pago', pendente: 'Pendente', cadastro: 'Só cadastro' }
const PILL = { pago: 'lig-pill--b', pendente: 'lig-pill--a', cadastro: 'ger__pill-cad' }

const fmtTel = (t) => {
  const d = String(t || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '')
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return t || '—'
}
const fmtData = (iso) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

export default function DistribuirFichas({ estoque, ligadores, onEnviado }) {
  const [filtro, setFiltro] = useState('todos')
  const [sel, setSel] = useState(() => new Set())
  const [ligador, setLigador] = useState('')
  const [qtd, setQtd] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [erro, setErro] = useState('')

  const lista = useMemo(
    () => (estoque || []).filter((f) => filtro === 'todos' || f.tipo === filtro),
    [estoque, filtro]
  )
  const chave = (f) => `${f.tipo === 'cadastro' ? 'c' : 'p'}:${f.id}`
  const ativos = (ligadores || []).filter((l) => l.ativo !== false)
  const todosSel = lista.length > 0 && lista.every((f) => sel.has(chave(f)))
  const escolhidas = (estoque || []).filter((f) => sel.has(chave(f)))

  const alternar = (f) => setSel((s) => {
    const n = new Set(s)
    const k = chave(f)
    if (n.has(k)) n.delete(k)
    else n.add(k)
    return n
  })
  const alternarTodos = () => setSel(todosSel ? new Set() : new Set(lista.map(chave)))
  const primeiros = (e) => {
    e.preventDefault()
    const n = Math.max(0, Math.min(lista.length, Number(qtd) || 0))
    setSel(new Set(lista.slice(0, n).map(chave)))
  }

  const enviar = async () => {
    setErro('')
    setMsg('')
    const repetidas = escolhidas.filter((f) => Number(f.ordem) > 1)
    if (repetidas.length && !window.confirm(`Fichas repetidas:
${repetidas.map((f) => `• ${f.nome || 'Sem nome'} — ${f.ordem}ª ficha deste cliente`).join('\n')}

Enviar mesmo assim?`)) return
    setBusy(true)
    const r = await enviarFichas(ligador, escolhidas)
    setBusy(false)
    if (!r.ok) { setErro(r.error || 'Não foi possível enviar.'); return }
    const nome = ativos.find((l) => l.id === ligador)
    setMsg(`${r.enviadas} ficha(s) enviada(s) para ${nome?.nome || nome?.usuario || 'o ligador'}.`)
    setTimeout(() => setMsg(''), 4000)
    setSel(new Set())
    onEnviado()
  }

  if (estoque === null) return <p className="usr-muted">Carregando…</p>
  if (!estoque.length) return <p className="usr-muted">Você não tem fichas no estoque. Peça mais ao admin.</p>

  return (
    <div className="ger__dist">
      <div className="adm__filtros">
        {TIPOS.map(([t, label]) => (
          <button key={t} type="button" className={`adm__chip ${filtro === t ? 'is-active' : ''}`} onClick={() => setFiltro(t)}>
            {label} ({t === 'todos' ? estoque.length : estoque.filter((f) => f.tipo === t).length})
          </button>
        ))}
      </div>

      <div className="ger__selrow">
        <label className="ger__check">
          <input type="checkbox" checked={todosSel} onChange={alternarTodos} />
          Selecionar todas ({lista.length})
        </label>
        <form className="ger__prim" onSubmit={primeiros}>
          <span>Selecionar as primeiras</span>
          <input type="number" min={1} max={lista.length} placeholder="qtd" value={qtd} onChange={(e) => setQtd(e.target.value)} />
          <button type="submit" className="adm__btn" disabled={!qtd}>Selecionar</button>
        </form>
      </div>

      <div className="ger__lista">
        {lista.map((f) => (
          <label key={chave(f)} className={`ger__ficha ${sel.has(chave(f)) ? 'is-sel' : ''}`}>
            <input type="checkbox" checked={sel.has(chave(f))} onChange={() => alternar(f)} />
            <span className="ger__ficha-nome">
              <strong>{f.nome || 'Sem nome'}</strong>
              <small>{fmtTel(f.telefone)}{f.cidade ? ` · ${f.cidade}${f.uf ? `/${f.uf}` : ''}` : ''}</small>
            </span>
            <span className="ger__ficha-info">
              <span className={`lig-pill ${PILL[f.tipo]}`}>{ROTULO[f.tipo]}</span>
              <small>{f.total != null ? `${formatBRL(Number(f.total))} · ` : ''}{fmtData(f.created_at)}</small>
              {Number(f.ordem) > 1 && <small className="ficha-rep">{f.ordem}ª ficha deste cliente</small>}
            </span>
          </label>
        ))}
      </div>

      {sel.size > 0 && (
        <div className="ger__barra">
          <strong>{sel.size} selecionada(s)</strong>
          <select value={ligador} onChange={(e) => setLigador(e.target.value)} disabled={!ativos.length}>
            <option value="">{ativos.length ? 'Enviar para o ligador…' : 'Nenhum ligador seu'}</option>
            {ativos.map((l) => <option key={l.id} value={l.id}>{l.nome || l.usuario} · {l.a_ligar} a ligar</option>)}
          </select>
          <button type="button" className="adm__btn adm__btn--primary" disabled={busy || !ligador} onClick={enviar}>
            {busy ? 'Enviando…' : 'Enviar'}
          </button>
          <button type="button" className="adm__btn adm__btn--ghost" onClick={() => setSel(new Set())}>Limpar</button>
        </div>
      )}
      {msg && <p className="usr-status">{msg}</p>}
      {erro && <p className="auth__erro">{erro}</p>}
    </div>
  )
}
