import { useEffect, useState } from 'react'
import { getConfig, setConfig, CONFIG_KEYS } from '../../lib/config.js'
import { supabase, isSupabaseConfigured } from '../../lib/supabase.js'
import { pegarNome, pegarNascimento, formatarData } from '../../lib/consultaCpf.js'
import { maskCpf, maskTelefone, onlyDigits } from '../../utils/masks.js'
import { DEFAULT_WHATSAPP_COBRANCA_MESSAGE, normalizarNumeroWhatsApp, normalizarTemplateCobrancaWhatsapp } from '../../lib/whatsappCobranca.js'
import { GOOGLE_TAG_ID_PADRAO, tagIdValido, normalizarRotulo, rotuloCompraEfetivo } from '../../lib/googletag.js'

const GOOGLE_TAG_INICIAL = { id: GOOGLE_TAG_ID_PADRAO, cadastro: '', compra: rotuloCompraEfetivo(GOOGLE_TAG_ID_PADRAO, '') }

const supaUrl = import.meta.env.VITE_SUPABASE_URL || ''

// Gateways que podem entrar no rodízio (ordem canônica = prioridade após o ativo).
const GATEWAYS_RODIZIO = [
  { id: 'umbrella', nome: 'Umbrella' },
  { id: 'payforge', nome: 'PayForge' },
  { id: 'pagarme', nome: 'Pagar.me' },
]
const nomeGw = (id) => GATEWAYS_RODIZIO.find((g) => g.id === id)?.nome || id
const WHATSAPP_COBRANCA_INICIAL = {
  ativo: false,
  numeroAtendimento: '',
  esperaMinutos: '5',
  mensagem: DEFAULT_WHATSAPP_COBRANCA_MESSAGE,
}

function StatusDot({ ok, label }) {
  const cls = ok ? 'is-ok' : 'is-off'
  return (
    <span className={`cfg-status ${cls}`}>
      <i /> {label}
    </span>
  )
}

export default function AdminConfig() {
  const [health, setHealth] = useState(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState('')
  // Sincronização dos sorteios (puxa da API oficial → snapshot no Supabase).
  const [syncBusy, setSyncBusy] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')

  // Logo no topo da página inicial (liga/desliga) — padrão ligado.
  const [logoHome, setLogoHome] = useState(true)
  const [logoHomeBusy, setLogoHomeBusy] = useState(false)
  const [logoHomeMsg, setLogoHomeMsg] = useState('')

  // Hero Banner Custom
  const [bannerUrl, setBannerUrl] = useState('')
  const [bannerUrlSalvo, setBannerUrlSalvo] = useState('')
  const [uploading, setUploading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [bannerMsg, setBannerMsg] = useState('')

  // Configs editáveis (link do grupo + vídeo da premiação)
  const [wpp, setWpp] = useState('')
  const [wppSalvo, setWppSalvo] = useState('')
  const [wppMsg, setWppMsg] = useState('')
  const [wppBusy, setWppBusy] = useState(false)

  const [waCobranca, setWaCobranca] = useState(WHATSAPP_COBRANCA_INICIAL)
  const [waCobrancaSalva, setWaCobrancaSalva] = useState(WHATSAPP_COBRANCA_INICIAL)
  const [waCobrancaMsg, setWaCobrancaMsg] = useState('')
  const [waCobrancaBusy, setWaCobrancaBusy] = useState(false)

  const [vid, setVid] = useState('')
  const [vidSalvo, setVidSalvo] = useState('')
  const [vidMsg, setVidMsg] = useState('')
  const [vidBusy, setVidBusy] = useState(false)

  const [token, setToken] = useState('')
  const [tokenSalvo, setTokenSalvo] = useState('')
  const [tokenMsg, setTokenMsg] = useState('')
  const [tokenBusy, setTokenBusy] = useState(false)
  // Teste de consulta OwnData na hora (diagnóstico): digita um CPF e vê o que volta.
  const [cpfTeste, setCpfTeste] = useState('')
  const [testeBusy, setTesteBusy] = useState(false)
  const [testeOut, setTesteOut] = useState(null)

  // Token da API da UTMify (envio de vendas pelo backend)
  const [utmify, setUtmify] = useState('')
  const [utmifySalvo, setUtmifySalvo] = useState('')
  const [utmifyMsg, setUtmifyMsg] = useState('')
  const [utmifyBusy, setUtmifyBusy] = useState(false)

  // Tag do Google Ads + rótulos de conversão
  const [gtag, setGtag] = useState(GOOGLE_TAG_INICIAL)
  const [gtagSalvo, setGtagSalvo] = useState(GOOGLE_TAG_INICIAL)
  const [gtagMsg, setGtagMsg] = useState('')
  const [gtagBusy, setGtagBusy] = useState(false)

  // CPFs/e-mails de teste (compras vão à UTMify como isTest — não contam nas métricas)
  const [utmifyTest, setUtmifyTest] = useState('')
  const [utmifyTestSalvo, setUtmifyTestSalvo] = useState('')
  const [utmifyTestMsg, setUtmifyTestMsg] = useState('')
  const [utmifyTestBusy, setUtmifyTestBusy] = useState(false)



  const [resend, setResend] = useState('')
  const [resendSalvo, setResendSalvo] = useState('')
  const [remetente, setRemetente] = useState('')
  const [remetenteSalvo, setRemetenteSalvo] = useState('')
  const [emailMsg, setEmailMsg] = useState('')
  const [emailBusy, setEmailBusy] = useState(false)

  // Gateway de pagamento (Pagar.me x PayForge)
  const [gateway, setGateway] = useState('pagarme')
  const [gatewaySalvo, setGatewaySalvo] = useState('pagarme')
  const [rodizio, setRodizio] = useState([]) // gates no rodízio (ids)
  const [rodizioSalvo, setRodizioSalvo] = useState([])
  const [gwMsg, setGwMsg] = useState('')
  const [gwBusy, setGwBusy] = useState(false)
  // Chaves da PayForge (secretKey/publicKey/webhook) + teste de conexão
  const [pfSecret, setPfSecret] = useState('')
  const [pfSecretSalvo, setPfSecretSalvo] = useState('')
  const [pfPublic, setPfPublic] = useState('')
  const [pfPublicSalvo, setPfPublicSalvo] = useState('')
  const [pfWebhook, setPfWebhook] = useState('')
  const [pfWebhookSalvo, setPfWebhookSalvo] = useState('')
  const [pfTest, setPfTest] = useState(null)
  const [pfTestBusy, setPfTestBusy] = useState(false)
  const [umKey, setUmKey] = useState('')
  const [umKeySalvo, setUmKeySalvo] = useState('')
  const [umWebhook, setUmWebhook] = useState('')
  const [umWebhookSalvo, setUmWebhookSalvo] = useState('')
  const [umTest, setUmTest] = useState(null)
  const [umTestBusy, setUmTestBusy] = useState(false)
  // Chaves do Pagar.me (secret/webhook) — agora configuráveis pelo /admin
  const [pgSecret, setPgSecret] = useState('')
  const [pgSecretSalvo, setPgSecretSalvo] = useState('')
  const [pgWebhook, setPgWebhook] = useState('')
  const [pgWebhookSalvo, setPgWebhookSalvo] = useState('')

  // Serasa Experian (Client ID/Secret + proxy IPv4 dedicado)
  const [seClientId, setSeClientId] = useState('')
  const [seClientIdSalvo, setSeClientIdSalvo] = useState('')
  const [seClientSecret, setSeClientSecret] = useState('')
  const [seClientSecretSalvo, setSeClientSecretSalvo] = useState('')
  const [seProxy, setSeProxy] = useState('')
  const [seProxySalvo, setSeProxySalvo] = useState('')

  // Base de consulta de CPF ativa: 'serasa' (padrão) ou 'supremo'.
  const [baseConsulta, setBaseConsulta] = useState('serasa')
  const [baseConsultaSalva, setBaseConsultaSalva] = useState('serasa')
  const [baseBusy, setBaseBusy] = useState(false)
  const [baseMsg, setBaseMsg] = useState('')
  const [seMsg, setSeMsg] = useState('')
  const [seBusy, setSeBusy] = useState(false)
  const [seTest, setSeTest] = useState(null)
  const [seTestBusy, setSeTestBusy] = useState(false)



  useEffect(() => {
    getConfig(CONFIG_KEYS.whatsappGanhadores).then((v) => { setWpp(v); setWppSalvo(v) })
    Promise.all([
      getConfig(CONFIG_KEYS.whatsappCobrancaAtivo),
      getConfig(CONFIG_KEYS.whatsappCobrancaNumero),
      getConfig(CONFIG_KEYS.whatsappCobrancaEsperaMinutos),
      getConfig(CONFIG_KEYS.whatsappCobrancaMensagem),
    ]).then(([ativo, numeroAtendimento, esperaMinutos, mensagem]) => {
      const espera = Number(esperaMinutos)
      const numeroNormalizado = normalizarNumeroWhatsApp(numeroAtendimento)
      const cfg = {
        ativo: ativo === 'true',
        numeroAtendimento: numeroNormalizado ? maskTelefone(numeroNormalizado.replace(/^55/, '')) : '',
        esperaMinutos: String(Math.max(0, Math.min(120, Number.isFinite(espera) ? espera : 5))),
        mensagem: normalizarTemplateCobrancaWhatsapp(mensagem || DEFAULT_WHATSAPP_COBRANCA_MESSAGE),
      }
      setWaCobranca(cfg)
      setWaCobrancaSalva(cfg)
    }).catch(() => {})
    getConfig(CONFIG_KEYS.videoPremiacao).then((v) => { setVid(v); setVidSalvo(v) })
    getConfig(CONFIG_KEYS.heroBannerUrl).then((v) => { setBannerUrl(v); setBannerUrlSalvo(v) })
    getConfig(CONFIG_KEYS.logoHomeAtivo).then((v) => setLogoHome(v !== 'false')) // '' (não configurado) = ligado
    getConfig(CONFIG_KEYS.owndataToken).then((v) => { setToken(v); setTokenSalvo(v) })
    getConfig(CONFIG_KEYS.utmifyApiToken).then((v) => { setUtmify(v); setUtmifySalvo(v) })
    getConfig(CONFIG_KEYS.utmifyTestCpfs).then((v) => { setUtmifyTest(v); setUtmifyTestSalvo(v) })
    Promise.all([
      getConfig(CONFIG_KEYS.googleTagId),
      getConfig(CONFIG_KEYS.googleConversaoCadastro),
      getConfig(CONFIG_KEYS.googleConversaoCompra),
    ]).then(([id, cadastro, compra]) => {
      const idEfetivo = id || GOOGLE_TAG_ID_PADRAO
      const cfg = { id: idEfetivo, cadastro, compra: rotuloCompraEfetivo(idEfetivo, compra) }
      setGtag(cfg)
      setGtagSalvo(cfg)
    }).catch(() => {})

    getConfig(CONFIG_KEYS.resendKey).then((v) => { setResend(v); setResendSalvo(v) })
    getConfig(CONFIG_KEYS.emailRemetente).then((v) => { setRemetente(v); setRemetenteSalvo(v) })
    getConfig(CONFIG_KEYS.gatewayAtivo).then((v) => { const g = GATEWAYS_RODIZIO.some((x) => x.id === v) ? v : 'pagarme'; setGateway(g); setGatewaySalvo(g) })
    getConfig(CONFIG_KEYS.gatewayRodizio).then((v) => {
      const arr = String(v || '').split(',').map((s) => s.trim().toLowerCase()).filter((s) => GATEWAYS_RODIZIO.some((g) => g.id === s))
      setRodizio(arr); setRodizioSalvo(arr)
    })
    getConfig(CONFIG_KEYS.payforgeSecretKey).then((v) => { setPfSecret(v); setPfSecretSalvo(v) })
    getConfig(CONFIG_KEYS.payforgePublicKey).then((v) => { setPfPublic(v); setPfPublicSalvo(v) })
    getConfig(CONFIG_KEYS.payforgeWebhookKey).then((v) => { setPfWebhook(v); setPfWebhookSalvo(v) })
    getConfig(CONFIG_KEYS.umbrellaApiKey).then((v) => { setUmKey(v); setUmKeySalvo(v) })
    getConfig(CONFIG_KEYS.umbrellaWebhookKey).then((v) => { setUmWebhook(v); setUmWebhookSalvo(v) })
    getConfig(CONFIG_KEYS.pagarmeSecretKey).then((v) => { setPgSecret(v); setPgSecretSalvo(v) })
    getConfig(CONFIG_KEYS.pagarmeWebhookKey).then((v) => { setPgWebhook(v); setPgWebhookSalvo(v) })
    getConfig(CONFIG_KEYS.serasaClientIdKey).then((v) => { setSeClientId(v); setSeClientIdSalvo(v) })
    getConfig(CONFIG_KEYS.serasaClientSecretKey).then((v) => { setSeClientSecret(v); setSeClientSecretSalvo(v) })
    getConfig(CONFIG_KEYS.serasaProxyKey).then((v) => { setSeProxy(v); setSeProxySalvo(v) })
    getConfig(CONFIG_KEYS.baseConsultaCpf).then((v) => { const b = v === 'supremo' ? v : 'serasa'; setBaseConsulta(b); setBaseConsultaSalva(b) })

  }, [])

  // Liga/desliga a logo da página inicial — salva na hora (sem botão "Salvar" separado).
  const toggleLogoHome = async (checked) => {
    setLogoHomeBusy(true)
    setLogoHomeMsg('')
    const anterior = logoHome
    setLogoHome(checked) // otimista
    try {
      await setConfig(CONFIG_KEYS.logoHomeAtivo, checked ? 'true' : 'false')
    } catch (e) {
      setLogoHome(anterior) // reverte se falhar
      setLogoHomeMsg(e.message || 'Não foi possível salvar agora.')
    }
    setLogoHomeBusy(false)
  }

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    
    // Validar tipo de arquivo
    if (!file.type.startsWith('image/')) {
      setBannerMsg('Erro: O arquivo selecionado deve ser uma imagem.')
      return
    }

    setUploading(true)
    setBannerMsg('')

    try {
      if (!isSupabaseConfigured) {
        throw new Error('Supabase não configurado')
      }

      const extension = file.name.split('.').pop() || 'jpg'
      const fileName = `banner_${Date.now()}.${extension}`

      // Upload para o bucket 'hero-banner'
      const { data, error } = await supabase.storage
        .from('hero-banner')
        .upload(fileName, file, { cacheControl: '3600', upsert: true })

      if (error) throw error

      // Pegar URL pública do banner carregado
      const { data: urlData } = supabase.storage
        .from('hero-banner')
        .getPublicUrl(fileName)

      const newUrl = urlData.publicUrl

      // Salvar na tabela de configurações
      await setConfig(CONFIG_KEYS.heroBannerUrl, newUrl)
      
      setBannerUrl(newUrl)
      setBannerUrlSalvo(newUrl)
      setBannerMsg('ok')
      setTimeout(() => setBannerMsg(''), 2500)
    } catch (e) {
      setBannerMsg(e.message || 'Erro ao fazer upload da imagem.')
    } finally {
      setUploading(false)
      // Reset input
      e.target.value = ''
    }
  }

  const handleDelete = async () => {
    if (!window.confirm('Tem certeza que deseja excluir o banner personalizado e voltar ao banner padrão?')) {
      return
    }

    setDeleting(true)
    setBannerMsg('')

    try {
      if (!isSupabaseConfigured) {
        throw new Error('Supabase não configurado')
      }

      if (bannerUrl) {
        // Tentar extrair o nome do arquivo da URL para deletar do Storage
        const parts = bannerUrl.split('/')
        const fileName = parts[parts.length - 1]
        
        if (fileName) {
          await supabase.storage.from('hero-banner').remove([fileName])
        }
      }

      // Resetar configuração para vazio
      await setConfig(CONFIG_KEYS.heroBannerUrl, '')
      
      setBannerUrl('')
      setBannerUrlSalvo('')
      setBannerMsg('ok_del')
      setTimeout(() => setBannerMsg(''), 2500)
    } catch (e) {
      setBannerMsg(e.message || 'Erro ao remover a imagem.')
    } finally {
      setDeleting(false)
    }
  }

  const salvarWpp = async () => {
    setWppMsg('')
    setWppBusy(true)
    try {
      await setConfig(CONFIG_KEYS.whatsappGanhadores, wpp.trim())
      setWppSalvo(wpp.trim())
      setWppMsg('ok')
      setTimeout(() => setWppMsg(''), 2500)
    } catch (e) {
      setWppMsg(e.message || 'Erro ao salvar.')
    }
    setWppBusy(false)
  }

  const salvarWhatsappCobranca = async () => {
    setWaCobrancaMsg('')
    const numero = normalizarNumeroWhatsApp(waCobranca.numeroAtendimento)
    const esperaMinutos = String(Math.round(Math.max(0, Math.min(120, Number(waCobranca.esperaMinutos) || 0))))
    const mensagem = normalizarTemplateCobrancaWhatsapp(waCobranca.mensagem.trim() || DEFAULT_WHATSAPP_COBRANCA_MESSAGE)
    const final = {
      ...waCobranca,
      numeroAtendimento: numero ? maskTelefone(numero.replace(/^55/, '')) : '',
      esperaMinutos,
      mensagem,
    }

    setWaCobrancaBusy(true)
    try {
      // Ao ativar, salva os detalhes primeiro e a chave de ativação por último.
      // Ao desativar, faz o inverso para retirar o botão imediatamente.
      if (!final.ativo) await setConfig(CONFIG_KEYS.whatsappCobrancaAtivo, 'false')
      await Promise.all([
        setConfig(CONFIG_KEYS.whatsappCobrancaNumero, numero),
        setConfig(CONFIG_KEYS.whatsappCobrancaEsperaMinutos, final.esperaMinutos),
        setConfig(CONFIG_KEYS.whatsappCobrancaMensagem, final.mensagem),
      ])
      if (final.ativo) await setConfig(CONFIG_KEYS.whatsappCobrancaAtivo, 'true')
      setWaCobranca(final)
      setWaCobrancaSalva(final)
      setWaCobrancaMsg('ok')
      setTimeout(() => setWaCobrancaMsg(''), 2500)
    } catch (e) {
      setWaCobrancaMsg(e.message || 'Erro ao salvar.')
    }
    setWaCobrancaBusy(false)
  }

  const salvarVid = async () => {
    setVidMsg('')
    setVidBusy(true)
    try {
      await setConfig(CONFIG_KEYS.videoPremiacao, vid.trim())
      setVidSalvo(vid.trim())
      setVidMsg('ok')
      setTimeout(() => setVidMsg(''), 2500)
    } catch (e) {
      setVidMsg(e.message || 'Erro ao salvar.')
    }
    setVidBusy(false)
  }

  const salvarToken = async () => {
    setTokenMsg('')
    setTokenBusy(true)
    try {
      await setConfig(CONFIG_KEYS.owndataToken, token.trim())
      setTokenSalvo(token.trim())
      setTokenMsg('ok')
      setTimeout(() => setTokenMsg(''), 2500)
    } catch (e) {
      setTokenMsg(e.message || 'Erro ao salvar.')
    }
    setTokenBusy(false)
  }

  // Testa a consulta OwnData na hora com um CPF — mostra o que a API devolve
  // (dados ou o motivo do erro). Só funciona no site publicado (/api).
  const testarConsulta = async () => {
    const c = onlyDigits(cpfTeste)
    if (c.length !== 11) { setTesteOut({ erro: 'Digite um CPF com 11 dígitos.' }); return }
    setTesteBusy(true)
    setTesteOut(null)
    try {
      const r = await fetch(`/api/ganhador?cpf=${c}`)
      const ct = r.headers.get('content-type') || ''
      if (!ct.includes('application/json')) {
        setTesteOut({ erro: 'A consulta só funciona no site publicado (no localhost as rotas /api não rodam).' })
      } else {
        const data = await r.json().catch(() => null)
        setTesteOut({ httpOk: r.ok, data })
      }
    } catch (e) {
      setTesteOut({ erro: e.message || 'Falha ao testar.' })
    }
    setTesteBusy(false)
  }

  const salvarUtmify = async () => {
    setUtmifyMsg('')
    setUtmifyBusy(true)
    try {
      await setConfig(CONFIG_KEYS.utmifyApiToken, utmify.trim())
      setUtmifySalvo(utmify.trim())
      setUtmifyMsg('ok')
      setTimeout(() => setUtmifyMsg(''), 2500)
    } catch (e) {
      setUtmifyMsg(e.message || 'Erro ao salvar.')
    }
    setUtmifyBusy(false)
  }

  const salvarGtag = async () => {
    setGtagMsg('')
    const final = {
      id: gtag.id.trim().toUpperCase(),
      cadastro: normalizarRotulo(gtag.cadastro),
      compra: normalizarRotulo(gtag.compra),
    }
    if (!tagIdValido(final.id)) {
      setGtagMsg('ID inválido. O formato é AW-123456789 (copie do Google Ads).')
      return
    }
    setGtagBusy(true)
    try {
      await Promise.all([
        setConfig(CONFIG_KEYS.googleTagId, final.id),
        setConfig(CONFIG_KEYS.googleConversaoCadastro, final.cadastro),
        setConfig(CONFIG_KEYS.googleConversaoCompra, final.compra),
      ])
      setGtag(final)
      setGtagSalvo(final)
      setGtagMsg('ok')
      setTimeout(() => setGtagMsg(''), 2500)
    } catch (e) {
      setGtagMsg(e.message || 'Erro ao salvar.')
    }
    setGtagBusy(false)
  }

  const salvarUtmifyTest = async () => {
    setUtmifyTestMsg('')
    setUtmifyTestBusy(true)
    try {
      await setConfig(CONFIG_KEYS.utmifyTestCpfs, utmifyTest.trim())
      setUtmifyTestSalvo(utmifyTest.trim())
      setUtmifyTestMsg('ok')
      setTimeout(() => setUtmifyTestMsg(''), 2500)
    } catch (e) {
      setUtmifyTestMsg(e.message || 'Erro ao salvar.')
    }
    setUtmifyTestBusy(false)
  }



  const salvarEmail = async () => {
    setEmailMsg('')
    setEmailBusy(true)
    try {
      await setConfig(CONFIG_KEYS.resendKey, resend.trim())
      await setConfig(CONFIG_KEYS.emailRemetente, remetente.trim())
      setResendSalvo(resend.trim())
      setRemetenteSalvo(remetente.trim())
      setEmailMsg('ok')
      setTimeout(() => setEmailMsg(''), 2500)
    } catch (e) {
      setEmailMsg(e.message || 'Erro ao salvar.')
    }
    setEmailBusy(false)
  }


  const toggleRodizio = (id) => {
    setRodizio((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
  }

  const salvarGateway = async () => {
    setGwMsg('')
    setGwBusy(true)
    try {
      // Salva o rodízio em ordem canônica (prioridade), só com gates marcadas.
      const rodizioOrdenado = GATEWAYS_RODIZIO.map((g) => g.id).filter((id) => rodizio.includes(id))
      await setConfig(CONFIG_KEYS.gatewayAtivo, gateway)
      await setConfig(CONFIG_KEYS.gatewayRodizio, rodizioOrdenado.join(','))
      await setConfig(CONFIG_KEYS.payforgeSecretKey, pfSecret.trim())
      await setConfig(CONFIG_KEYS.payforgePublicKey, pfPublic.trim())
      await setConfig(CONFIG_KEYS.payforgeWebhookKey, pfWebhook.trim())
      await setConfig(CONFIG_KEYS.umbrellaApiKey, umKey.trim())
      await setConfig(CONFIG_KEYS.umbrellaWebhookKey, umWebhook.trim())
      await setConfig(CONFIG_KEYS.pagarmeSecretKey, pgSecret.trim())
      await setConfig(CONFIG_KEYS.pagarmeWebhookKey, pgWebhook.trim())
      setGatewaySalvo(gateway)
      setPfSecretSalvo(pfSecret.trim())
      setPfPublicSalvo(pfPublic.trim())
      setPfWebhookSalvo(pfWebhook.trim())
      setUmKeySalvo(umKey.trim())
      setUmWebhookSalvo(umWebhook.trim())
      setPgSecretSalvo(pgSecret.trim())
      setPgWebhookSalvo(pgWebhook.trim())
      setRodizio(rodizioOrdenado)
      setRodizioSalvo(rodizioOrdenado)
      setGwMsg('ok')
      setTimeout(() => setGwMsg(''), 2500)
    } catch (e) {
      setGwMsg(e.message || 'Erro ao salvar.')
    }
    setGwBusy(false)
  }

  // Diagnóstico: usa as chaves SALVAS e testa a conexão com o gateway.
  const testarGateway = async (gw, setBusy, setResultado) => {
    setBusy(true)
    setResultado(null)
    try {
      const r = await fetch(`/api/${gw}/health`)
      const ct = r.headers.get('content-type') || ''
      if (!ct.includes('application/json')) {
        setResultado({ ok: false, message: 'O teste só funciona no site publicado (no localhost as rotas /api não rodam).' })
      } else {
        setResultado(await r.json())
      }
    } catch (e) {
      setResultado({ ok: false, message: e.message || 'Falha ao testar.' })
    }
    setBusy(false)
  }
  const testarPayforge = () => testarGateway('payforge', setPfTestBusy, setPfTest)
  const testarUmbrella = () => testarGateway('umbrella', setUmTestBusy, setUmTest)

  const salvarBaseConsulta = async () => {
    setBaseMsg('')
    setBaseBusy(true)
    try {
      await setConfig(CONFIG_KEYS.baseConsultaCpf, baseConsulta)
      setBaseConsultaSalva(baseConsulta)
      setBaseMsg('ok')
      setTimeout(() => setBaseMsg(''), 2500)
    } catch (e) {
      setBaseMsg(e.message || 'Erro ao salvar.')
    }
    setBaseBusy(false)
  }

  const salvarSerasa = async () => {
    setSeMsg('')
    setSeBusy(true)
    try {
      await setConfig(CONFIG_KEYS.serasaClientIdKey, seClientId.trim())
      await setConfig(CONFIG_KEYS.serasaClientSecretKey, seClientSecret.trim())
      await setConfig(CONFIG_KEYS.serasaProxyKey, seProxy.trim())
      setSeClientIdSalvo(seClientId.trim())
      setSeClientSecretSalvo(seClientSecret.trim())
      setSeProxySalvo(seProxy.trim())
      setSeMsg('ok')
      setTimeout(() => setSeMsg(''), 2500)
    } catch (e) {
      setSeMsg(e.message || 'Erro ao salvar.')
    }
    setSeBusy(false)
  }

  // Diagnóstico: usa as credenciais e o proxy SALVOS e testa o login na Serasa
  // (só emite o token — não gasta consulta paga).
  const testarSerasa = async () => {
    setSeTestBusy(true)
    setSeTest(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) { setSeTest({ ok: false, message: 'Sessão expirada — entre de novo.' }); return }
      const r = await fetch('/api/admin/serasa-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      })
      const ct = r.headers.get('content-type') || ''
      if (!ct.includes('application/json')) {
        setSeTest({ ok: false, message: 'O teste só funciona no site publicado (no localhost as rotas /api não rodam).' })
      } else {
        setSeTest(await r.json())
      }
    } catch (e) {
      setSeTest({ ok: false, message: e.message || 'Falha ao testar.' })
    }
    setSeTestBusy(false)
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const isLocal = /localhost|127\.0\.0\.1/.test(origin)
  const webhookUrl = `${origin}/api/pagarme/webhook${pgWebhookSalvo ? `?secret=${encodeURIComponent(pgWebhookSalvo)}` : ''}`
  const umbrellaWebhookUrl = `${origin}/api/umbrella/webhook${umWebhookSalvo ? `?secret=${encodeURIComponent(umWebhookSalvo)}` : ''}`
  const payforgeWebhookUrl = `${origin}/api/payforge/webhook${pfWebhookSalvo ? `?secret=${encodeURIComponent(pfWebhookSalvo)}` : ''}`

  useEffect(() => {
    let on = true
    fetch('/api/pagarme/health')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (on) {
          setHealth(d)
          setLoading(false)
        }
      })
      .catch(() => on && setLoading(false))
    return () => {
      on = false
    }
  }, [])

  const copy = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied(''), 2000)
    } catch {
      /* ignore */
    }
  }

  // Botão "Atualizar sorteios": força o servidor a puxar da API oficial e salvar o
  // snapshot no Supabase (o site passa a ler dali). 1 clique = tudo atualizado.
  const atualizarSorteios = async () => {
    setSyncBusy(true)
    setSyncMsg('')
    try {
      const r = await fetch('/api/sorteios', { method: 'POST' })
      const d = await r.json().catch(() => ({}))
      if (d.ok) setSyncMsg('ok:' + (d.count ?? ''))
      else setSyncMsg(d.error || 'Não foi possível atualizar agora. Tente de novo.')
    } catch (e) {
      setSyncMsg(e.message || 'Falha ao atualizar.')
    }
    setSyncBusy(false)
  }

  return (
    <div>
      <header className="adm__pagehead">
        <div>
          <h1 className="adm__title">Configurações</h1>
          <p className="adm__subtitle">Integrações, chaves de API e ajustes do site</p>
        </div>
      </header>

      {/* Banner Principal da Tela Inicial */}
      <div className="adm__panel">
        <h2 className="adm__panel-title">Banner Principal (Hero)</h2>
        <p className="usr-muted">
          Gerencie a imagem de destaque exibida no topo da tela inicial.
          Selecione e envie uma imagem personalizada para substituir o banner padrão, ou remova para restaurar a imagem original.
          Recomendado usar proporção 16:9 (ex.: 1008x567 pixels) para um melhor encaixe visual.
        </p>

        {/* Preview do banner atual */}
        <div className="banner-cfg__preview">
          <span className={`banner-cfg__badge ${bannerUrl ? 'is-custom' : ''}`}>
            {bannerUrl ? 'Personalizado' : 'Padrão'}
          </span>
          <img 
            src={bannerUrl || '/img/hero-um-milhao.jpg'} 
            alt="Preview do Banner" 
            onError={(e) => { e.target.src = '/img/hero-um-milhao.jpg' }}
          />
        </div>

        {/* Zona de Upload */}
        {!isSupabaseConfigured ? (
          <p className="cfg-warn">
            Supabase não configurado. Ative a integração com o Supabase nas variáveis de ambiente para gerenciar o banner.
          </p>
        ) : (
          <div className="banner-cfg__actions">
            <label className="banner-cfg__upload-zone" style={{ flex: 1 }}>
              <input 
                type="file" 
                accept="image/*" 
                onChange={handleUpload} 
                disabled={uploading || deleting} 
                style={{ display: 'none' }}
              />
              <span className="banner-cfg__upload-text">
                {uploading ? 'Enviando imagem...' : 'Clique para selecionar a nova imagem'}
              </span>
              <span className="banner-cfg__upload-hint">
                Formatos suportados: PNG, JPG, JPEG, WEBP. Máx: 5MB
              </span>
            </label>

            {bannerUrl && (
              <button 
                type="button" 
                className="banner-cfg__btn-danger" 
                onClick={handleDelete}
                disabled={uploading || deleting}
              >
                {deleting ? 'Removendo...' : 'Remover Imagem'}
              </button>
            )}
          </div>
        )}

        {bannerMsg === 'ok' && <p style={{ color: '#2bb24c', marginTop: '10px', fontWeight: 'bold' }}>✓ Banner atualizado com sucesso!</p>}
        {bannerMsg === 'ok_del' && <p style={{ color: '#2bb24c', marginTop: '10px', fontWeight: 'bold' }}>✓ Banner removido. Retornando ao padrão.</p>}
        {bannerMsg && bannerMsg !== 'ok' && bannerMsg !== 'ok_del' && (
          <p className="cfg-warn" style={{ marginTop: '10px' }}>{bannerMsg}</p>
        )}
      </div>

      {/* Logo no topo da página inicial */}
      <div className="adm__panel">
        <h2 className="adm__panel-title">Logo no topo (página inicial)</h2>
        <p className="usr-muted">
          Liga/desliga a logo do Viva Sorte que aparece no topo, só na <strong>página inicial</strong>.
          Desligado, a logo some de lá e o resto do site continua igual (as outras páginas mantêm a logo sempre).
        </p>
        <div className="cfg-grid" style={{ marginTop: 14 }}>
          <label className="cfg-checkline">
            <input
              type="checkbox"
              checked={logoHome}
              disabled={logoHomeBusy}
              onChange={(e) => toggleLogoHome(e.target.checked)}
            />
            Mostrar a logo na página inicial
          </label>
          <StatusDot ok={logoHome} label={logoHome ? 'Logo ligada' : 'Logo desligada'} />
        </div>
        {logoHomeMsg && <p className="cfg-warn" style={{ marginTop: 10 }}>{logoHomeMsg}</p>}
      </div>

      {/* Sorteios do site (dados ao vivo) */}
      <div className="adm__panel">
        <h2 className="adm__panel-title">Sorteios do site (dados ao vivo)</h2>
        <p className="usr-muted">
          Os sorteios, preços e datas vêm da API oficial e ficam <strong>salvos na sua base</strong> —
          o site lê dali (rápido e sem depender da API em tempo real; se a API oficial cair, o site
          continua com o último sync). Clique pra <strong>puxar os dados mais recentes</strong> com 1 clique.
        </p>
        <div className="cfg-copy">
          <button onClick={atualizarSorteios} disabled={syncBusy} className={String(syncMsg).startsWith('ok') ? 'is-ok' : ''}>
            {syncBusy ? 'Atualizando…' : String(syncMsg).startsWith('ok') ? 'Atualizado!' : 'Atualizar sorteios agora'}
          </button>
        </div>
        {String(syncMsg).startsWith('ok') && (
          <p className="usr-muted">✓ Sorteios atualizados{syncMsg.split(':')[1] ? ` (${syncMsg.split(':')[1]} ativos)` : ''}. O site já mostra os dados novos ao recarregar.</p>
        )}
        {syncMsg && !String(syncMsg).startsWith('ok') && <p className="cfg-warn">{syncMsg}</p>}
      </div>

      {/* Gateway de pagamento (Pagar.me x PayForge) */}
      <div className="adm__panel">
        <h2 className="adm__panel-title">Gateway de pagamento</h2>
        <p className="usr-muted">
          Escolha qual gateway processa os Pix do site. A <strong>Pagar.me</strong> usa as variáveis de
          ambiente da Vercel; a <strong>PayForge</strong> usa as chaves abaixo (guardadas no banco — as chaves
          secretas ficam só no servidor, nunca vão para o navegador do cliente). Dá pra trocar a qualquer
          momento, sem deploy.
        </p>

        <p className="usr-muted"><strong>Gateway ativo</strong></p>
        <div className="cfg-copy">
          <select value={gateway} onChange={(e) => setGateway(e.target.value)}>
            <option value="pagarme">Pagar.me</option>
            <option value="umbrella">Umbrella</option>
            <option value="payforge">PayForge</option>
          </select>
        </div>

        <p className="usr-muted" style={{ marginTop: 16 }}><strong>Rodízio de gateways (failover automático)</strong></p>
        <p className="usr-muted">
          Marque as gates que entram no rodízio. Se uma <strong>recusar o Pix</strong> (ex.: teto de valor da
          adquirente), o site tenta a próxima automaticamente — e na tela do Pix o cliente pode pedir um novo
          código <em>por outro banco</em> até conseguir pagar. A fila começa pelo <strong>gateway ativo</strong>{' '}
          acima. Marque pelo menos 2 para o rodízio funcionar; deixe tudo desmarcado para desativar.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 18px', margin: '6px 0 8px' }}>
          {GATEWAYS_RODIZIO.map((g) => (
            <label key={g.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontWeight: 600 }}>
              <input type="checkbox" checked={rodizio.includes(g.id)} onChange={() => toggleRodizio(g.id)} />
              {g.nome}
            </label>
          ))}
        </div>
        <p className="usr-muted">
          {rodizioSalvo.length > 1
            ? <>Rodízio ativo: <strong>{[gatewaySalvo, ...rodizioSalvo.filter((x) => x !== gatewaySalvo)].filter((x) => rodizioSalvo.includes(x)).map(nomeGw).join(' → ')}</strong> (em loop).</>
            : 'Rodízio desativado — usando só o gateway ativo.'}
        </p>

        {gateway === 'umbrella' && (
          <>
            <p className="usr-muted"><strong>API Key</strong> da Umbrella (painel da Umbrella → Integrações / API)</p>
            <div className="cfg-copy">
              <input
                type="password"
                placeholder="API Key da Umbrella"
                value={umKey}
                onChange={(e) => setUmKey(e.target.value)}
                autoComplete="off"
              />
            </div>
            <p className="usr-muted">
              <strong>Webhook Secret</strong> (opcional) — qualquer texto aleatório. Vai como <code>?secret=…</code> na
              URL de aviso que o site manda em cada cobrança, e o webhook rejeita chamadas sem ele.
            </p>
            <div className="cfg-copy">
              <input
                type="password"
                placeholder="Webhook Secret (opcional)"
                value={umWebhook}
                onChange={(e) => setUmWebhook(e.target.value)}
                autoComplete="off"
              />
            </div>
          </>
        )}
        {gateway === 'payforge' && (
          <>
            <p className="usr-muted">Chave <strong>secreta</strong> (Secret Key) da PayForge</p>
            <div className="cfg-copy">
              <input
                type="password"
                placeholder="Chave secreta da PayForge"
                value={pfSecret}
                onChange={(e) => setPfSecret(e.target.value)}
                autoComplete="off"
              />
            </div>
            <p className="usr-muted">Chave <strong>pública</strong> (Public Key) da PayForge</p>
            <div className="cfg-copy">
              <input
                type="text"
                placeholder="Chave pública da PayForge"
                value={pfPublic}
                onChange={(e) => setPfPublic(e.target.value)}
                autoComplete="off"
              />
            </div>
            <p className="usr-muted">
              <strong>Webhook Secret/Token</strong> (opcional) — se preencher, o site protege o webhook com esse
              segredo (vai como <code>?secret=…</code> na URL do webhook). Deixe vazio se não usar.
            </p>
            <div className="cfg-copy">
              <input
                type="password"
                placeholder="Webhook Secret/Token (opcional)"
                value={pfWebhook}
                onChange={(e) => setPfWebhook(e.target.value)}
                autoComplete="off"
              />
            </div>
          </>
        )}
        {gateway === 'pagarme' && (
          <>
            <p className="usr-muted">Chave <strong>secreta</strong> (Secret Key) do Pagar.me — começa com <code>sk_</code></p>
            <div className="cfg-copy">
              <input
                type="password"
                placeholder="sk_live_…"
                value={pgSecret}
                onChange={(e) => setPgSecret(e.target.value)}
                autoComplete="off"
              />
            </div>
            <p className="usr-muted">
              <strong>Webhook Secret</strong> (opcional) — se preencher, o site protege o webhook com esse
              segredo (vai como <code>?secret=…</code> na URL do webhook). Deixe vazio se não usar.
            </p>
            <div className="cfg-copy">
              <input
                type="password"
                placeholder="Webhook Secret (opcional)"
                value={pgWebhook}
                onChange={(e) => setPgWebhook(e.target.value)}
                autoComplete="off"
              />
            </div>
            <p className="usr-muted">
              Dá pra configurar a chave aqui <strong>ou</strong> na variável <code>PAGARME_SECRET_KEY</code> da
              Vercel — o que estiver salvo aqui no /admin <strong>tem prioridade</strong>. Confira se a chave
              está válida no painel "Pagar.me — status da integração" mais abaixo (recarregue após salvar).
            </p>
          </>
        )}

        <div className="cfg-copy">
          <button
            onClick={salvarGateway}
            disabled={gwBusy || (gateway === gatewaySalvo && umKey.trim() === umKeySalvo && umWebhook.trim() === umWebhookSalvo && pfSecret.trim() === pfSecretSalvo && pfPublic.trim() === pfPublicSalvo && pfWebhook.trim() === pfWebhookSalvo && pgSecret.trim() === pgSecretSalvo && pgWebhook.trim() === pgWebhookSalvo && JSON.stringify([...rodizio].sort()) === JSON.stringify([...rodizioSalvo].sort()))}
            className={gwMsg === 'ok' ? 'is-ok' : ''}
          >
            {gwBusy ? 'Salvando…' : gwMsg === 'ok' ? 'Salvo!' : 'Salvar'}
          </button>
        </div>
        {gwMsg && gwMsg !== 'ok' && <p className="cfg-warn">{gwMsg}</p>}
        <p className="usr-muted">
          Em uso agora: <strong>{nomeGw(gatewaySalvo)}</strong>
          {gatewaySalvo === 'umbrella' && (umKeySalvo ? ' · API Key ✓' : ' · falta a API Key')}
          {gatewaySalvo === 'payforge' && (pfSecretSalvo ? ' · chave secreta ✓' : ' · falta a chave secreta')}
          {gatewaySalvo === 'pagarme' && (pgSecretSalvo ? ' · chave secreta ✓ (/admin)' : ' · veja o status abaixo (env da Vercel)')}
        </p>

        {gateway === 'umbrella' && (
          <>
            <p className="usr-muted">
              <strong>Testar conexão</strong> — usa a chave <em>salva</em> (salve antes):
            </p>
            <div className="cfg-copy">
              <button onClick={testarUmbrella} disabled={umTestBusy}>
                {umTestBusy ? 'Testando…' : 'Testar conexão Umbrella'}
              </button>
            </div>
            {umTest && (
              <p className={umTest.ok ? 'usr-muted' : 'cfg-warn'}>
                {umTest.ok ? '✅ ' : '⚠️ '}{umTest.message}
              </p>
            )}
            <p className="usr-muted">
              Não precisa cadastrar webhook no painel da Umbrella: o site envia esta URL automaticamente em cada
              cobrança (exige <code>PUBLIC_SITE_URL</code> configurada no Render):
            </p>
            <div className="cfg-copy">
              <input readOnly value={umbrellaWebhookUrl} onFocus={(e) => e.target.select()} />
              <button className={copied === 'umwh' ? 'is-ok' : ''} onClick={() => copy(umbrellaWebhookUrl, 'umwh')}>
                {copied === 'umwh' ? 'Copiado!' : 'Copiar'}
              </button>
            </div>
          </>
        )}
        {gateway === 'payforge' && (
          <>
            <p className="usr-muted">
              <strong>Testar conexão</strong> — usa as chaves <em>salvas</em> (salve antes) e verifica
              se a chave/conta da PayForge estão OK:
            </p>
            <div className="cfg-copy">
              <button onClick={testarPayforge} disabled={pfTestBusy}>
                {pfTestBusy ? 'Testando…' : 'Testar conexão PayForge'}
              </button>
            </div>
            {pfTest && (
              <>
                <p className={pfTest.ok ? 'usr-muted' : 'cfg-warn'}>
                  {pfTest.ok ? '✅ ' : '⚠️ '}{pfTest.message}
                </p>
                {pfTest.probe && (
                  <p className="usr-muted">
                    {pfTest.probe.path}: {pfTest.probe.status}
                  </p>
                )}
              </>
            )}
            <p className="usr-muted">
              Cadastre este <strong>webhook</strong> no painel da PayForge (evento{' '}
              <em>TRANSACTION_PAID / Transação Paga</em>) — assim o pagamento é confirmado automaticamente. Se você
              preencheu o <strong>Webhook Secret/Token</strong>, ele já vai embutido nesta URL:
            </p>
            <div className="cfg-copy">
              <input readOnly value={payforgeWebhookUrl} onFocus={(e) => e.target.select()} />
              <button className={copied === 'pfwh' ? 'is-ok' : ''} onClick={() => copy(payforgeWebhookUrl, 'pfwh')}>
                {copied === 'pfwh' ? 'Copiado!' : 'Copiar'}
              </button>
            </div>
            {isLocal && (
              <p className="cfg-warn">
                Você está no <strong>localhost</strong> — troque <code>{origin}</code> pelo seu domínio da
                Vercel ao cadastrar.
              </p>
            )}
          </>
        )}
      </div>

      {/* Base de consulta de CPF ativa */}
      <div className="adm__panel">
        <h2 className="adm__panel-title">Base de consulta de CPF</h2>
        <p className="usr-muted">
          Qual API é usada pra puxar nome/telefone/etc. de um CPF (login/cadastro, botão
          "atualizar cliente" e o preenchimento automático de telefone). Troque pra{' '}
          <strong>Supremo</strong> se a Serasa estiver fora do ar.
        </p>
        <p className="usr-muted" style={{ marginTop: 16 }}><strong>Base ativa</strong></p>
        <div className="cfg-copy">
          <select value={baseConsulta} onChange={(e) => setBaseConsulta(e.target.value)}>
            <option value="serasa">Serasa (padrão)</option>
            <option value="supremo">Supremo</option>
          </select>
        </div>
        <div className="cfg-copy">
          <button
            onClick={salvarBaseConsulta}
            disabled={baseBusy || baseConsulta === baseConsultaSalva}
            className={baseMsg === 'ok' ? 'is-ok' : ''}
          >
            {baseBusy ? 'Salvando…' : baseMsg === 'ok' ? 'Salvo!' : 'Salvar'}
          </button>
        </div>
        {baseMsg && baseMsg !== 'ok' && <p className="cfg-warn">{baseMsg}</p>}
      </div>

      {/* Serasa Experian (consulta de crédito) */}
      <div className="adm__panel">
        <h2 className="adm__panel-title">Serasa (consulta de crédito)</h2>
        <p className="usr-muted">
          Credenciais da API da Serasa Experian. A Serasa só aceita chamadas vindas de um{' '}
          <strong>IPv4 autorizado</strong> — por isso é preciso configurar um proxy dedicado
          abaixo (formato <code>ip:porta:usuario:senha</code>).
        </p>

        <p className="usr-muted" style={{ marginTop: 16 }}><strong>Client ID</strong></p>
        <div className="cfg-copy">
          <input
            type="text"
            placeholder="Client ID da Serasa"
            value={seClientId}
            onChange={(e) => setSeClientId(e.target.value)}
            autoComplete="off"
          />
        </div>

        <p className="usr-muted" style={{ marginTop: 16 }}><strong>Client Secret</strong></p>
        <div className="cfg-copy">
          <input
            type="password"
            placeholder="Client Secret da Serasa"
            value={seClientSecret}
            onChange={(e) => setSeClientSecret(e.target.value)}
            autoComplete="off"
          />
        </div>

        <p className="usr-muted" style={{ marginTop: 16 }}><strong>Proxy IPv4</strong></p>
        <p className="usr-muted">
          Formato: <code>ip:porta:usuario:senha</code> — tratado como <strong>SOCKS5</strong> (padrão dos
          provedores de IPv4 dedicado). Se o seu proxy for HTTP, prefixe com <code>http://</code>.
        </p>
        <div className="cfg-copy">
          <input
            type="password"
            placeholder="ex.: 64.69.118.89:50101:usuario:senha"
            value={seProxy}
            onChange={(e) => setSeProxy(e.target.value)}
            autoComplete="off"
          />
        </div>

        <div className="cfg-copy">
          <button
            onClick={salvarSerasa}
            disabled={seBusy || (seClientId.trim() === seClientIdSalvo && seClientSecret.trim() === seClientSecretSalvo && seProxy.trim() === seProxySalvo)}
            className={seMsg === 'ok' ? 'is-ok' : ''}
          >
            {seBusy ? 'Salvando…' : seMsg === 'ok' ? 'Salvo!' : 'Salvar'}
          </button>
        </div>
        {seMsg && seMsg !== 'ok' && <p className="cfg-warn">{seMsg}</p>}

        <p className="usr-muted" style={{ marginTop: 16 }}>
          <strong>Testar conexão</strong> — usa as credenciais e o proxy <em>salvos</em> (salve antes) e
          faz só o login (emite o token, sem gastar consulta paga):
        </p>
        <div className="cfg-copy">
          <button onClick={testarSerasa} disabled={seTestBusy}>
            {seTestBusy ? 'Testando…' : 'Testar conexão Serasa'}
          </button>
        </div>
        {seTest && (
          <p className={seTest.ok ? 'usr-muted' : 'cfg-warn'}>
            {seTest.ok ? '✅ ' : '⚠️ '}{seTest.message}
          </p>
        )}
      </div>

      {/* Lembrete manual de Pix pelo WhatsApp */}
      <div className="adm__panel">
        <h2 className="adm__panel-title">Lembrete de Pix pelo WhatsApp</h2>
        <p className="usr-muted">
          Modo manual, sem API: em <strong>Pedidos</strong>, o admin abre a conversa do cliente com a
          primeira mensagem pronta. Depois copia o Pix em um campo separado e envia o código sozinho como segunda mensagem.
        </p>

        <div className="cfg-grid" style={{ marginTop: 14 }}>
          <label className="cfg-checkline">
            <input
              type="checkbox"
              checked={waCobranca.ativo}
              onChange={(e) => setWaCobranca((cfg) => ({ ...cfg, ativo: e.target.checked }))}
            />
            Ativar lembrete interno na aba Pedidos
          </label>
          <StatusDot
            ok={waCobrancaSalva.ativo}
            label={waCobrancaSalva.ativo ? 'Lembrete ativo' : 'Lembrete desativado'}
          />
        </div>

        <p className="usr-muted" style={{ marginTop: 16 }}><strong>Número de atendimento na mensagem (opcional)</strong></p>
        <p className="usr-muted">
          Opcional: so serve para preencher o campo <code>{'{{numero_atendimento}}'}</code> no texto, caso voce queira mostrar um contato de suporte. Ele nao define o remetente: no modo manual, a mensagem sai da conta que estiver logada no WhatsApp do navegador/aparelho.
        </p>
        <div className="cfg-copy">
          <input
            type="tel"
            placeholder="(31) 99999-9999"
            value={waCobranca.numeroAtendimento}
            onChange={(e) => setWaCobranca((cfg) => ({ ...cfg, numeroAtendimento: e.target.value }))}
          />
        </div>

        <p className="usr-muted" style={{ marginTop: 16 }}><strong>Espera mínima após gerar o Pix</strong></p>
        <p className="usr-muted">
          O botão só libera depois deste tempo e apenas enquanto o código ainda estiver válido.
        </p>
        <div className="cfg-copy cfg-copy--short">
          <input
            type="number"
            min="0"
            max="120"
            step="1"
            value={waCobranca.esperaMinutos}
            onChange={(e) => setWaCobranca((cfg) => ({ ...cfg, esperaMinutos: e.target.value }))}
          />
          <span>minutos</span>
        </div>

        <p className="usr-muted" style={{ marginTop: 16 }}><strong>Mensagem</strong></p>
        <p className="usr-muted">
          Campos disponíveis: <code>{'{{nome}}'}</code>, <code>{'{{pedido}}'}</code>,{' '}
          <code>{'{{valor}}'}</code>, <code>{'{{sorteio}}'}</code>,{' '}
          <code>{'{{expiracao}}'}</code> e <code>{'{{numero_atendimento}}'}</code>.
          O Pix copia e cola fica em um campo separado na aba Pedidos.
        </p>
        <textarea
          className="cfg-textarea"
          rows={9}
          value={waCobranca.mensagem}
          onChange={(e) => setWaCobranca((cfg) => ({ ...cfg, mensagem: e.target.value }))}
        />

        <div className="cfg-copy">
          <button
            onClick={salvarWhatsappCobranca}
            disabled={waCobrancaBusy || JSON.stringify(waCobranca) === JSON.stringify(waCobrancaSalva)}
            className={waCobrancaMsg === 'ok' ? 'is-ok' : ''}
          >
            {waCobrancaBusy ? 'Salvando…' : waCobrancaMsg === 'ok' ? 'Salvo!' : 'Salvar configuração'}
          </button>
        </div>
        {waCobrancaMsg && waCobrancaMsg !== 'ok' && <p className="cfg-warn">{waCobrancaMsg}</p>}
        <p className="cfg-warn">
          Fluxo interno: nao depende de aceite ou opt-in no checkout. O botao apenas abre o WhatsApp no telefone do cliente com o texto pronto; se o Pix venceu, gera um novo no mesmo valor antes de abrir.
        </p>
      </div>

      {/* Grupo de ganhadores no WhatsApp */}
      <div className="adm__panel">
        <h2 className="adm__panel-title">Grupo de ganhadores (WhatsApp)</h2>
        <p className="usr-muted">
          Cole aqui o link de convite do grupo. Ele aparece como botão na tela de
          contemplação e em <strong>Minhas Contemplações</strong>. Pode ser trocado a
          qualquer momento — o site atualiza na hora, sem precisar de deploy.
        </p>
        <div className="cfg-copy">
          <input
            type="url"
            placeholder="https://chat.whatsapp.com/..."
            value={wpp}
            onChange={(e) => setWpp(e.target.value)}
          />
          <button onClick={salvarWpp} disabled={wppBusy || wpp.trim() === wppSalvo} className={wppMsg === 'ok' ? 'is-ok' : ''}>
            {wppBusy ? 'Salvando…' : wppMsg === 'ok' ? 'Salvo!' : 'Salvar'}
          </button>
        </div>
        {wppMsg && wppMsg !== 'ok' && <p className="cfg-warn">{wppMsg}</p>}
        {wppSalvo ? (
          <p className="usr-muted">
            Link atual:{' '}
            <a href={wppSalvo} target="_blank" rel="noreferrer noopener">{wppSalvo}</a>
          </p>
        ) : (
          <p className="cfg-warn">Nenhum link definido — o botão fica oculto até você salvar um.</p>
        )}
      </div>

      {/* Vídeo da premiação (mensagem do Renato) */}
      <div className="adm__panel">
        <h2 className="adm__panel-title">Vídeo da premiação (mensagem do Renato)</h2>
        <p className="usr-muted">
          Cole o link do vídeo que aparece na tela de parabéns, depois da animação. Aceita
          <strong> YouTube</strong>, <strong>Vimeo</strong> ou um arquivo direto (<code>.mp4</code>).
          Deixe vazio para não exibir vídeo.
        </p>
        <div className="cfg-copy">
          <input
            type="url"
            placeholder="https://youtu.be/...  ou  https://.../video.mp4"
            value={vid}
            onChange={(e) => setVid(e.target.value)}
          />
          <button onClick={salvarVid} disabled={vidBusy || vid.trim() === vidSalvo} className={vidMsg === 'ok' ? 'is-ok' : ''}>
            {vidBusy ? 'Salvando…' : vidMsg === 'ok' ? 'Salvo!' : 'Salvar'}
          </button>
        </div>
        {vidMsg && vidMsg !== 'ok' && <p className="cfg-warn">{vidMsg}</p>}
        {vidSalvo
          ? <p className="usr-muted">Vídeo atual: <a href={vidSalvo} target="_blank" rel="noreferrer noopener">{vidSalvo}</a></p>
          : <p className="cfg-warn">Nenhum vídeo definido — a tela de parabéns não mostra vídeo.</p>}
      </div>


      {/* Token da API OwnData (consulta de ganhador) */}
      <div className="adm__panel">
        <h2 className="adm__panel-title">API OwnData — consulta de ganhador (CPF)</h2>
        <p className="usr-muted">
          Cole aqui o <strong>token</strong> da API OwnData. Ele é usado pela página{' '}
          <code>/ganhador</code> para consultar o CPF. Por segurança, o token fica no
          servidor — a consulta passa por <code>/api/ganhador</code> e o token{' '}
          <strong>nunca</strong> é exposto no navegador.
        </p>
        <div className="cfg-copy">
          <input
            type="password"
            placeholder="Cole o token da OwnData"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="off"
          />
          <button onClick={salvarToken} disabled={tokenBusy || token.trim() === tokenSalvo} className={tokenMsg === 'ok' ? 'is-ok' : ''}>
            {tokenBusy ? 'Salvando…' : tokenMsg === 'ok' ? 'Salvo!' : 'Salvar'}
          </button>
        </div>
        {tokenMsg && tokenMsg !== 'ok' && <p className="cfg-warn">{tokenMsg}</p>}
        {tokenSalvo
          ? <p className="usr-muted">Token configurado ✓ (oculto por segurança).</p>
          : <p className="cfg-warn">Nenhum token definido — a consulta de ganhador não funciona até você salvar um.</p>}
        <p className="usr-muted">
          Alternativa mais segura: definir <code>OWNDATA_TOKEN</code> nas variáveis de ambiente
          da Vercel (tem prioridade sobre este campo).
        </p>

        <p className="usr-muted" style={{ marginTop: 16 }}><strong>Testar consulta agora</strong></p>
        <p className="usr-muted">
          Digite um CPF e veja na hora o que a OwnData devolve — confirma se a API está
          respondendo e o que vem. (Só funciona no site publicado.)
        </p>
        <div className="cfg-copy">
          <input
            type="text"
            placeholder="CPF para testar (000.000.000-00)"
            value={cpfTeste}
            onChange={(e) => setCpfTeste(maskCpf(e.target.value))}
            inputMode="numeric"
            autoComplete="off"
          />
          <button onClick={testarConsulta} disabled={testeBusy || onlyDigits(cpfTeste).length !== 11}>
            {testeBusy ? 'Consultando…' : 'Testar consulta'}
          </button>
        </div>
        {testeOut && (
          <div style={{ marginTop: 10 }}>
            {testeOut.erro ? (
              <p className="cfg-warn">{testeOut.erro}</p>
            ) : testeOut.httpOk ? (
              <>
                <p className="usr-muted">
                  ✅ <strong>A OwnData respondeu.</strong>{' '}
                  Nome: <strong>{pegarNome(testeOut.data) || '—'}</strong>{' '}
                  · Nascimento: <strong>{formatarData(pegarNascimento(testeOut.data)) || '—'}</strong>
                </p>
                <details>
                  <summary style={{ cursor: 'pointer', color: 'var(--muted)' }}>Ver resposta completa</summary>
                  <pre style={{ maxHeight: 240, overflow: 'auto', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: 10, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {JSON.stringify(testeOut.data, null, 2)}
                  </pre>
                </details>
              </>
            ) : (
              <>
                <p className="cfg-warn">
                  ⚠️ A OwnData recusou — motivo:{' '}
                  <strong>{testeOut.data?.detail?.reason || testeOut.data?.detail?.error || testeOut.data?.error || 'erro desconhecido'}</strong>
                  {testeOut.data?.status ? ` (status ${testeOut.data.status})` : ''}
                </p>
                <details>
                  <summary style={{ cursor: 'pointer', color: 'var(--muted)' }}>Ver detalhe do erro</summary>
                  <pre style={{ maxHeight: 240, overflow: 'auto', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: 10, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {JSON.stringify(testeOut.data, null, 2)}
                  </pre>
                </details>
              </>
            )}
          </div>
        )}
      </div>



      {/* Tag do Google Ads */}
      <div className="adm__panel">
        <h2 className="adm__panel-title">Google Ads — tag e conversões</h2>
        <p className="usr-muted">
          ID da <strong>tag do Google</strong> que o site carrega (formato <code>AW-123456789</code>).
          Trocou de conta de anúncios? Basta trocar o ID aqui — vale na hora, sem deploy.
        </p>
        <div className="cfg-copy">
          <input
            type="text"
            placeholder="AW-123456789"
            value={gtag.id}
            onChange={(e) => setGtag((c) => ({ ...c, id: e.target.value }))}
            autoComplete="off"
          />
        </div>

        <p className="usr-muted" style={{ marginTop: 16 }}><strong>Rótulos de conversão (opcional)</strong></p>
        <p className="usr-muted">
          No Google Ads, em <strong>Metas → Conversões</strong>, cada ação de conversão tem um rótulo
          (aparece no código como <code>AW-123456789/<strong>AbCdEfGh</strong></code>). Cole aqui para o
          site avisar o Google quando alguém se cadastra ou paga. Vazio = não envia aquela conversão.
        </p>
        <div className="cfg-copy">
          <input
            type="text"
            placeholder="Rótulo da conversão de cadastro (lead)"
            value={gtag.cadastro}
            onChange={(e) => setGtag((c) => ({ ...c, cadastro: e.target.value }))}
            autoComplete="off"
          />
        </div>
        <div className="cfg-copy">
          <input
            type="text"
            placeholder="Rótulo da conversão de compra (Pix pago)"
            value={gtag.compra}
            onChange={(e) => setGtag((c) => ({ ...c, compra: e.target.value }))}
            autoComplete="off"
          />
          <button
            onClick={salvarGtag}
            disabled={gtagBusy || JSON.stringify(gtag) === JSON.stringify(gtagSalvo)}
            className={gtagMsg === 'ok' ? 'is-ok' : ''}
          >
            {gtagBusy ? 'Salvando…' : gtagMsg === 'ok' ? 'Salvo!' : 'Salvar'}
          </button>
        </div>
        {gtagMsg && gtagMsg !== 'ok' && <p className="cfg-warn">{gtagMsg}</p>}
        <p className="usr-muted">
          Tag em uso: <strong>{gtagSalvo.id}</strong>
          {gtagSalvo.cadastro ? ' · conversão de cadastro ✓' : ' · sem conversão de cadastro'}
          {gtagSalvo.compra ? ' · conversão de compra ✓' : ' · sem conversão de compra'}
        </p>
      </div>

      {/* Token da API UTMify (rastreio de vendas pelo backend) */}
      <div className="adm__panel">
        <h2 className="adm__panel-title">UTMify — token da API (rastreio de vendas)</h2>
        <p className="usr-muted">
          Cole aqui o <strong>token da API</strong> da UTMify (no painel da UTMify, em{' '}
          <strong>Integrações → API / Webhook</strong>). É com ele que o backend envia as vendas
          (pendente e pago) para a UTMify. <strong>Não confunda</strong> com o <code>pixelId</code>{' '}
          do site (que fica no index.html) — são coisas diferentes. O token fica no servidor e{' '}
          <strong>nunca</strong> é exposto no navegador.
        </p>
        <div className="cfg-copy">
          <input
            type="password"
            placeholder="Cole o token da API da UTMify"
            value={utmify}
            onChange={(e) => setUtmify(e.target.value)}
            autoComplete="off"
          />
          <button onClick={salvarUtmify} disabled={utmifyBusy || utmify.trim() === utmifySalvo} className={utmifyMsg === 'ok' ? 'is-ok' : ''}>
            {utmifyBusy ? 'Salvando…' : utmifyMsg === 'ok' ? 'Salvo!' : 'Salvar'}
          </button>
        </div>
        {utmifyMsg && utmifyMsg !== 'ok' && <p className="cfg-warn">{utmifyMsg}</p>}
        {utmifySalvo
          ? <p className="usr-muted">Token configurado ✓ (oculto por segurança).</p>
          : <p className="cfg-warn">Nenhum token definido — as vendas não são enviadas à UTMify até você salvar um (ou definir a variável de ambiente).</p>}
        <p className="usr-muted">
          Atenção à <strong>prioridade</strong>: se a variável <code>UTMIFY_API_TOKEN</code> estiver
          definida nas variáveis de ambiente da Vercel, ela vence e este campo é <strong>ignorado</strong>.
          Para controlar o token por aqui, deixe a variável da Vercel vazia.
        </p>

        <p className="usr-muted" style={{ marginTop: 16 }}><strong>CPFs/e-mails de teste</strong></p>
        <p className="usr-muted">
          Compras feitas por estes (ex.: seus testes entrando direto no site, sem anúncio) vão pra
          UTMify como <em>teste</em> e <strong>não contam</strong> nas métricas nem aparecem como
          "vendas não trackeadas". Pode misturar CPF e e-mail, separados por vírgula, espaço ou linha.
        </p>
        <div className="cfg-copy">
          <textarea
            rows={3}
            placeholder="ex.: 123.456.789-00, seuemail@gmail.com"
            value={utmifyTest}
            onChange={(e) => setUtmifyTest(e.target.value)}
            style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit', padding: 10, borderRadius: 10 }}
          />
        </div>
        <div className="cfg-copy">
          <button onClick={salvarUtmifyTest} disabled={utmifyTestBusy || utmifyTest.trim() === utmifyTestSalvo} className={utmifyTestMsg === 'ok' ? 'is-ok' : ''}>
            {utmifyTestBusy ? 'Salvando…' : utmifyTestMsg === 'ok' ? 'Salvo!' : 'Salvar'}
          </button>
        </div>
        {utmifyTestMsg && utmifyTestMsg !== 'ok' && <p className="cfg-warn">{utmifyTestMsg}</p>}
        {utmifyTestSalvo
          ? <p className="usr-muted">Compradores de teste configurados ✓ — as compras deles não contam nas métricas.</p>
          : <p className="usr-muted">Nenhum CPF/e-mail de teste — todas as compras contam normalmente.</p>}
      </div>



      {/* E-mail ao ganhador (Resend) */}
      <div className="adm__panel">
        <h2 className="adm__panel-title">E-mail ao ganhador (Resend)</h2>
        <p className="usr-muted">
          Quando o pagamento é confirmado, o cliente recebe um e-mail de <strong>"você ganhou"</strong>.
          Crie uma conta grátis no <strong>Resend</strong> (resend.com), gere uma <strong>API Key</strong>{' '}
          (começa com <code>re_</code>) e cole abaixo. O <strong>remetente</strong> precisa ser de um
          domínio verificado no Resend — deixe vazio para usar o remetente de teste do Resend.
        </p>
        <div className="cfg-copy">
          <input
            type="password"
            placeholder="Chave da API do Resend (re_…)"
            value={resend}
            onChange={(e) => setResend(e.target.value)}
            autoComplete="off"
          />
        </div>
        <div className="cfg-copy">
          <input
            type="text"
            placeholder="Remetente (opcional) — Viva Sorte+ <premios@seudominio.com>"
            value={remetente}
            onChange={(e) => setRemetente(e.target.value)}
          />
          <button
            onClick={salvarEmail}
            disabled={emailBusy || (resend.trim() === resendSalvo && remetente.trim() === remetenteSalvo)}
            className={emailMsg === 'ok' ? 'is-ok' : ''}
          >
            {emailBusy ? 'Salvando…' : emailMsg === 'ok' ? 'Salvo!' : 'Salvar'}
          </button>
        </div>
        {emailMsg && emailMsg !== 'ok' && <p className="cfg-warn">{emailMsg}</p>}
        {resendSalvo
          ? <p className="usr-muted">Chave configurada ✓ (oculta por segurança).</p>
          : <p className="cfg-warn">Sem chave — o e-mail ao ganhador não é enviado até você salvar uma.</p>}
        <p className="usr-muted">
          Alternativa: definir <code>RESEND_API_KEY</code> e <code>EMAIL_FROM</code> nas variáveis de
          ambiente da Vercel (têm prioridade sobre estes campos).
        </p>
      </div>

      {/* Status da integração */}
      <div className="adm__panel">
        <h2 className="adm__panel-title">Pagar.me — status da integração</h2>
        {loading ? (
          <p className="usr-muted">Verificando integração…</p>
        ) : !health ? (
          <p className="usr-muted">
            Não consegui falar com <code>/api/pagarme/health</code>. Em produção (Vercel) isso
            funciona; no <strong>localhost</strong> as funções <code>/api</code> não rodam — abra
            esta página pelo site publicado para ver o status real.
          </p>
        ) : (
          <div className="cfg-grid">
            <StatusDot
              ok={health.pagarmeValid}
              label={
                health.pagarmeValid
                  ? 'Pagar.me conectado'
                  : health.hasSecret
                    ? 'Chave do Pagar.me inválida'
                    : 'PAGARME_SECRET_KEY ausente'
              }
            />
            <StatusDot
              ok={health.hasService}
              label={health.hasService ? 'Supabase service_role OK' : 'SUPABASE_SERVICE_ROLE_KEY ausente'}
            />
            <StatusDot
              ok={health.hasSupaUrl}
              label={health.hasSupaUrl ? 'URL do Supabase OK' : 'SUPABASE_URL ausente'}
            />
            <StatusDot
              ok={health.hasWebhookSecret}
              label={health.hasWebhookSecret ? 'Webhook protegido por segredo' : 'Webhook sem segredo (opcional)'}
            />
            <StatusDot
              ok={health.hasUtmify}
              label={health.hasUtmify ? 'UTMify conectada (token OK)' : 'Token da UTMify ausente'}
            />
          </div>
        )}
      </div>

      {/* Webhook */}
      <div className="adm__panel">
        <h2 className="adm__panel-title">Webhook do Pagar.me</h2>
        <p className="usr-muted">
          Cole esta URL no painel do Pagar.me (<strong>Configurações → Webhooks/Postbacks</strong>)
          para confirmar os pagamentos automaticamente:
        </p>
        <div className="cfg-copy">
          <input readOnly value={webhookUrl} onFocus={(e) => e.target.select()} />
          <button className={copied === 'wh' ? 'is-ok' : ''} onClick={() => copy(webhookUrl, 'wh')}>
            {copied === 'wh' ? 'Copiado!' : 'Copiar'}
          </button>
        </div>
        {isLocal && (
          <p className="cfg-warn">
            Você está no <strong>localhost</strong> — troque <code>{origin}</code> pelo seu domínio
            da Vercel ao cadastrar no Pagar.me.
          </p>
        )}
        <p className="usr-muted">
          Se você preencher o <strong>Webhook Secret</strong> acima, ele já fica incluído nesta URL.
        </p>
      </div>

      {/* Variáveis de ambiente */}
      <div className="adm__panel">
        <h2 className="adm__panel-title">Variáveis de ambiente (Vercel)</h2>
        <p className="usr-muted">
          Por segurança, as chaves ficam no servidor (Vercel) — nunca no banco nem no navegador.
        </p>
        <ul className="adm__list">
          <li><code>PAGARME_SECRET_KEY</code> — chave secreta (sk_…) · <b>obrigatória pro Pix</b></li>
          <li><code>SUPABASE_SERVICE_ROLE_KEY</code> — confirma pagamentos no banco</li>
          <li><code>SUPABASE_URL</code> — opcional (usa a <code>VITE_SUPABASE_URL</code> se faltar)</li>
          <li><code>PAGARME_WEBHOOK_SECRET</code> — opcional (protege o webhook)</li>
          <li><code>VITE_PAGARME_PUBLIC_KEY</code> — pública (pk_…), só quando ligar cartão</li>
        </ul>
        <p className="cfg-warn">Mudou variável na Vercel? Faça um <strong>Redeploy</strong> pra valer.</p>
      </div>

      {/* Banco */}
      <div className="adm__panel">
        <h2 className="adm__panel-title">Banco de dados (Supabase)</h2>
        <p className="usr-muted">Projeto conectado a este site:</p>
        <div className="cfg-copy">
          <input readOnly value={supaUrl || '(VITE_SUPABASE_URL não definida)'} onFocus={(e) => e.target.select()} />
          <button className={copied === 'su' ? 'is-ok' : ''} onClick={() => copy(supaUrl, 'su')}>
            {copied === 'su' ? 'Copiado!' : 'Copiar'}
          </button>
        </div>
      </div>
    </div>
  )
}
