/**
 * ===========================================================================
 *  CONTEUDO DAS PAGINAS INTERNAS — Viva Sorte+
 *  Mapeado do site oficial (vivasorteoficial.com.br) em 06/06/2026.
 *  Documentos legais longos (termos / privacidade) ficam em /public/docs/*.txt
 *  e sao carregados pela pagina <Documento>.
 * ===========================================================================
 */

// ---- RESULTADOS (lista de categorias) -----------------------------------
export const resultadosCategorias = [
  { id: 'viva-sorte-mais', title: 'Viva Sorte +', subtitle: 'Pontos do Clube Viva Sorte +', img: '/favicon.png' },
  { id: 'hora-do-viva', title: 'Hora do Viva', subtitle: 'Sorteios Filantropia Premiável', img: '/img/icon-hora-do-viva.png' },
  { id: 'viva-sorte-do-dia', title: 'Viva Sorte do Dia', subtitle: 'Multiplique o valor pago em até 100.000x', img: '/img/icon-viva-sorte-do-dia.png' },
  { id: 'hora-norte', title: 'Hora Norte', subtitle: 'Muito dinheiro somente para a região Norte do Brasil!', badge: { text: 'HORA NORTE', color: '#ffd21e', fg: '#1e3fcf' } },
  { id: 'hora-centro-oeste', title: 'Hora Centro-Oeste', subtitle: 'Muito dinheiro somente para a região Centro-Oeste do Brasil!', badge: { text: 'HORA C-OESTE', color: '#1e9440', fg: '#fff' } },
  { id: 'hora-sudeste', title: 'Hora Sudeste', subtitle: 'Muito dinheiro somente para a região Sudeste do Brasil!', badge: { text: 'HORA SUDESTE', color: '#1a1c2b', fg: '#fff' } },
  { id: 'hora-sul', title: 'Hora Sul', subtitle: 'Muito dinheiro somente para a região Sul do Brasil!', badge: { text: 'HORA SUL', color: '#e23744', fg: '#fff' } },
  { id: 'hora-nordeste', title: 'Hora Nordeste', subtitle: 'Muito dinheiro somente para a região Nordeste do Brasil!', badge: { text: 'HORA NORDESTE', color: '#1e3fcf', fg: '#fff' } },
  { id: 'viva-sorte-parana', title: 'Viva Sorte Paraná', subtitle: 'O título de capitalização somente para o interior do Paraná.', badge: { text: 'VS PARANÁ', color: '#e23744', fg: '#fff' } },
]

// ---- CONTATO -------------------------------------------------------------
export const contato = {
  title: 'Como podemos ajudar?',
  sub: 'O time Viva Sorte está pronto para ouvir você.',
  canal: 'WhatsApp',
  canalDesc: 'Envie uma mensagem para nosso time de atendimento.',
  cta: 'Falar com o atendimento',
  href: 'https://wa.me/',
}

// ---- CADASTRO (revendedor / influenciador) ------------------------------
const camposBase = [
  { name: 'nome', label: 'Nome completo', type: 'text', placeholder: 'Digite seu nome completo', required: true },
  { name: 'email', label: 'Endereço de e-mail', type: 'email', placeholder: 'Digite seu endereço de e-mail', required: true },
  { name: 'senha', label: 'Crie uma senha', type: 'password', placeholder: 'Digite uma senha', required: true },
  { name: 'celular', label: 'Celular / WhatsApp', type: 'tel', placeholder: 'Digite seu número de telefone com DDD', required: true, hint: 'Será enviada uma mensagem por SMS para confirmar o seu número.' },
  { name: 'documento', label: 'CPF ou CNPJ', type: 'text', placeholder: 'Digite seu CPF ou CNPJ', required: true },
]

const camposEndereco = [
  { name: 'cep', label: 'CEP', type: 'text', placeholder: 'Digite seu CEP', required: true },
  { name: 'endereco', label: 'Endereço', type: 'text', placeholder: 'Digite seu endereço', required: true },
  { name: 'numero', label: 'Número', type: 'text', placeholder: 'Número', required: true },
  { name: 'bairro', label: 'Bairro', type: 'text', placeholder: 'Bairro' },
  { name: 'cidade', label: 'Cidade', type: 'text', placeholder: 'Cidade' },
  { name: 'estado', label: 'Estado', type: 'text', placeholder: 'Estado' },
]

const camposInfluenciador = [
  { name: 'rede', label: 'Rede social', type: 'select', options: ['Instagram', 'TikTok', 'YouTube', 'Facebook', 'Kwai', 'Outra'], placeholder: 'Selecione uma opção', hint: 'Selecione a rede social que você mais utiliza', required: true },
  { name: 'perfil', label: 'Perfil', type: 'text', placeholder: '@seu_perfil', hint: 'Informe o seu perfil na rede social selecionada', required: true },
]

export const cadastro = {
  revendedor: {
    title: 'Seja um revendedor Viva Sorte',
    intro: [
      'Chegou a hora de você aumentar sua renda.',
      'Venda Viva Sorte no conforto de sua casa. Não perca essa chance!',
      'Solicite seu cadastro pelo formulário abaixo e seja um revendedor!',
    ],
    campos: [...camposBase, ...camposEndereco],
    cta: 'Realizar cadastro',
  },
  influenciador: {
    title: 'Seja um influenciador Viva Sorte',
    intro: [
      'Chegou a hora de você aumentar sua renda.',
      'Divulgue a Viva Sorte e seja um influenciador. Não perca essa chance!',
      'Solicite seu cadastro pelo formulário abaixo e seja um influenciador!',
    ],
    campos: [...camposBase, ...camposInfluenciador, ...camposEndereco],
    cta: 'Realizar cadastro',
  },
  termo: 'Ao realizar o cadastro, você concorda com os Termos do Contrato de Adesão.',
  secure: 'Este site é protegido por serviços de verificação de segurança.',
}

// ---- JOGO RESPONSAVEL ----------------------------------------------------
export const jogoResponsavel = {
  title: 'Jogo Responsável',
  intro: 'O Viva Sorte está comprometido com o jogo responsável e oferece diversas ferramentas para auxiliar nossos clientes a jogarem de forma segura e consciente. Os títulos de capitalização são produtos financeiros destinados a MAIORES DE 18 ANOS.',
  sectionTitle: 'Jogando de Forma Responsável',
  sectionText: 'Jogar de forma responsável significa ter consciência dos riscos e benefícios do jogo e manter o controle sobre o seu comportamento.',
  dicas: [
    { emoji: '💰', title: 'Defina um orçamento', text: 'Determine quantos títulos você pode adquirir sem comprometer suas finanças.' },
    { emoji: '😄', title: 'Jogue por diversão', text: 'O objetivo principal deve ser se divertir, não ganhar dinheiro a todo custo.' },
    { emoji: '💡', title: 'Faça apostas conscientes', text: 'Leia as regras e probabilidades de cada título antes de investir.' },
    { emoji: '😤', title: 'Evite jogar quando estiver estressado ou emocionalmente abalado', text: 'Isso pode levar a decisões precipitadas.' },
    { emoji: '⏰', title: 'Faça pausas regulares', text: 'Dê um tempo para descansar e evitar o acúmulo de estresse.' },
    { emoji: '🤝', title: 'Procure ajuda se sentir que está perdendo o controle', text: 'Existem diversos recursos disponíveis para auxiliar pessoas com dependência em jogos.' },
  ],
  maisInfoTitle: 'Mais informações',
  maisInfo: [
    { text: 'Confira o Instituto Brasileiro de Jogo Responsável', href: 'https://ibjr.org/' },
    { text: 'Encontre centros de tratamento para dependentes em jogos', href: 'https://www.google.com/search?q=grupo+de+tratamento+de+dependentes+em+jogos' },
  ],
}

// ---- REGULAMENTO (lista por sorteio) ------------------------------------
export const regulamentoItens = [
  'Hora do Viva - 17:30h 06/06/2026',
  'Cartão de Todos Sonhos - 06/06/2026',
  'Hora do Rico - 19:30h 06/06/2026',
  'Viva Sorte - 07/06/2026',
  'Cliente Fiel. Cliente Feliz - 07/06/2026',
  'Hora do Viva - 12:30h 08/06/2026',
  'Viva Sorte do Dia - 08/06/2026',
  'Hora do Rico - 19:30h 10/06/2026',
  'Viva Sorte do Dia - 10/06/2026',
  'Viva Sorte do Dia - 12/06/2026',
  'Especial de Graça - 12:30h 13/06/2026',
]

// ---- DOCUMENTOS LONGOS (carregados de /public/docs/*.txt) ----------------
export const documentos = {
  'termos-de-uso': { title: 'Termos de uso', file: '/docs/termos-de-uso.txt' },
  'politica-de-privacidade': { title: 'Política de privacidade', file: '/docs/politica-de-privacidade.txt' },
}
