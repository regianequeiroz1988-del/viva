import { useEffect } from 'react'

// Rola a barra de abas até a aba ativa (ex.: abriu direto em "Somente Cadastros").
export function useAbaVisivel(ref, aba) {
  useEffect(() => {
    const barra = ref.current
    const el = barra?.querySelector('[aria-selected="true"], .is-active')
    if (!barra || !el || barra.scrollWidth <= barra.clientWidth) return
    const dx = el.getBoundingClientRect().left - barra.getBoundingClientRect().left
    barra.scrollTo({ left: barra.scrollLeft + dx - (barra.clientWidth - el.offsetWidth) / 2, behavior: 'smooth' })
  }, [ref, aba])
}
