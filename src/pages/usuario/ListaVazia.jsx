// Pagina generica de lista vazia (Meus titulos / pedidos / resgates / saques)
export default function ListaVazia({ title, emptyText }) {
  return (
    <main className="page">
      <div className="container">
        <div className="pagehead">
          <h1>{title}</h1>
        </div>
        <div className="usr-empty">
          <span className="usr-empty__i">i</span>
          <p>{emptyText}</p>
        </div>
      </div>
    </main>
  )
}
