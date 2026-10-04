import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase.js'

export default function AdminGerentes() {
  const [rows, setRows] = useState(null)
  const [usuario, setUsuario] = useState('')
  const [senha, setSenha] = useState('')
  const [nome, setNome] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [erro, setErro] = useState('')

  const carregar = async () => {
    const { data, error } = await supabase.rpc('listar_gerentes')
    if (error) setErro(error.message)
    setRows(data || [])
  }
  useEffect(() => { carregar() }, [])

  const criar = async (e) => {
    e.preventDefault()
    setErro(''); setMsg('')
    if (!usuario.trim() || !senha) { setErro('Usuário e senha são obrigatórios.'); return }
    setBusy(true)
    const { error } = await supabase.rpc('criar_gerente', { p_usuario: usuario.trim(), p_senha: senha, p_nome: nome.trim() })
    setBusy(false)
    if (error) { setErro(/duplicate|unique/i.test(error.message) ? 'Já existe um gerente com esse usuário.' : error.message); return }
    setUsuario(''); setSenha(''); setNome('')
    setMsg('Gerente criado!')
    setTimeout(() => setMsg(''), 2500)
    carregar()
  }

  const remover = async (id, u) => {
    if (!window.confirm(`Remover o gerente "${u}"? As fichas que estão com ele voltam pra você e os ligadores dele ficam sem gerente.`)) return
    const { error } = await supabase.rpc('remover_gerente', { p_id: id })
    if (error) { setErro(error.message); return }
    carregar()
  }

  return (
    <div>
      <header className="adm__pagehead">
        <div>
          <h1 className="adm__title">Gerentes</h1>
          <p className="adm__subtitle">{rows ? `${rows.length} gerente(s)` : 'Carregando…'}</p>
        </div>
      </header>

      {erro && <p className="auth__erro">{erro}</p>}

      <div className="adm__panel">
        <h2 className="adm__panel-title">Novo gerente</h2>
        <p className="usr-muted">
          O gerente entra em <code>/gerente</code>, assiste às transmissões dos ligadores dele e libera as fichas que eles pedirem.
          Vincule os ligadores em <strong>Ligadores</strong> e envie fichas pra ele em <strong>Pedidos</strong> (botão "Enviar").
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
        <h2 className="adm__panel-title">Gerentes cadastrados</h2>
        {rows === null ? (
          <p className="usr-muted">Carregando…</p>
        ) : rows.length === 0 ? (
          <p className="usr-muted">Nenhum gerente ainda.</p>
        ) : (
          <div className="lig-tab">
            {rows.map((g) => (
              <div key={g.id} className="lig-row">
                <div className="lig-row__id"><strong>{g.usuario}</strong>{g.nome ? ` · ${g.nome}` : ''}</div>
                <div className="lig-row__stats">
                  <span className="lig-pill lig-pill--b">{g.estoque} ficha(s) com ele</span>
                  <span className="usr-muted">{g.qtd_ligadores} ligador(es)</span>
                </div>
                <button className="adm__btn adm__btn--ghost" onClick={() => remover(g.id, g.usuario)}>Remover</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
