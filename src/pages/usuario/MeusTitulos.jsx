import { useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext.jsx'
import { supabase, isSupabaseConfigured } from '../../lib/supabase.js'
import { gerarNumeros } from '../../utils/premio.js'

const UPSELL_ID = 'upsell-dia-da-sorte'

export default function MeusTitulos() {
  const { user } = useAuth()
  const [grupos, setGrupos] = useState(null)
  const [aberto, setAberto] = useState(null)

  useEffect(() => {
    let on = true
    ;(async () => {
      if (!isSupabaseConfigured || !user?.id) { if (on) setGrupos([]); return }
      // Títulos = itens dos pedidos PAGOS, agrupados por sorteio (igual ao oficial).
      const { data } = await supabase
        .from('pedidos')
        .select('itens, metodo, status')
        .eq('user_id', user.id)
        .eq('status', 'pago')
        .order('created_at', { ascending: false })
      const map = new Map()
      for (const p of data || []) {
        if (p.metodo === 'deposito') continue
        for (const it of Array.isArray(p.itens) ? p.itens : []) {
          if (!it || it.id === UPSELL_ID || it.tipo === 'deposito') continue
          const chave = it.title || 'Sorteio Viva Sorte'
          const g = map.get(chave) || { title: chave, edition: it.edition || null, titulos: 0 }
          g.titulos += Number(it.numeros ?? it.qty) || 0
          map.set(chave, g)
        }
      }
      if (on) setGrupos([...map.values()])
    })()
    return () => { on = false }
  }, [user?.id])

  return (
    <main className="page">
      <div className="usr-headbar"><div className="container"><h1>Meus títulos</h1></div></div>
      <div className="container">
        <h2 className="usr-sec-title">Sorteios em vigência</h2>

        {grupos === null ? (
          <div className="usr-empty"><p className="usr-muted">Carregando…</p></div>
        ) : grupos.length === 0 ? (
          <div className="usr-empty">
            <span className="usr-empty__i">i</span>
            <p>Você ainda não possui títulos. Compre um título para concorrer!</p>
          </div>
        ) : (
          <div className="usr-list">
            {grupos.map((g, i) => {
              const expand = aberto === i
              return (
                <div key={g.title + i} className="usr-tcard">
                  <div className="usr-tcard__bar">
                    <span><strong>{g.titulos}</strong> Título(s) obtido(s)</span>
                    <button type="button" className="usr-tcard__ver" onClick={() => setAberto(expand ? null : i)}>
                      {expand ? 'Ocultar' : 'Ver títulos →'}
                    </button>
                  </div>
                  <div className="usr-tcard__head">
                    <strong>{g.title}</strong>
                    {g.edition && <span className="usr-muted">Edição {g.edition}</span>}
                  </div>
                  {expand && g.titulos > 0 && (
                    <div className="usr-tcard__numgrid">
                      {gerarNumeros(g.titulos).map((n) => (
                        <span key={n.numero} className={`cc-num ${n.premiado ? 'is-win' : ''}`}>{n.numero}</span>
                      ))}
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
