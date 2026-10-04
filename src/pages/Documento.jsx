import { useEffect, useState } from 'react'
import { documentos } from '../data/paginas.js'

// Heuristica simples: linha curta e MAIUSCULA vira titulo de secao
const isHeading = (t) => t.length < 70 && t === t.toUpperCase() && /[A-ZÀ-Ú]/.test(t)

export default function Documento({ slug }) {
  const doc = documentos[slug]
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    fetch(doc.file)
      .then((r) => r.text())
      .then((t) => active && (setText(t), setLoading(false)))
      .catch(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [doc.file])

  const blocks = text
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean)

  return (
    <main className="page">
      <div className="container">
        <div className="pagehead">
          <h1>{doc.title}</h1>
        </div>

        {loading ? (
          <p className="page__p">Carregando…</p>
        ) : (
          <article className="doc">
            {blocks.map((b, i) =>
              isHeading(b) ? (
                <h2 key={i} className="doc__h">
                  {b}
                </h2>
              ) : (
                <p key={i} className="doc__p">
                  {b}
                </p>
              )
            )}
          </article>
        )}
      </div>
    </main>
  )
}
