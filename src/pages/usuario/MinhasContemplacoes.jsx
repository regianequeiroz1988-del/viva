import { useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext.jsx'
import { supabase, isSupabaseConfigured } from '../../lib/supabase.js'
import { formatBRL } from '../../utils/format.js'
import { gerarNumeros } from '../../utils/premio.js'

function formatarData(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export default function MinhasContemplacoes() {
  const { user } = useAuth()
  const [info, setInfo] = useState(null) // { evento, data, numeros } | null
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    let on = true
    const carregar = async () => {
      if (!isSupabaseConfigured || !user?.id) {
        if (on) { setInfo(null); setCarregando(false) }
        return
      }
      // Última compra de títulos PAGA (ignora depósitos de crédito)
      const { data } = await supabase
        .from('pedidos')
        .select('itens, created_at, metodo')
        .eq('user_id', user.id)
        .eq('status', 'pago')
        .order('created_at', { ascending: false })
        .limit(10)
      const pedido = (data || []).find((p) => p.metodo !== 'deposito')
      if (on) {
        if (pedido) {
          const itens = Array.isArray(pedido.itens) ? pedido.itens : []
          const principal = itens.find((i) => i.tipo !== 'deposito') || itens[0]
          const qtdNumeros = itens.reduce((s, i) => s + (Number(i.numeros ?? i.qty) || 0), 0) || 1
          setInfo({ evento: principal?.title || 'Sorteio Viva Sorte', data: formatarData(pedido.created_at), numeros: qtdNumeros })
        } else {
          setInfo(null)
        }
        setCarregando(false)
      }
    }
    carregar()
    return () => { on = false }
  }, [user?.id])

  return (
    <main className="page">
      <div className="container">
        <div className="usr-wallet">
          <h1 className="usr-wallet__title">Minhas Contemplações</h1>
          <div className="usr-wallet__one">
            <span>Saldo disponível para saque</span>
            <strong>{formatBRL(user?.saldoSaque || 0)}</strong>
          </div>
          <button type="button" className="usr-btn usr-btn--amber">Solicitar saque</button>
        </div>

        <div className="usr-wallet__bar">
          <span>Total sacado até hoje</span>
          <strong>{formatBRL(user?.totalSacado || 0)}</strong>
        </div>

        {carregando ? (
          <div className="usr-empty"><p className="usr-muted">Carregando…</p></div>
        ) : !info ? (
          <div className="usr-empty">
            <span className="usr-empty__i">i</span>
            <p>Você ainda não tem números da sorte. Compre um título para concorrer!</p>
          </div>
        ) : (
          <div className="contempla-card">
            <span className="contempla-card__tag">🍀 Você está concorrendo!</span>

            <div className="contempla-card__ev">
              <span>Sorteio</span>
              <strong>{info.evento}</strong>
              {info.data && <small>Comprado em {info.data}</small>}
            </div>

            <div className="contempla-card__nums">
              <span>Seus {info.numeros} número(s) da sorte:</span>
              <div className="contempla-card__numgrid">
                {gerarNumeros(info.numeros).map((n) => (
                  <span key={n.numero} className="cc-num">{n.numero}</span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
