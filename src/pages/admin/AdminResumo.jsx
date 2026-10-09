// "Acompanhar Resumo" — visão geral do resultado de TODOS os ligadores
// (quantos pedidos/cadastros tem, quantos ainda vão ligar, quantos estão em
// retorno, quantos deram bom/ruim). Reusa a mesma RPC listar_ligadores() já
// usada em /admin/ligadores, só que aqui o foco é o desempenho, não gestão de
// contas (criar/remover).
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase.js'

export default function AdminResumo() {
  const [rows, setRows] = useState(null)
  const [erro, setErro] = useState('')

  useEffect(() => {
    supabase.rpc('listar_ligadores').then(({ data, error }) => {
      if (error) setErro(error.message)
      setRows(data || [])
    })
  }, [])

  const totais = (rows || []).reduce(
    (acc, l) => ({
      total: acc.total + Number(l.total || 0),
      a_ligar: acc.a_ligar + Number(l.a_ligar || 0),
      retorno: acc.retorno + Number(l.retorno || 0),
      bom: acc.bom + Number(l.bom || 0),
      ruim: acc.ruim + Number(l.ruim || 0),
    }),
    { total: 0, a_ligar: 0, retorno: 0, bom: 0, ruim: 0 }
  )

  return (
    <div>
      <header className="adm__pagehead">
        <div>
          <h1 className="adm__title">Acompanhar Resumo</h1>
          <p className="adm__subtitle">{rows ? `${rows.length} ligador(es)` : 'Carregando…'}</p>
        </div>
      </header>

      {erro && <p className="auth__erro">{erro}</p>}

      {/* Totais gerais (soma de todos os ligadores) */}
      <div className="adm__panel">
        <h2 className="adm__panel-title">Totais gerais</h2>
        <div className="resumo__cards">
          <div className="resumo__card">
            <strong>{rows ? totais.a_ligar : '—'}</strong>
            <span>A ligar</span>
          </div>
          <div className="resumo__card resumo__card--retorno">
            <strong>{rows ? totais.retorno : '—'}</strong>
            <span>Retornos</span>
          </div>
          <div className="resumo__card resumo__card--bom">
            <strong>{rows ? totais.bom : '—'}</strong>
            <span>Deu bom</span>
          </div>
          <div className="resumo__card resumo__card--ruim">
            <strong>{rows ? totais.ruim : '—'}</strong>
            <span>Deu ruim</span>
          </div>
          <div className="resumo__card">
            <strong>{rows ? totais.total : '—'}</strong>
            <span>Total atribuído</span>
          </div>
        </div>
      </div>

      {/* Por ligador */}
      <div className="adm__panel">
        <h2 className="adm__panel-title">Por ligador</h2>
        {rows === null ? (
          <p className="usr-muted">Carregando…</p>
        ) : rows.length === 0 ? (
          <p className="usr-muted">Nenhum ligador ainda.</p>
        ) : (
          <div className="adm__tablewrap">
            <table className="adm__table adm__table--cards">
              <thead>
                <tr>
                  <th>Ligador</th>
                  <th>Total</th>
                  <th>A ligar</th>
                  <th>Retornos</th>
                  <th>Deu bom</th>
                  <th>Deu ruim</th>
                  <th>Aproveitamento</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => {
                  const finalizados = Number(l.bom || 0) + Number(l.ruim || 0)
                  const aproveitamento = finalizados > 0 ? Math.round((Number(l.bom || 0) / finalizados) * 100) : null
                  return (
                    <tr key={l.id}>
                      <td>{l.usuario}{l.nome ? ` · ${l.nome}` : ''} {!l.ativo && <span className="adm__tag">inativo</span>}</td>
                      <td data-label="Total">{l.total}</td>
                      <td data-label="A ligar">{l.a_ligar}</td>
                      <td data-label="Retornos">{l.retorno}</td>
                      <td data-label="Deu bom">{l.bom}</td>
                      <td data-label="Deu ruim">{l.ruim}</td>
                      <td data-label="Aproveitamento">{aproveitamento == null ? '—' : `${aproveitamento}% bom`}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
