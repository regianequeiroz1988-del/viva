// Meta Pixel — wrapper SEGURO e SEPARADO da UTMify do gestor.
// Só usa window.fbq (namespace do Meta). Se o pixel não estiver carregado
// (ID ainda não configurado no index.html, ou sem rede), vira no-op silencioso.
// NUNCA tocar nos scripts da UTMify (cdn.utmify.com.br) — são do gestor.
import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'

const INTERNO = ['/admin', '/ligador'] // áreas internas não viram evento/público

// Dispara um evento padrão do Meta (Lead, Purchase, etc.). Seguro em qualquer caso.
export function metaTrack(event, params) {
  try {
    if (typeof window === 'undefined' || typeof window.fbq !== 'function') return
    const p = window.location?.pathname || ''
    if (INTERNO.some((x) => p.startsWith(x))) return
    window.fbq('track', event, params || undefined)
  } catch {
    /* ignore */
  }
}

// Dispara PageView a cada troca de rota (SPA). Pula a 1ª renderização porque o
// index.html já dispara o PageView do carregamento inicial.
export function MetaPixelRouteTracker() {
  const { pathname } = useLocation()
  const primeiro = useRef(true)
  useEffect(() => {
    if (primeiro.current) {
      primeiro.current = false
      return
    }
    metaTrack('PageView')
  }, [pathname])
  return null
}
