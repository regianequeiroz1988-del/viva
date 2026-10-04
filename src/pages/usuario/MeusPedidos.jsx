import { useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext.jsx'
import { supabase, isSupabaseConfigured } from '../../lib/supabase.js'
import { formatBRL } from '../../utils/format.js'
import { gerarNumeros } from '../../utils/premio.js'
import { Check, Close } from '../../components/Icons.jsx'

const UPSELL_ID = 'upsell-dia-da-sorte'

const fmtData = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${d.toLocaleDateString('pt-BR')} - ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
}

// pago → verde ✓ | cancelado/estornado → vermelho ✗ | resto (pendente) → âmbar
const tipoStatus = (s) => (s === 'pago' ? 'ok' : (s === 'cancelado' || s === 'estornado' || s === 'negado' ? 'erro' : 'pend'))

function resumo(p) {
  const arr = Array.isArray(p?.itens) ? p.itens : []
  if (p?.metodo === 'deposito') return { sorteios: ['Depósito de créditos'], numeros: 0 }
  const sorteios = arr
    .filter((i) => i && i.id !== UPSELL_ID && i.tipo !== 'deposito')
    .map((i) => i.title)
    .filter(Boolean)
  const numeros = arr.reduce((s, i) => s + (Number(i?.numeros ?? i?.qty) || 0), 0)
  return { sorteios, numeros }
}

export default function MeusPedidos() {
  const { user } = useAuth()
  const [rows, setRows] = useState(null)
  const [aberto, setAberto] = useState(null) // id do pedido expandido

  useEffect(() => {
    let on = true
    ;(async () => {
      if (!isSupabaseConfigured || !user?.id) { if (on) setRows([]); return }
      const { data } = await supabase
        .from('pedidos')
        .select('id, created_at, total, status, metodo, itens')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
      if (on) setRows(data || [])
    })()
    return () => { on = false }
  }, [user?.id])

  return (
    <main className="page">
      <div className="usr-headbar"><div className="container"><h1>Meus pedidos</h1></div></div>
      <div className="container">
        <h2 className="usr-sec-title">Pedidos</h2>
        <p className="usr-sec-sub">Novos pedidos, pedidos em análise e pedidos negados.</p>

        {rows === null ? (
          <div className="usr-empty"><p className="usr-muted">Carregando…</p></div>
        ) : rows.length === 0 ? (
          <div className="usr-empty"><span className="usr-empty__i">i</span><p>Nenhum pedido foi encontrado.</p></div>
        ) : (
          <div className="usr-list">
            {rows.map((p) => {
              const t = tipoStatus(p.status)
              const { sorteios, numeros } = resumo(p)
              const expand = aberto === p.id
              return (
                <div key={p.id} className={`usr-ped usr-ped--${t}`}>
                  <span className="usr-ped__site">🖥 Compra pelo site</span>
                  <div className="usr-ped__row">
                    <span className={`usr-ped__ic usr-ped__ic--${t}`}>
                      {t === 'ok' ? <Check size={20} /> : t === 'erro' ? <Close size={20} /> : '!'}
                    </span>
                    <div className="usr-ped__info">
                      <strong>Pedido nº {String(p.id).slice(0, 8).toUpperCase()}</strong>
                      <small>{fmtData(p.created_at)}</small>
                    </div>
                    <button type="button" className="usr-ped__ver" onClick={() => setAberto(expand ? null : p.id)}>
                      {expand ? 'Fechar' : 'Ver'}
                    </button>
                  </div>

                  {expand && (
                    <div className="usr-ped__det">
                      <div className="usr-ped__det-row"><span>Sorteio(s)</span><strong>{sorteios.length ? sorteios.join(' · ') : '—'}</strong></div>
                      <div className="usr-ped__det-row"><span>Números</span><strong>{numeros || '—'}</strong></div>
                      <div className="usr-ped__det-row"><span>Valor</span><strong>{formatBRL(p.total)}</strong></div>
                      {numeros > 0 && (
                        <div className="usr-tcard__numgrid">
                          {gerarNumeros(numeros).map((n) => (
                            <span key={n.numero} className={`cc-num ${n.premiado ? 'is-win' : ''}`}>{n.numero}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </main>
  )
}
