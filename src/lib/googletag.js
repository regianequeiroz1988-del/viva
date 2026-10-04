// Tag do Google Ads (gtag.js) carregada com o ID salvo no /admin → Configurações.
// Trocar de conta = trocar o ID lá, sem mexer em código.
import { supabase, isSupabaseConfigured } from './supabase.js'
import { CONFIG_KEYS } from './config.js'

// Usado enquanto nada foi salvo no /admin.
export const GOOGLE_TAG_ID_PADRAO = 'AW-18414240381'
const ROTULO_COMPRA_PADRAO = 'OYoNCIrWjOkcEP2EzMxE'

// O rótulo padrão pertence à conta padrão: com outro ID, só vale o que foi salvo.
export const rotuloCompraEfetivo = (id, salvo) =>
  normalizarRotulo(salvo) || (id === GOOGLE_TAG_ID_PADRAO ? ROTULO_COMPRA_PADRAO : '')

const INTERNO = ['/admin', '/ligador'] // áreas internas não viram evento/público

export const tagIdValido = (id) => /^(AW|G|GT)-[A-Z0-9]+$/i.test(id || '')

// Aceita o rótulo puro ("AbC123") ou o send_to inteiro ("AW-123/AbC123").
export function normalizarRotulo(v) {
  return String(v || '').trim().split('/').pop()
}

let pronto = null

async function lerConfig() {
  const cfg = { id: GOOGLE_TAG_ID_PADRAO, cadastro: '', compra: '' }
  if (!isSupabaseConfigured) return cfg
  try {
    const { data } = await supabase
      .from('configuracoes')
      .select('chave, valor')
      .in('chave', [CONFIG_KEYS.googleTagId, CONFIG_KEYS.googleConversaoCadastro, CONFIG_KEYS.googleConversaoCompra])
    const por = Object.fromEntries((data || []).map((r) => [r.chave, (r.valor || '').trim()]))
    if (tagIdValido(por[CONFIG_KEYS.googleTagId])) cfg.id = por[CONFIG_KEYS.googleTagId]
    cfg.cadastro = normalizarRotulo(por[CONFIG_KEYS.googleConversaoCadastro])
    cfg.compra = por[CONFIG_KEYS.googleConversaoCompra]
  } catch { /* sem rede → segue com o padrão */ }
  cfg.compra = rotuloCompraEfetivo(cfg.id, cfg.compra)
  return cfg
}

export function iniciarGoogleTag() {
  if (pronto || typeof window === 'undefined') return pronto
  if (INTERNO.some((x) => window.location.pathname.startsWith(x))) return null
  pronto = lerConfig().then((cfg) => {
    window.dataLayer = window.dataLayer || []
    window.gtag = window.gtag || function gtag() { window.dataLayer.push(arguments) }
    const s = document.createElement('script')
    s.async = true
    s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(cfg.id)}`
    document.head.appendChild(s)
    window.gtag('js', new Date())
    window.gtag('config', cfg.id)
    return cfg
  })
  return pronto
}

// tipo: 'cadastro' | 'compra'. Sem rótulo salvo no /admin, não dispara nada.
export function googleConversao(tipo, params) {
  if (!pronto) return
  pronto.then((cfg) => {
    const rotulo = cfg[tipo]
    if (!rotulo) return
    if (INTERNO.some((x) => window.location.pathname.startsWith(x))) return
    window.gtag('event', 'conversion', { send_to: `${cfg.id}/${rotulo}`, ...(params || {}) })
  }).catch(() => {})
}
