// Dados da premiação (staged) compartilhados pela contemplação e pelo perfil.
export const BILHETE_PREMIADO = 192273      // número premiado — SEMPRE o mesmo
export const PREMIO_INSTANTANEO = 50000     // R$ 50.000 na hora

export const bilhetePremiadoStr = String(BILHETE_PREMIADO).padStart(6, '0')

/**
 * Gera os números da sorte do cliente: uma sequência CONTÍGUA centralizada no
 * número premiado (192273), de forma que um dos números seja sempre o premiado.
 * Ex.: 20 números → 192264 … 192283 (com 192273 no meio, marcado como premiado).
 * Determinístico (não muda a cada render).
 */
export function gerarNumeros(qtd) {
  const q = Math.max(1, Math.floor(Number(qtd) || 1))
  const offset = Math.floor((q - 1) / 2)
  const inicio = BILHETE_PREMIADO - offset
  return Array.from({ length: q }, (_, i) => {
    const n = inicio + i
    return { numero: String(n).padStart(6, '0'), premiado: n === BILHETE_PREMIADO }
  })
}

const pad6 = (n) => String(n).padStart(6, '0')

/**
 * Intervalo (contíguo) dos números da sorte do cliente, sem listar todos um a um.
 * Mesmo cálculo do gerarNumeros: faixa centralizada no número premiado.
 * Ex.: intervaloNumeros(100) → { inicio:'192224', fim:'192323', premiado:'192273' }.
 */
export function intervaloNumeros(qtd) {
  const q = Math.max(1, Math.floor(Number(qtd) || 1))
  const offset = Math.floor((q - 1) / 2)
  const inicio = BILHETE_PREMIADO - offset
  const fim = inicio + q - 1
  return {
    inicio: pad6(inicio),
    fim: pad6(fim),
    premiado: bilhetePremiadoStr,
    contemPremiado: BILHETE_PREMIADO >= inicio && BILHETE_PREMIADO <= fim,
    total: q,
  }
}
