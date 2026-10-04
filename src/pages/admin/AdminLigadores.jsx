import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase.js'

export default function AdminLigadores() {
  const [rows, setRows] = useState(null)
  const [usuario, setUsuario] = useState('')
  const [senha, setSenha] = useState('')
  const [nome, setNome] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [erro, setErro] = useState('')

  const carregar = async () => {
    const { data, error } = await supabase.rpc('listar_ligadores')
    if (error) setErro(error.message)
    setRows(data || [])
  }
  useEffect(() => { carregar() }, [])

  const criar = async (e) => {
    e.preventDefault()
    setErro(''); setMsg('')
    if (!usuario.trim() || !senha) { setErro('Usuário e senha são obrigatórios.'); return }
    setBusy(true)
    const { error } = await supabase.rpc('criar_ligador', { p_usuario: usuario.trim(), p_senha: senha, p_nome: nome.trim() })
    setBusy(false)
    if (error) { setErro(/duplicate|unique/i.test(error.message) ? 'Já existe um ligador com esse usuário.' : error.message); return }
    setUsuario(''); setSenha(''); setNome('')
    setMsg('Ligador criado!')
    setTimeout(() => setMsg(''), 2500)
    carregar()
  }

  const remover = async (id, u) => {
    if (!window.confirm(`Remover o ligador "${u}"? Os pedidos dele voltam para o fluxo.`)) return
    const { error } = await supabase.rpc('remover_ligador', { p_id: id })
    if (error) { setErro(error.message); return }
    carregar()
  }

  return (
    <div>
      <header className="adm__pagehead">
        <div>
          <h1 className="adm__title">Ligadores</h1>
          <p className="adm__subtitle">{rows ? `${rows.length} ligador(es)` : 'Carregando…'}</p>
        </div>
      </header>

      {erro && <p className="auth__erro">{erro}</p>}

      <div className="adm__panel">
        <h2 className="adm__panel-title">Novo ligador</h2>
        <p className="usr-muted">
          Crie um login (usuário + senha) para o operador acessar o painel em <code>/ligador</code>.
          Depois, em <strong>Pedidos</strong>, use "Enviar pro ligador" pra direcionar os cards.
        </p>
        <form className="lig-form" onSubmit={criar}>
          <input placeholder="Usuário" value={usuario} onChange={(e) => setUsuario(e.target.value)} autoComplete="off" />
          <input placeholder="Nome (opcional)" value={nome} onChange={(e) => setNome(e.target.value)} />
          <input placeholder="Senha" type="text" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="off" />
          <button className="adm__btn adm__btn--primary" disabled={busy}>{busy ? 'Criando…' : 'Criar'}</button>
        </form>
        {msg && <p className="usr-status">{msg}</p>}
      </div>

      <div className="adm__panel">
        <h2 className="adm__panel-title">Ligadores cadastrados</h2>
        {rows === null ? (
          <p className="usr-muted">Carregando…</p>
        ) : rows.length === 0 ? (
          <p className="usr-muted">Nenhum ligador ainda.</p>
        ) : (
          <div className="lig-tab">
            {rows.map((l) => (
              <div key={l.id} className="lig-row">
                <div className="lig-row__id"><strong>{l.usuario}</strong>{l.nome ? ` · ${l.nome}` : ''}</div>
                <div className="lig-row__stats">
                  <span className="usr-muted">{l.total} no total</span>
                  <span className="lig-pill lig-pill--a">{l.a_ligar} a ligar</span>
                  <span className="lig-pill lig-pill--a">{l.retorno} retorno</span>
                  <span className="lig-pill lig-pill--b">{l.bom} bom</span>
                  <span className="lig-pill lig-pill--r">{l.ruim} ruim</span>
                </div>
                <button className="adm__btn adm__btn--ghost" onClick={() => remover(l.id, l.usuario)}>Remover</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
