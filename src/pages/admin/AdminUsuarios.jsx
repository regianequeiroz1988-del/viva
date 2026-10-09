import { useEffect, useMemo, useState } from 'react'
import { useTravaScroll, useVoltarFecha } from '../../lib/useTravaScroll.js'
import { supabase } from '../../lib/supabase.js'
import { formatBRL } from '../../utils/format.js'
import { maskCpf, maskTelefone, onlyDigits } from '../../utils/masks.js'
import { Download, Search } from '../../components/Icons.jsx'
import { resumoPedido, calcularExportadoVoltou } from './pedidosAgrupados.js'

const CAMPOS = `id,nome,nome_social,cpf,email,telefone,nascimento,genero,cep,endereco,numero,bairro,cidade,estado,pontos,creditos_nao_sacaveis,saldo_saque,total_sacado,is_admin,origem,created_at`

// Origem do cadastro (UTM). "PROPRIO-..." = veio do NOSSO anúncio (só usado como tag na tabela).
const ehProprio = (o) => !!o && String(o).toUpperCase().startsWith('PROPRIO')
// Localização do pagamento (pela geo do IP) — mesma info que aparece no pedido pago.
const cidadeLabel = (p) => (p?.cidade ? `${p.cidade}${p.uf ? '/' + p.uf : ''}` : '—')
const dataCurta = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
}

// Atividade do cliente a partir dos pedidos: só cadastro / gerou pendente / comprou.
function statusCliente(p) {
  if (!p || !p.total) return { label: 'só cadastro', tipo: 'none' }
  return { label: `gerou ×${p.total}${p.pagos > 0 ? ` · pagou ×${p.pagos}` : ''}`, tipo: p.pagos > 0 ? 'pago' : 'pend' }
}
const STATUS_CORES = {
  none: { background: '#e5e7eb', color: '#4b5563' },
  pend: { background: '#fef3c7', color: '#92600a' },
  pago: { background: '#dcfce7', color: '#166534' },
  voltou: { background: '#fee2e2', color: '#b91c1c' },
}
function StatusTag({ p }) {
  const s = statusCliente(p)
  if (s.tipo === 'none') {
    return <span style={{ ...STATUS_CORES.none, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap' }}>{s.label}</span>
  }
  return (
    <span className="adm__activity-tags">
      <span style={{ ...STATUS_CORES.pend, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap' }}>gerou ×{p.total}</span>
      {p.pagos > 0 && <span style={{ ...STATUS_CORES.pago, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap' }}>pagou ×{p.pagos}</span>}
      {p.voltou && <span title={`Gerou/pagou de novo depois de exportado (${dataCurta(p.exportadoEm)})`} style={{ ...STATUS_CORES.voltou, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap' }}>🔁 voltou</span>}
    </span>
  )
}

// Busca TODOS os pedidos (campos p/ contar, listar pagamentos e detectar "voltou")
// em páginas de 1000 — o Supabase corta em 1000 por requisição.
async function fetchAllPedidos() {
  const out = []
  const size = 1000
  for (let from = 0; ; from += size) {
    const { data, error } = await supabase.from('pedidos')
      .select('user_id,status,total,created_at,cidade,uf,pix_banco,metodo,itens,exportado,exportado_at')
      .order('created_at', { ascending: false })
      .range(from, from + size - 1)
    if (error || !data?.length) break
    out.push(...data)
    if (data.length < size) break
  }
  return out
}

function baixarArquivo(nomeArquivo, conteudo) {
  const blob = new Blob([conteudo], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nomeArquivo
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function usuarioParaTexto(u) {
  const L = (k, v) => `${k}: ${v === 0 ? '0' : v || '—'}`
  const c = u._consulta || {}
  const p = u._pedidos || {}
  const linhas = [
    L('Nome', u.nome),
    L('CPF', u.cpf ? maskCpf(u.cpf) : ''),
    L('Telefone', u.telefone ? maskTelefone(u.telefone) : ''),
    L('Nascimento', c.nascimento || u.nascimento),
    L('Idade', c.idade),
    L('Sexo', c.sexo || u.genero),
    L('Cadastro', u.created_at ? new Date(u.created_at).toLocaleString('pt-BR') : '—'),
    '',
    `Pagamentos confirmados (${p.pagos || 0}):`,
  ]
  if (!p.pagosDetalhe?.length) {
    linhas.push('  — nenhum pagamento confirmado.')
  } else {
    p.pagosDetalhe.forEach((pg, i) => {
      linhas.push(`  ${i + 1}) ${dataCurta(pg.data)} · ${formatBRL(pg.valor)} · ${pg.sorteio || '—'} · ${cidadeLabel(pg)} · ${pg.banco || '—'}`)
    })
  }
  return linhas.join('\n')
}

export default function AdminUsuarios() {
  const [rows, setRows] = useState(null)
  const [erro, setErro] = useState('')
  const [busca, setBusca] = useState('')
  const [sel, setSel] = useState(null) // usuário aberto no detalhe
  const [filtroStatus, setFiltroStatus] = useState('todos') // todos | none | pend | pago
  const [atualizandoId, setAtualizandoId] = useState(null) // linha rodando a consulta agora
  const [feedback, setFeedback] = useState(null) // { id, tipo:'ok'|'erro', msg }
  // JSON bruto da última consulta (dados_consulta.raw) — carregado sob demanda no detalhe.
  // Serve pra conferir o que o provedor devolveu quando a extração não acha um campo.
  const [raw, setRaw] = useState(null) // { userId, json } | { userId, erro }
  const [rawBusy, setRawBusy] = useState(false)
  const [rawCopiado, setRawCopiado] = useState(false)

  const verRaw = async (userId) => {
    setRawBusy(true)
    setRawCopiado(false)
    const { data, error } = await supabase.from('dados_consulta').select('raw').eq('user_id', userId).maybeSingle()
    if (error) setRaw({ userId, erro: error.message })
    else setRaw({ userId, json: data?.raw ?? null })
    setRawBusy(false)
  }

  const copiarRaw = async () => {
    if (!raw?.json) return
    try {
      await navigator.clipboard.writeText(JSON.stringify(raw.json, null, 2))
      setRawCopiado(true)
      setTimeout(() => setRawCopiado(false), 2000)
    } catch { /* ignore */ }
  }

  useEffect(() => {
    ;(async () => {
      // Perfil + dados de consulta (OwnData) — mostra idade/profissão/score/renda no detalhe.
      const [perfis, cons, peds] = await Promise.all([
        supabase.from('profiles').select(CAMPOS).order('created_at', { ascending: false }),
        supabase.from('dados_consulta').select('user_id,nome,nascimento,idade,profissao,score,renda,sexo,telefones,telefone_confere'),
        fetchAllPedidos(),
      ])
      if (perfis.error) setErro(perfis.error.message)
      const cmap = {}
      ;(cons.data || []).forEach((c) => { cmap[c.user_id] = c })

      // Agrupa os pedidos por cliente p/ contar, listar TODOS os pagamentos
      // (data/hora, valor, local, banco, sorteio) e detectar "voltou".
      const porUsuario = {}
      ;(peds || []).forEach((p) => {
        ;(porUsuario[p.user_id] || (porUsuario[p.user_id] = [])).push(p)
      })
      const pmap = {}
      Object.entries(porUsuario).forEach(([userId, lista]) => {
        const historico = [...lista].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
        const pagos = historico.filter((p) => p.status === 'pago')
        const { exportadoEm, voltou } = calcularExportadoVoltou(historico)
        pmap[userId] = {
          total: historico.length,
          pagos: pagos.length,
          pendentes: historico.length - pagos.length,
          pagosDetalhe: pagos.map((p) => ({
            data: p.created_at,
            valor: p.total,
            cidade: p.cidade,
            uf: p.uf,
            banco: p.pix_banco,
            sorteio: resumoPedido(p).sorteioCurto,
          })),
          exportadoEm,
          voltou,
        }
      })
      const vazio = { total: 0, pagos: 0, pendentes: 0, pagosDetalhe: [], exportadoEm: null, voltou: false }
      setRows((perfis.data || []).map((r) => ({ ...r, _consulta: cmap[r.id] || null, _pedidos: pmap[r.id] || vazio })))
    })()
  }, [])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    const qd = onlyDigits(busca)
    if (!rows) return []
    const list = filtroStatus === 'todos' ? rows : rows.filter((r) => statusCliente(r._pedidos).tipo === filtroStatus)
    if (!q) return list
    return list.filter((r) => {
      const alvo = `${r.nome || ''} ${r.email || ''} ${r.cidade || ''}`.toLowerCase()
      const docs = `${onlyDigits(r.cpf)} ${onlyDigits(r.telefone)}`
      return alvo.includes(q) || (qd && docs.includes(qd))
    })
  }, [rows, busca, filtroStatus])

  const exportarTodos = () => {
    const data = new Date().toISOString().slice(0, 10)
    const cabecalho = `VIVA SORTE+ — Cadastros de clientes\nExportado em: ${new Date().toLocaleString('pt-BR')}\nTotal: ${filtrados.length} cliente(s)\n`
    const corpo = filtrados.map(usuarioParaTexto).join(`\n\n${'='.repeat(44)}\n\n`)
    baixarArquivo(`clientes-viva-sorte-${data}.txt`, `${cabecalho}\n${'='.repeat(44)}\n\n${corpo}\n`)
  }

  const exportarUm = (u) => {
    const nome = (u.nome || u.cpf || 'cliente').toString().replace(/[^\w-]+/g, '_').slice(0, 40)
    baixarArquivo(`cliente-${nome}.txt`, usuarioParaTexto(u))
  }

  // Visualização do TXT (mesmo conteúdo do export) sem precisar baixar o arquivo.
  const [txt, setTxt] = useState(null) // usuário cujo TXT está aberto
  useTravaScroll(!!sel || !!txt)
  useVoltarFecha(!!sel, () => setSel(null))
  useVoltarFecha(!!txt, () => setTxt(null))
  const [txtCopiado, setTxtCopiado] = useState(false)
  const copiarTxt = async () => {
    if (!txt) return
    try {
      await navigator.clipboard.writeText(usuarioParaTexto(txt))
      setTxtCopiado(true)
      setTimeout(() => setTxtCopiado(false), 2000)
    } catch { /* ignore */ }
  }

  // Re-roda a consulta (Serasa) do cliente e atualiza nome + enriquecimento.
  // Chama /api/admin/enriquecer com o token do admin logado (o endpoint confere is_admin).
  const atualizarCliente = async (r) => {
    if (atualizandoId) return
    setFeedback(null)
    setAtualizandoId(r.id)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) { setFeedback({ id: r.id, tipo: 'erro', msg: 'Sessão expirada — entre de novo.' }); return }
      const resp = await fetch('/api/admin/enriquecer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ userId: r.id }),
      })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok || data.ok === false) {
        setFeedback({ id: r.id, tipo: 'erro', msg: data.message || data.error || 'Não foi possível atualizar.' })
        return
      }
      // Atualiza a linha (e o detalhe, se aberto) em memória — sem recarregar tudo.
      const patch = (x) => ({
        ...x,
        nome: data.nome || x.nome,
        telefone: data.telefone || x.telefone, // preenchido pela Serasa só quando estava vazio
        _consulta: { ...(x._consulta || {}), ...(data.consulta || {}), user_id: r.id },
      })
      setRows((prev) => (prev || []).map((x) => (x.id === r.id ? patch(x) : x)))
      setSel((s) => (s && s.id === r.id ? patch(s) : s))
      setFeedback({ id: r.id, tipo: 'ok', msg: data.nome ? `Atualizado: ${data.nome}` : 'Consulta atualizada.' })
    } catch {
      setFeedback({ id: r.id, tipo: 'erro', msg: 'Falha de rede. Tente de novo.' })
    } finally {
      setAtualizandoId(null)
    }
  }

  return (
    <div>
      <header className="adm__pagehead">
        <div>
          <h1 className="adm__title">Usuários</h1>
          <p className="adm__subtitle">{rows ? `${filtrados.length} cliente(s) cadastrado(s)` : 'Carregando…'}</p>
        </div>
        <button className="adm__btn adm__btn--primary" onClick={exportarTodos} disabled={!filtrados.length}>
          <Download size={16} /> Exportar TXT
        </button>
      </header>

      {erro && <p className="auth__erro">{erro}</p>}

      <div className="adm__toolbar">
        <div className="adm__searchwrap">
          <Search size={16} />
          <input
            className="adm__search"
            placeholder="Buscar por nome, CPF, e-mail, telefone ou cidade…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        <div className="adm__filtros" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          {[['todos', 'Todos'], ['pago', 'Compraram'], ['pend', 'Só pendente'], ['none', 'Só cadastro']].map(([f, label]) => (
            <button key={f} className={`adm__chip ${filtroStatus === f ? 'is-active' : ''}`} onClick={() => setFiltroStatus(f)}>{label}</button>
          ))}
        </div>
      </div>

      <div className="adm__tablewrap">
        <table className="adm__table adm__table--cards">
          <thead>
            <tr>
              <th>Nome</th><th>CPF</th><th>Telefone</th><th>Cidade</th><th>Pontos</th><th>Cadastro</th><th></th>
            </tr>
          </thead>
          <tbody>
            {!rows ? (
              <tr><td colSpan="7">Carregando…</td></tr>
            ) : filtrados.length === 0 ? (
              <tr><td colSpan="7">Nenhum usuário encontrado.</td></tr>
            ) : (
              filtrados.map((r, i) => (
                <tr key={i}>
                  <td>{r.nome || '—'} <StatusTag p={r._pedidos} /> {r._consulta?.telefone_confere === false && <span title="Telefone cadastrado não bate com o puxado" style={{ color: '#dc2626', fontWeight: 700, fontSize: 11 }}>⚠️ tel</span>} {r.is_admin && <span className="adm__tag">admin</span>} {ehProprio(r.origem) && <span className="adm__tag">nosso anúncio</span>}</td>
                  <td data-label="CPF">{r.cpf ? maskCpf(r.cpf) : '—'}</td>
                  <td data-label="Telefone">{r.telefone ? maskTelefone(r.telefone) : '—'}</td>
                  <td data-label="Cidade">{[r.cidade, r.estado].filter(Boolean).join('/') || '—'}</td>
                  <td data-label="Pontos">{r.pontos ?? 0}</td>
                  <td data-label="Cadastro">{r.created_at ? new Date(r.created_at).toLocaleDateString('pt-BR') : '—'}</td>
                  <td className="adm__td-acoes">
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'flex-end', whiteSpace: 'nowrap' }}>
                      <button
                        className="adm__linkbtn"
                        onClick={() => atualizarCliente(r)}
                        disabled={atualizandoId === r.id}
                        title="Re-rodar a consulta do CPF e atualizar os dados"
                      >
                        {atualizandoId === r.id ? 'Atualizando…' : 'Atualizar'}
                      </button>
                      <button className="adm__linkbtn" onClick={() => setSel(r)}>Ver</button>
                      <button className="adm__linkbtn" onClick={() => setTxt(r)} title="Visualizar o TXT deste cliente">TXT</button>
                    </div>
                    {feedback?.id === r.id && (
                      <div style={{ fontSize: 11, marginTop: 4, fontWeight: 600, textAlign: 'right', color: feedback.tipo === 'ok' ? '#166534' : '#dc2626' }}>
                        {feedback.msg}
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Detalhe do cliente */}
      {sel && (
        <div className="admmodal" role="dialog" aria-modal="true" onClick={() => setSel(null)}>
          <div className="admmodal__box" onClick={(e) => e.stopPropagation()}>
            <div className="admmodal__head">
              <h2>{sel.nome || 'Cliente'}</h2>
              <button className="admmodal__x" onClick={() => setSel(null)} aria-label="Fechar">×</button>
            </div>
            <dl className="admmodal__grid">
              {[
                ['CPF', sel.cpf ? maskCpf(sel.cpf) : '—'],
                ['Telefone', sel.telefone ? maskTelefone(sel.telefone) : '—'],
                ['Nascimento', sel._consulta?.nascimento || sel.nascimento || '—'],
                ['Idade', sel._consulta?.idade != null && sel._consulta?.idade !== '' ? String(sel._consulta.idade) : '—'],
                ['Score', sel._consulta?.score || '—'],
                ['Renda', sel._consulta?.renda || '—'],
                ['Sexo', sel._consulta?.sexo || sel.genero || '—'],
                ['Telefones (puxados)', (sel._consulta?.telefones || []).map((t) => maskTelefone(t)).join('  ·  ') || '—'],
                ['Pontos', sel.pontos ?? 0],
                ['Créditos', formatBRL(sel.creditos_nao_sacaveis)],
                ['Saldo p/ saque', formatBRL(sel.saldo_saque)],
                ['Total sacado', formatBRL(sel.total_sacado)],
                ...(sel._pedidos?.voltou ? [['🔁 Voltou', `depois de exportado em ${dataCurta(sel._pedidos.exportadoEm)}`]] : []),
                ['Cadastro', sel.created_at ? new Date(sel.created_at).toLocaleString('pt-BR') : '—'],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>

            <h3 className="admmodal__h3">Pagamentos confirmados ({sel._pedidos?.pagos || 0})</h3>
            <div className="admmodal__history">
              {!sel._pedidos?.pagosDetalhe?.length ? (
                <p className="adm-muted">Nenhum pagamento confirmado ainda.</p>
              ) : (
                sel._pedidos.pagosDetalhe.map((pg, i) => (
                  <div key={i} className={`admmodal__history-row ${i === 0 ? 'is-latest' : ''}`}>
                    <div>
                      <strong>{dataCurta(pg.data)}</strong>
                      <span className="admmodal__history-description">{pg.sorteio || '—'} · {cidadeLabel(pg)} · {pg.banco || '—'}</span>
                    </div>
                    <div className="admmodal__history-result">
                      <b>{formatBRL(pg.valor)}</b>
                    </div>
                  </div>
                ))
              )}
            </div>

            <h3 className="admmodal__h3">Consulta (retorno bruto do provedor)</h3>
            {raw?.userId !== sel.id ? (
              <button className="adm__btn" onClick={() => verRaw(sel.id)} disabled={rawBusy}>
                {rawBusy ? 'Carregando…' : 'Ver JSON bruto da consulta'}
              </button>
            ) : raw.erro ? (
              <p className="adm-muted">Não foi possível carregar: {raw.erro}</p>
            ) : !raw.json ? (
              <p className="adm-muted">Nenhuma consulta salva para este cliente ainda.</p>
            ) : (
              <>
                <button className="adm__btn" onClick={copiarRaw}>{rawCopiado ? 'Copiado!' : 'Copiar JSON'}</button>
                <pre style={{ marginTop: 8, maxHeight: 320, overflow: 'auto', fontSize: 11, background: '#f6f7fb', padding: 12, borderRadius: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {JSON.stringify(raw.json, null, 2)}
                </pre>
              </>
            )}

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button className="adm__btn admmodal__exp" onClick={() => setTxt(sel)}>Visualizar TXT</button>
              <button className="adm__btn adm__btn--primary admmodal__exp" onClick={() => exportarUm(sel)}>
                <Download size={16} /> Exportar este cliente (TXT)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Visualização do TXT do cliente */}
      {txt && (
        <div className="admmodal" role="dialog" aria-modal="true" onClick={() => setTxt(null)}>
          <div className="admmodal__box" onClick={(e) => e.stopPropagation()}>
            <div className="admmodal__head">
              <h2>TXT — {txt.nome || 'Cliente'}</h2>
              <button className="admmodal__x" onClick={() => setTxt(null)} aria-label="Fechar">×</button>
            </div>
            <pre style={{ fontSize: 13, lineHeight: 1.5, background: '#f6f7fb', padding: 14, borderRadius: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '60vh', overflow: 'auto' }}>
              {usuarioParaTexto(txt)}
            </pre>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
              <button className="adm__btn" onClick={copiarTxt}>{txtCopiado ? 'Copiado!' : 'Copiar'}</button>
              <button className="adm__btn adm__btn--primary" onClick={() => exportarUm(txt)}>
                <Download size={16} /> Baixar .txt
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
