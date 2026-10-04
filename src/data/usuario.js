/**
 * Menu da area do usuario (igual ao /usuario/* do site oficial).
 * Dados de EXEMPLO — substituir pelos dados reais do cliente (Supabase).
 */
export const usuarioMenu = [
  { href: '/usuario/perfil', label: 'Meu perfil' },
  { href: '/usuario/meus-titulos', label: 'Meus títulos' },
  { href: '/usuario/meus-pedidos', label: 'Meus pedidos' },
  { href: '/usuario/minhas-contemplacoes', label: 'Minhas contemplações' },
  { href: '/usuario/meus-resgates', label: 'Meus resgates' },
  { href: '/usuario/minha-carteira', label: 'Minha carteira' },
  { href: '/usuario/meus-saques', label: 'Meus saques' },
  { href: '/usuario/meus-cartoes', label: 'Meus cartões' },
  { href: '/usuario/meus-dados', label: 'Meus dados' },
  { href: '/usuario/preferencias', label: 'Preferências' },
]

// Perfil de exemplo (placeholder — NAO sao dados reais de ninguem)
export const perfilExemplo = {
  nome: 'Cliente',
  pontos: 0,
  creditosNaoSacaveis: 0,
  saldoSaque: 0,
  totalSacado: 0,
}

// Preferencias de comunicacao (estrutura do site oficial)
export const preferencias = {
  categorias: [
    'Atualizações sobre pagamentos em processamento',
    'Atualizações promocionais',
    'Marketing',
    'Newsletter',
  ],
  meios: ['SMS', 'Notificações Push', 'WhatsApp', 'EMAIL'],
}
