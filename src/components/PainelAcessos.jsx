import { useEffect, useMemo, useRef, useState } from 'react'
import { formatBRL } from '../utils/format.js'

// Painel de acessos agrupado por visitante. carregar(desdeISO) → jsonb de _acessos_painel.
const PERIODOS = [
  { id: 'hoje', label: 'Hoje' },
  { id: '24h', label: '24 horas' },
  { id: '7d', label: '7 dias' },
  { id: '30d', label: '30 dias' },
]
const FILTROS = [
  { id: 'todos', label: 'Todos' },
  { id: 'agora', label: 'Agora' },
  { id: 'voltaram', label: 'Voltaram' },
  { id: 'novos', label: 'Novos' },
  { id: 'pix', label: 'Geraram Pix' },
  { id: 'pagaram', label: 'Compraram' },
]
const AGORA_MS = 15 * 60 * 1000

function desdeDe(periodo) {
  const d = new Date()
  if (periodo === 'hoje') { d.setHours(0, 0, 0, 0); return d }
  const horas = { '24h': 24, '7d': 24 * 7, '30d': 24 * 30 }[periodo]
  return new Date(Date.now() - horas * 3600 * 1000)
}

function relativo(iso, agora) {
  const s = Math.max(0, Math.round((agora - new Date(iso).getTime()) / 1000))
  if (s < 60) return 'agora mesmo'
  const m = Math.round(s / 60)
  if (m < 60) return `há ${m} min`
  const h = Math.round(m / 60)
  if (h < 24) return `há ${h} h`
  const d = Math.round(h / 24)
  return d === 1 ? 'ontem' : `há ${d} dias`
}
const dataHora = (iso) => {
  const d = new Date(iso)
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
}
const local = (c, uf) => (c && c !== '(desconhecida)' ? `${c}${uf ? `/${uf}` : ''}` : 'Local desconhecido')
const n = (x) => Number(x || 0).toLocaleString('pt-BR')
const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1).replace('.', ',')}%` : '0%')

function aparelho(ua = '') {
  const u = ua.toLowerCase()
  const tipo = /ipad|tablet/.test(u) ? 'tablet' : /mobi|iphone|android/.test(u) ? 'celular' : 'computador'
  const so = /iphone|ipad|ios/.test(u) ? 'iPhone' : /android/.test(u) ? 'Android' : /windows/.test(u) ? 'Windows' : /mac os/.test(u) ? 'Mac' : /linux/.test(u) ? 'Linux' : ''
  const nav = /edg\//.test(u) ? 'Edge' : /opr\/|opera/.test(u) ? 'Opera' : /samsungbrowser/.test(u) ? 'Samsung' : /chrome|crios/.test(u) ? 'Chrome' : /firefox|fxios/.test(u) ? 'Firefox' : /safari/.test(u) ? 'Safari' : ''
  return { tipo, texto: [so, nav].filter(Boolean).join(' · ') || 'Navegador desconhecido' }
}

function IconeAparelho({ tipo }) {
  if (tipo === 'computador') {
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x={tipo === 'tablet' ? 4 : 7} y="2" width={tipo === 'tablet' ? 16 : 10} height="20" rx="2.5" /><path d="M11 18h2" />
    </svg>
  )
}

function Grafico({ serie, agrupamento }) {
  const [hover, setHover] = useState(null)
  const max = Math.max(1, ...serie.map((b) => b.v))
  const rotulo = (b) => {
    const d = new Date(b.b)
    return agrupamento === 'hora'
      ? `${String(d.getHours()).padStart(2, '0')}h`
      : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
  }
  const passo = Math.max(1, Math.ceil(serie.length / 8))
  const atual = hover != null ? serie[hover] : null
  return (
    <div className="acs-graf">
      <div className="acs-graf__topo">
        <h3>Visitantes por {agrupamento === 'hora' ? 'hora' : 'dia'}</h3>
        <span className="acs-graf__info">
          {atual ? <><strong>{n(atual.v)}</strong> visitante(s) · {n(atual.a)} acesso(s) · {rotulo(atual)}</> : `pico de ${n(max)}`}
        </span>
      </div>
      <div className="acs-graf__area" onMouseLeave={() => setHover(null)}>
        <span className="acs-graf__grade" style={{ bottom: '50%' }} />
        <span className="acs-graf__grade" style={{ bottom: '100%' }} />
        {serie.map((b, i) => (
          <button
            type="button"
            key={b.b}
            className={`acs-graf__col ${hover === i ? 'is-hover' : ''}`}
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            aria-label={`${rotulo(b)}: ${b.v} visitantes, ${b.a} acessos`}
          >
            <span className="acs-graf__barra" style={{ height: b.v ? `max(4px, ${(b.v / max) * 100}%)` : 0 }} />
          </button>
        ))}
      </div>
      <div className="acs-graf__eixo">
        {serie.map((b, i) => <span key={b.b}>{i % passo === 0 ? rotulo(b) : ''}</span>)}
      </div>
    </div>
  )
}

function Visitante({ v, agora, aberto, onToggle }) {
  const ap = aparelho(v.ua)
  const online = agora - new Date(v.ultima).getTime() < AGORA_MS
  const voltou = v.total > 1
  return (
    <li className={`acs-vis ${aberto ? 'is-open' : ''}`}>
      <button type="button" className="acs-vis__linha" onClick={onToggle} aria-expanded={aberto}>
        <span className={`acs-vis__av ${online ? 'is-on' : ''}`}><IconeAparelho tipo={ap.tipo} /></span>
        <span className="acs-vis__quem">
          <strong>{v.nome || local(v.cidade, v.uf)}</strong>
          <small>{v.nome ? `${local(v.cidade, v.uf)} · ` : ''}{ap.texto} · IP {v.ip || '—'}</small>
        </span>
        <span className="acs-vis__selos">
          {online && <span className="acs-selo acs-selo--on">● Agora</span>}
          {voltou
            ? <span className="acs-selo acs-selo--volta" title={`${v.total} visitas no total`}>↻ Voltou · {v.total}ª visita</span>
            : <span className="acs-selo">Novo</span>}
          {v.pagou
            ? <span className="acs-selo acs-selo--pago">✓ Comprou {formatBRL(Number(v.valor_pago))}</span>
            : v.gerou_pix && <span className="acs-selo acs-selo--pix">Gerou Pix</span>}
        </span>
        <span className="acs-vis__quando">{relativo(v.ultima, agora)}</span>
        <span className="acs-vis__seta" aria-hidden="true">›</span>
      </button>
      {aberto && (
        <div className="acs-vis__det">
          <div className="acs-vis__dados">
            <span><small>Primeira visita</small>{dataHora(v.primeira)}</span>
            <span><small>Visitas no período</small>{v.visitas}</span>
            <span><small>Visitas no total</small>{v.total}</span>
            <span><small>IPs diferentes</small>{v.ips}</span>
          </div>
          <ol className="acs-tl">
            {(v.linha || []).map((e, i) => (
              <li key={i}>
                <span className="acs-tl__t">{dataHora(e.t)}</span>
                <span className="acs-tl__p">{e.p || '/'}</span>
                <span className="acs-tl__c">{local(e.c, e.u)}</span>
              </li>
            ))}
          </ol>
          {v.visitas > (v.linha || []).length && <p className="acs-vis__mais">Mostrando as {v.linha.length} visitas mais recentes.</p>}
        </div>
      )}
    </li>
  )
}

export default function PainelAcessos({ carregar }) {
  const [periodo, setPeriodo] = useState('hoje')
  const [filtro, setFiltro] = useState('todos')
  const [busca, setBusca] = useState('')
  const [dados, setDados] = useState(null)
  const [erro, setErro] = useState('')
  const [aberto, setAberto] = useState(null)
  const [agora, setAgora] = useState(Date.now())
  const ref = useRef(carregar)
  ref.current = carregar

  useEffect(() => {
    let ativo = true
    setDados(null)
    const ler = async () => {
      try {
        const r = await ref.current(desdeDe(periodo).toISOString())
        if (!ativo) return
        if (!r) { setErro('Não foi possível carregar os acessos.'); setDados({ resumo: {}, serie: [], cidades: [], visitantes: [] }); return }
        setErro('')
        setDados(r)
        setAgora(Date.now())
      } catch (e) {
        if (ativo) setErro(e.message || 'Não foi possível carregar os acessos.')
      }
    }
    ler()
    const t = setInterval(ler, 30000)
    return () => { ativo = false; clearInterval(t) }
  }, [periodo])

  const lista = useMemo(() => {
    let l = dados?.visitantes || []
    const ini = desdeDe(periodo).getTime()
    if (filtro === 'agora') l = l.filter((v) => agora - new Date(v.ultima).getTime() < AGORA_MS)
    else if (filtro === 'voltaram') l = l.filter((v) => v.total > 1)
    else if (filtro === 'novos') l = l.filter((v) => new Date(v.primeira).getTime() >= ini)
    else if (filtro === 'pix') l = l.filter((v) => v.gerou_pix || v.pagou)
    else if (filtro === 'pagaram') l = l.filter((v) => v.pagou)
    const q = busca.trim().toLowerCase()
    if (q) l = l.filter((v) => `${v.nome || ''} ${v.cidade || ''} ${v.uf || ''} ${v.ip || ''}`.toLowerCase().includes(q))
    return l
  }, [dados, filtro, busca, agora, periodo])

  const r = dados?.resumo || {}
  const maxCid = Math.max(1, ...(dados?.cidades || []).map((c) => c.n))
  const funil = [
    { label: 'Visitaram', v: Number(r.visitantes || 0) },
    { label: 'Geraram Pix', v: Number(r.gerou_pix || 0) },
    { label: 'Compraram', v: Number(r.pagaram || 0) },
  ]

  return (
    <div className="acs">
      <div className="acs-barra">
        <div className="acs-seg" role="tablist" aria-label="Período">
          {PERIODOS.map((p) => (
            <button key={p.id} type="button" role="tab" aria-selected={periodo === p.id} className={periodo === p.id ? 'is-active' : ''} onClick={() => { setPeriodo(p.id); setAberto(null) }}>
              {p.label}
            </button>
          ))}
        </div>
        <span className="acs-vivo"><span className="acs-vivo__pulso" />{n(r.online)} {Number(r.online) === 1 ? 'pessoa' : 'pessoas'} agora · atualiza sozinho</span>
      </div>

      {erro && <p className="auth__erro">{erro}</p>}

      <div className="acs-kpis">
        <div className="acs-kpi acs-kpi--destaque">
          <small>Visitantes</small>
          <strong>{dados ? n(r.visitantes) : '—'}</strong>
          <span>{dados ? `${n(r.acessos)} acessos no total` : ' '}</span>
        </div>
        <div className="acs-kpi">
          <small>Novos</small>
          <strong>{dados ? n(r.novos) : '—'}</strong>
          <span>primeira vez no site</span>
        </div>
        <div className="acs-kpi">
          <small>Voltaram</small>
          <strong>{dados ? n(r.voltaram) : '—'}</strong>
          <span>{dados ? `${pct(Number(r.voltaram), Number(r.visitantes))} dos visitantes` : ' '}</span>
        </div>
        <div className="acs-kpi">
          <small>Compraram</small>
          <strong>{dados ? n(r.pagaram) : '—'}</strong>
          <span>{dados ? `conversão de ${pct(Number(r.pagaram), Number(r.visitantes))}` : ' '}</span>
        </div>
      </div>

      <div className="acs-grade">
        <section className="acs-card acs-card--graf">
          {dados ? <Grafico serie={dados.serie || []} agrupamento={dados.agrupamento} /> : <div className="acs-skel" style={{ height: 200 }} />}
        </section>

        <section className="acs-card">
          <h3>Funil</h3>
          <div className="acs-funil">
            {funil.map((f, i) => (
              <div key={f.label} className="acs-funil__etapa">
                <div className="acs-funil__topo"><span>{f.label}</span><strong>{dados ? n(f.v) : '—'}</strong></div>
                <div className="acs-funil__trilho"><span style={{ width: `${funil[0].v ? (f.v / funil[0].v) * 100 : 0}%` }} /></div>
                {i > 0 && <small>{pct(f.v, funil[i - 1].v)} da etapa anterior</small>}
              </div>
            ))}
          </div>
          <h3 className="acs-card__sub">Cidades</h3>
          {dados && !dados.cidades?.length && <p className="usr-muted">Sem acessos no período.</p>}
          <ul className="acs-cid">
            {(dados?.cidades || []).map((c) => (
              <li key={`${c.cidade}${c.uf}`}>
                <span className="acs-cid__nome">{local(c.cidade, c.uf)}</span>
                <span className="acs-cid__trilho"><span style={{ width: `${(c.n / maxCid) * 100}%` }} /></span>
                <span className="acs-cid__n">{n(c.n)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="acs-card">
        <div className="acs-lista__topo">
          <h3>Visitantes <span className="usr-muted">({n(lista.length)})</span></h3>
          <input className="acs-busca" placeholder="Buscar nome, cidade ou IP…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <div className="acs-chips">
          {FILTROS.map((f) => (
            <button key={f.id} type="button" className={`adm__chip ${filtro === f.id ? 'is-active' : ''}`} onClick={() => setFiltro(f.id)}>{f.label}</button>
          ))}
        </div>
        {!dados ? (
          <div className="acs-skel" style={{ height: 160 }} />
        ) : lista.length === 0 ? (
          <p className="usr-muted acs-vazio">Nenhum visitante com esse filtro.</p>
        ) : (
          <ul className="acs-lista">
            {lista.map((v) => (
              <Visitante key={v.k} v={v} agora={agora} aberto={aberto === v.k} onToggle={() => setAberto(aberto === v.k ? null : v.k)} />
            ))}
          </ul>
        )}
        <p className="acs-nota">Cada linha é um aparelho: as visitas repetidas dele ficam juntas. Sem identificação do aparelho, agrupa pelo IP.</p>
      </section>
    </div>
  )
}
