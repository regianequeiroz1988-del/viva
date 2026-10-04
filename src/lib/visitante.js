// ID anônimo e PERSISTENTE do visitante (localStorage). Serve só para LIGAR a
// visita à venda — saber se quem entrou no site converteu em compra. Não guarda
// nada pessoal: é um código aleatório gerado no navegador.
export function getVisitorId() {
  if (typeof window === 'undefined') return ''
  try {
    let id = window.localStorage.getItem('vs_vid')
    if (!id) {
      id =
        (window.crypto && window.crypto.randomUUID && window.crypto.randomUUID()) ||
        'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12)
      window.localStorage.setItem('vs_vid', id)
    }
    return id
  } catch {
    return ''
  }
}
