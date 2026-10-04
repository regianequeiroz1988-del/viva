/**
 * ===========================================================================
 *  CONTEUDO DO SITE — Viva Sorte+
 * ===========================================================================
 *  Este arquivo centraliza TODOS os textos/itens do site.
 *  Conteudo fiel ao site oficial (vivasorteoficial.com.br). As imagens/logos
 *  continuam como placeholders — substitua pelos arquivos reais quando tiver.
 * ===========================================================================
 */

export const brand = {
  name: 'VIVA SORTE',
  plus: '+',
  logo: '/img/logo-viva-sorte.png',
}

export const nav = [
  { label: 'Início', href: '/' },
  { label: 'Resultados', href: '/resultados' },
  {
    label: 'Revendedor',
    children: [
      { label: 'Seja um revendedor', href: '/seja-um-revendedor' },
      { label: 'Seja um influenciador', href: '/seja-um-influenciador' },
      { label: 'Portal do Revendedor', href: 'https://portal.revendavivasorte.com.br/' },
    ],
  },
  {
    label: 'Institucional',
    children: [
      { label: 'Perguntas frequentes', href: '/institucional/perguntas-frequentes' },
      { label: 'Termos de uso', href: '/institucional/termos-de-uso' },
      { label: 'Regulamento', href: '/institucional/regulamento' },
      { label: 'Viva Sorte de Todos', href: '/institucional/de-todos' },
    ],
  },
  { label: 'Contato', href: '/contato' },
]

// ---- HERO (banner principal + painel de compra) -------------------------
export const hero = {
  slides: [
    {
      id: 'slide-1',
      label: 'Viva Sorte+ — 1 Milhão de Reais',
      image: '/img/hero-um-milhao.jpg',
    },
  ],
  card: {
    title: 'Viva Sorte - 07/06/2026',
    weekday: 'DOM, 07 JUN | 2026',
    pricePill: 'Por apenas R$ 0,99',
    description:
      'ADQUIRA SEUS PONTOS NO CLUBE DE VANTAGENS VIVA SORTE MAIS E TENHA A CHANCE DE SER O NOVO MILIONÁRIO DO BRASIL!',
    unitPrice: 0.99,
    defaultQty: 20,
  },
}

// ---- SORTEIOS EM DESTAQUE (grupos de cards) -----------------------------
export const sorteios = {
  groups: [
    {
      id: 'hora-do-viva',
      title: 'Hora do Viva',
      subtitle: 'Sorteios Filantropia Premiável',
      icon: '/img/icon-hora-do-viva.png',
      items: [
        { id: 'sorteio-2836', title: 'Especial de Graça - 12:30h 06/06/2026', edition: '2836', drawIn: '25 minutos', dayLabel: 'HOJE', time: 'ÀS 12:30', susep: 'Processo SUSEP: 15414.645606/2023-89', price: 0.05, defaultQty: 50, image: '/img/sorteios/hora-do-viva-1.png' },
        { id: 'sorteio-2837', title: 'Hora do Viva - 17:30h 06/06/2026', edition: '2837', drawIn: '5 horas', dayLabel: 'HOJE', time: 'ÀS 17:30', susep: 'Processo SUSEP: 15414.630293/2023-64', price: 0.49, defaultQty: 5, image: '/img/sorteios/hora-do-viva-3.png' },
        { id: 'sorteio-2838', title: 'Hora do Rico - 19:30h 06/06/2026', edition: '2838', drawIn: '7 horas', dayLabel: 'HOJE', time: 'ÀS 19:30', susep: 'Processo SUSEP: 15414.645606/2023-89', price: 0.29, defaultQty: 20, image: '/img/sorteios/hora-do-viva-2.png' },
        { id: 'sorteio-2847', title: 'Hora do Rico - 19:30h 10/06/2026', edition: '2847', drawIn: '4 dias', dayLabel: '10/06', time: 'ÀS 19:30', susep: 'Processo SUSEP: 15414.600664/2024-64', price: 0.10, defaultQty: 25, image: '/img/sorteios/hora-do-viva-4.png' },
      ],
    },
    {
      id: 'viva-sorte-do-dia',
      title: 'Viva Sorte do Dia',
      subtitle: 'Multiplique o valor pago em até 100.000x',
      icon: '/img/icon-viva-sorte-do-dia.png',
      items: [
        { id: 'sorteio-158', title: 'Viva Sorte do Dia - 08/06/2026', edition: '158', drawIn: '2 dias', dayLabel: '08/06', time: 'ÀS 20:30', susep: 'Processo SUSEP: 15414.652752/2025-22', price: 0.05, defaultQty: 100, image: '/img/sorteios/viva-sorte-do-dia-2.png' },
        { id: 'sorteio-159', title: 'Viva Sorte do Dia - 10/06/2026', edition: '159', drawIn: '4 dias', dayLabel: '10/06', time: 'ÀS 20:30', susep: 'Processo SUSEP: 15414.652752/2025-22', price: 0.05, defaultQty: 100, image: '/img/sorteios/viva-sorte-do-dia-1.png' },
        { id: 'sorteio-160', title: 'Viva Sorte do Dia - 12/06/2026', edition: '160', drawIn: '6 dias', dayLabel: '12/06', time: 'ÀS 20:30', susep: 'Processo SUSEP: 15414.652752/2025-22', price: 0.05, defaultQty: 100, image: '/img/sorteios/viva-sorte-do-dia-2.png' },
      ],
    },
  ],
  ctaTitle: 'Adicione todos os sorteios ao carrinho!',
  ctaSubtitle: 'Adicione todos de uma vez e não perca tempo!',
  ctaButton: 'Adicionar todos',
}

// ---- BANNERS PUBLICITARIOS (Viva Sorte Bet) -----------------------------
export const adBanners = [
  { id: 'ad-1', label: 'Dinheiro de volta no cassino', image: '/img/ads/dinheiro-de-volta.webp' },
  { id: 'ad-2', label: 'Apostas seguras, grátis e superodds', image: '/img/ads/apostas-superodds.webp' },
  { id: 'ad-3', label: 'Giros gratuitos na roleta diária', image: '/img/ads/giros-gratuitos.webp' },
  { id: 'ad-4', label: '1000 rodadas com apenas R$50', image: '/img/ads/1000-rodadas.webp' },
]

// ---- GANHADORES RECENTES -------------------------------------------------
export const ganhadores = {
  title: 'Ganhadores recentes',
  edition: '037',
  date: 'domingo, 31 de maio de 2026',
  items: [
    { id: 'g-1', name: 'Joselio C. S.', value: 'R$ 1.000.000,00 - valor líquido', city: 'Montanhas/RN', photo: '/img/avatar.webp' },
  ],
}

// ---- PARCEIROS / DESCONTOS ----------------------------------------------
export const parceiros = {
  title: 'Os melhores descontos para quem é Viva Sorte +',
  cta: 'ver mais',
  items: [
    { id: 'parceiro-aliexpress', name: 'AliExpress', tag: 'Ofertas especiais', logo: '/img/parceiros/aliexpress.png' },
    { id: 'parceiro-carrefour', name: 'Carrefour', tag: 'Ofertas especiais', logo: '/img/parceiros/carrefour.png' },
    { id: 'parceiro-casas-bahia', name: 'Casas Bahia', tag: 'Ofertas especiais', logo: '/img/parceiros/casas-bahia.png' },
    { id: 'parceiro-cinemark', name: 'Cinemark', tag: 'Ofertas especiais', logo: '/img/parceiros/cinemark.jpg' },
    { id: 'parceiro-droga-raia', name: 'Droga Raia', tag: 'Ofertas especiais', logo: '/img/parceiros/droga-raia.jpg' },
    { id: 'parceiro-drogasil', name: 'Drogasil', tag: 'Ofertas especiais', logo: '/img/parceiros/drogasil.jpg' },
    { id: 'parceiro-extra', name: 'Extra', tag: 'Ofertas especiais', logo: '/img/parceiros/extra.jpg' },
    { id: 'parceiro-extrafarma', name: 'Extrafarma', tag: 'Ofertas especiais', logo: '/img/parceiros/extrafarma.jpg' },
    { id: 'parceiro-panvel', name: 'Farmácias Panvel', tag: 'Ofertas especiais', logo: '/img/parceiros/panvel.jpg' },
    { id: 'parceiro-madero', name: 'Madero', tag: 'Ofertas especiais', logo: '/img/parceiros/madero.png' },
    { id: 'parceiro-magalu', name: 'Magazine Luiza', tag: 'Ofertas especiais', logo: '/img/parceiros/magalu.jpg' },
    { id: 'parceiro-boticario', name: 'O Boticário', tag: 'Ofertas especiais', logo: '/img/parceiros/boticario.jpg' },
    { id: 'parceiro-pague-menos', name: 'Pague Menos', tag: 'Ofertas especiais', logo: '/img/parceiros/pague-menos.jpg' },
    { id: 'parceiro-petz', name: 'Petz', tag: 'Ofertas especiais', logo: '/img/parceiros/petz.png' },
    { id: 'parceiro-ponto', name: 'Ponto Frio', tag: 'Ofertas especiais', logo: '/img/parceiros/ponto-frio.jpg' },
  ],
}

// ---- INSTITUICAO BENEFICIADA --------------------------------------------
export const instituicao = {
  title: 'Instituição beneficiada',
  logoLabel: 'Hospital do Câncer de Londrina',
  logo: '/img/selos/hospital-cancer-londrina.png',
  text: '100% do direito de resgate dos títulos pode ser cedido voluntariamente ao Instituto do Câncer de Londrina.',
}

// ---- RODAPE --------------------------------------------------------------
export const footer = {
  social: [
    { id: 'instagram', label: 'Instagram', href: 'https://www.instagram.com/vivasorte' },
    { id: 'facebook', label: 'Facebook', href: 'https://www.facebook.com/vivasorteof' },
    { id: 'x', label: 'X (antigo Twitter)', href: 'https://x.com/viva_sorte' },
    { id: 'youtube', label: 'YouTube', href: 'https://www.youtube.com/@vivasortemais' },
  ],
  legal:
    'VIVA SORTE DO DIA e HORA DO VIVA são títulos de capitalização da modalidade filantropia ' +
    'premiável de pagamento único emitido pela VIA CAPITALIZAÇÃO S/A., inscrita no CNPJ sob nº ' +
    '88.076.302/0001-94. Este título permite a cessão voluntária de 100% do direito de resgate ao ' +
    'INSTITUTO DO CÂNCER DE LONDRINA. Antes de contratar, consulte previamente as Condições Gerais. ' +
    'A aquisição implica automática adesão às Condições Gerais do VIVA SORTE DO DIA/HORA DO VIVA, as ' +
    'quais o subscritor declara ter tomado ciência. A aprovação deste plano pela Susep não implica, ' +
    'por parte da Autarquia, em incentivo ou recomendação a sua aquisição, representando, ' +
    'exclusivamente, sua adequação às normas em vigor. É proibida a venda de Título de Capitalização ' +
    'a menores de 16 (dezesseis) anos (Art. 3º do Código Civil). Os títulos de capitalização Viva ' +
    'Sorte do Dia e Hora do Viva são destinados exclusivamente a maiores de 16 anos.',
  credits: [
    { id: 'emissor', label: 'Títulos emitidos por:', name: 'Via Capitalização', logo: '/img/selos/viacap.png' },
    { id: 'beneficiada', label: 'Instituição Beneficiada:', name: 'Hospital do Câncer de Londrina', logo: '/img/selos/hospital-cancer-londrina.png' },
    { id: 'dev', label: 'Desenvolvimento:', name: 'Even Tecnologia', logo: '/img/selos/even.png' },
  ],
  seals: [
    { id: 'google-safe-browsing', label: 'Google Safe Browsing', image: '/img/selos/google-safe-browsing.png' },
  ],
  links: [
    { label: 'Termos de Uso', href: '/institucional/termos-de-uso' },
    { label: 'Política de Privacidade', href: '/politica-de-privacidade' },
    { label: 'Perguntas frequentes', href: '/institucional/perguntas-frequentes' },
    { label: 'Jogo Responsável', href: '/institucional/jogo-responsavel' },
    { label: 'Contato', href: '/contato' },
  ],
  sac: 'Sac Via Capitalização — (51) 3303-3851',
  ouvidoria: 'Ouvidoria Via Capitalização — 0800 874 1505',
  company: 'VIVA SORTE DISTRIBUIDORA E INTERMEDIADORA DE NEGOCIOS LTDA — 48.098.937/0001-78',
}
