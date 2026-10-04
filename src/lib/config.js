// Configurações editáveis do site (chave/valor) guardadas no Supabase.
// Leitura é pública (qualquer visitante lê, ex.: link do grupo de ganhadores);
// escrita só admin (RLS via is_admin()). Veja supabase/schema.sql.
import { supabase, isSupabaseConfigured } from './supabase.js'

export const CONFIG_KEYS = {
  whatsappGanhadores: 'whatsapp_grupo_ganhadores',
  whatsappCobrancaAtivo: 'whatsapp_cobranca_ativo',
  whatsappCobrancaNumero: 'whatsapp_cobranca_numero',
  whatsappCobrancaEsperaMinutos: 'whatsapp_cobranca_espera_minutos',
  whatsappCobrancaMensagem: 'whatsapp_cobranca_mensagem',
  videoPremiacao: 'video_premiacao_url',
  heroBannerUrl: 'hero_banner_url',
  // Logo no topo da PÁGINA INICIAL (só ela — outras páginas mantêm a logo sempre).
  // '' (não configurado) ou 'true' = mostra (padrão, ligado); 'false' = esconde.
  logoHomeAtivo: 'logo_home_ativo',
  owndataToken: 'owndata_token', // token da API OwnData (consulta de ganhador por CPF)
  resendKey: 'resend_api_key', // chave da API Resend (e-mail "você ganhou")
  emailRemetente: 'email_remetente', // remetente do e-mail (ex.: Viva Sorte+ <premios@seudominio.com>)
  premioVivaSorte: 'premio_viva_sorte', // (legado, não usado)
  utmifyApiToken: 'utmify_api_token', // token da API da UTMify (envio de vendas pendente/pago pelo backend)
  utmifyTestCpfs: 'utmify_test_cpfs', // CPFs/e-mails de teste — compras vão à UTMify como isTest (não contam)
  // Gateway de pagamento ativo: 'pagarme' (padrão) ou 'payforge'.
  gatewayAtivo: 'gateway_ativo',
  // Rodízio/failover de gateways: lista CSV ordenada (ex.: 'payforge,pagarme').
  // Se a gate falha ao gerar o Pix, o site tenta a próxima da lista automaticamente,
  // e o cliente pode trocar manualmente na tela do Pix. Vazio = sem rodízio.
  gatewayRodizio: 'gateway_rodizio',
  payforgePublicKey: 'payforge_public_key',
  payforgeSecretKey: 'payforge_secret_key',
  payforgeWebhookKey: 'payforge_webhook_key',
  // Pagar.me também configurável pelo /admin (antes só via env na Vercel).
  // Terminam em '_key' de propósito: a RLS oculta dos visitantes (igual às outras gates).
  pagarmeSecretKey: 'pagarme_secret_key',
  pagarmeWebhookKey: 'pagarme_webhook_key',
  // Credenciais da Serasa Experian (Client ID/Secret) + proxy IPv4 dedicado (a Serasa
  // só aceita chamadas de IP autorizado). '_key' de propósito → RLS oculta dos visitantes.
  serasaClientIdKey: 'serasa_client_id_key',
  serasaClientSecretKey: 'serasa_client_secret_key',
  serasaProxyKey: 'serasa_proxy_key', // formato: ip:porta:usuario:senha
  // Base de consulta de CPF ativa: 'serasa' (padrão) ou 'supremo'. Não é segredo
  // (por isso não termina em _key/_token) — só controla qual provedor é usado.
  baseConsultaCpf: 'base_consulta_cpf',
  // Valor do "prêmio instantâneo" mostrado no /ganhador ao digitar o CPF.
  // Editável pelo ligador (RPC ligador_definir_premio) — não só pelo admin.
  // Público de propósito (não termina em _key/_token): o /ganhador é anônimo.
  premioGanhadorValor: 'premio_ganhador_valor',
  // Tag do Google Ads (ex.: AW-123456789) e rótulos das ações de conversão.
  // Públicos de propósito (o navegador do visitante precisa ler pra carregar a tag).
  googleTagId: 'google_tag_id',
  googleConversaoCadastro: 'google_conversao_cadastro',
  googleConversaoCompra: 'google_conversao_compra',
}

/** Lê um valor de configuração (string vazia se não existir / sem Supabase). */
export async function getConfig(chave) {
  if (!isSupabaseConfigured) return ''
  const { data } = await supabase
    .from('configuracoes')
    .select('valor')
    .eq('chave', chave)
    .maybeSingle()
  return data?.valor || ''
}

/** Grava/atualiza um valor de configuração (somente admin pela RLS). */
export async function setConfig(chave, valor) {
  if (!isSupabaseConfigured) throw new Error('Supabase não configurado')
  const { error } = await supabase
    .from('configuracoes')
    .upsert({ chave, valor }, { onConflict: 'chave' })
  if (error) throw new Error(error.message)
}
