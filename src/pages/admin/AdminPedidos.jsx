import { useEffect, useMemo, useRef, useState } from 'react'
import { useTravaScroll, useVoltarFecha } from '../../lib/useTravaScroll.js'
import { useAbaVisivel } from '../../lib/useAbaVisivel.js'
import { supabase } from '../../lib/supabase.js'
import { getConfig, CONFIG_KEYS } from '../../lib/config.js'
import { criarPagamentoPixFailover, montarRodizio, GATEWAYS } from '../../lib/pagamentos.js'
import {
  DEFAULT_WHATSAPP_COBRANCA_MESSAGE,
  avaliarCobrancaWhatsapp,
  lembreteWhatsappEm,
  montarMensagemWhatsappInicial,
  montarWaMeUrl,
  normalizarTemplateCobrancaWhatsapp,
  pixDoPedido,
} from '../../lib/whatsappCobranca.js'
import { formatBRL } from '../../utils/format.js'
import { maskCpf, maskTelefone, onlyDigits } from '../../utils/masks.js'
import { nomeBanco } from '../../utils/bancos.js'
import { intervaloNumeros } from '../../utils/premio.js'
import { Download, Search, Check, Phone } from '../../components/Icons.jsx'
import { METODOS, StatusPill } from './AdminUI.jsx'
import { fichasPorPedido, resumoPedido } from './pedidosAgrupados.js'

function baixarArquivo(nomeArquivo, conteudo) {
  const blob = new Blob([conteudo], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nomeArquivo
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

const WHATSAPP_CONFIG_INICIAL = {
  ativo: false,
  numeroAtendimento: '',
  esperaMinutos: 5,
  mensagem: DEFAULT_WHATSAPP_COBRANCA_MESSAGE,
}
const PIX_RENOVAVEL_WHATSAPP = new Set(['pix_expirado', 'pix_perto_expirar'])
const deveRenovarPixWhatsapp = (avaliacao) => PIX_RENOVAVEL_WHATSAPP.has(avaliacao?.codigo)
const isoDePix = (valor) => {
  const numero = Number(valor)
  const data = Number.isFinite(numero) ? new Date(numero) : new Date(valor)
  return Number.isNaN(data.getTime()) ? '' : data.toISOString()
}

// Nome do pagador: snapshot salvo no pedido (pagador) → senão o perfil (join) → '—'.
const nomePagador = (pedido, nomes) => nomes?.[pedido?.user_id]?.nome || pedido?.pagador?.nome || '—'
// Nome confiável p/ o ligador: o da CONSULTA (OwnData) tem prioridade sobre o digitado.
const nomeConsulta = (cliente) => (cliente?.nomeConsulta || '').trim()
const normNome = (s) => String(s || '').trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/\s+/g, ' ')
const cpfPagador = (pedido, nomes) => nomes?.[pedido?.user_id]?.cpf || pedido?.pagador?.cpf || ''
const emailPagador = (pedido, nomes) => nomes?.[pedido?.user_id]?.email || pedido?.pagador?.email || ''
const telPagador = (pedido, nomes) => nomes?.[pedido?.user_id]?.telefone || pedido?.pagador?.telefone || ''
const cidadeLabel = (pedido) => (pedido?.cidade ? `${pedido.cidade}${pedido.uf ? '/' + pedido.uf : ''}` : '—')
// Banco do pagador: o NOME que a Pagar.me devolveu (pix_banco) é a fonte primária;
// só caímos no mapa de ISPB (pix_ispb) para pedidos antigos sem o nome salvo.
const bancoLabel = (pedido) => pedido?.pix_banco || nomeBanco(pedido?.pix_ispb) || '—'
// Data compacta (sem segundos) p/ a tabela não ficar larga demais.
const dataCurta = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
}

// O Supabase limita cada resposta. Paginar evita que clientes antigos ou seus
// contadores desapareçam quando a operação ultrapassar mil pedidos.
async function fetchAllPedidos() {
  const pedidos = []
  const tamanhoPagina = 1000
  for (let inicio = 0; ; inicio += tamanhoPagina) {
    const { data, error } = await supabase
      .from('pedidos')
      .select('*')
      .order('created_at', { ascending: false })
      .range(inicio, inicio + tamanhoPagina - 1)
    if (error) throw error
    pedidos.push(...(data || []))
    if (!data || data.length < tamanhoPagina) break
  }
  return pedidos
}

// Números da sorte de forma enxuta: intervalo + número premiado.
const numerosLabel = (numeros) => {
  if (numeros == null || numeros <= 0) return '—'
  const iv = intervaloNumeros(numeros)
  return `${iv.inicio}–${iv.fim} · premiado ${iv.premiado}`
}

// TODOS os perfis (paginado) — usado tanto pra montar o mapa de nomes/consulta
// quanto pra achar quem se cadastrou mas NUNCA gerou pedido ("Somente Cadastros").
const CAMPOS_PERFIL = 'id,nome,cpf,email,telefone,is_admin,created_at,exportado_cadastro,exportado_cadastro_at,ligador_id,ligador_status,ligador_obs,ligador_at'

async function fetchAllProfiles(campos = `${CAMPOS_PERFIL},gerente_id`) {
  const perfis = []
  const tamanhoPagina = 1000
  for (let inicio = 0; ; inicio += tamanhoPagina) {
    const { data, error } = await supabase
      .from('profiles')
      .select(campos)
      .order('created_at', { ascending: false })
      .range(inicio, inicio + tamanhoPagina - 1)
    if (error) throw error
    perfis.push(...(data || []))
    if (!data || data.length < tamanhoPagina) break
  }
  return perfis
}

// Monta o .txt de um cliente "só cadastro" (nunca gerou pedido) — mesmo formato
// enxuto usado em Usuários, sem os campos que só fazem sentido num pedido.
function montarTxtCadastro(perfil, consulta) {
  const c = consulta || {}
  const nomeReal = nomeConsulta(c) || perfil.nome || '—'
  return [
    `Nome: ${nomeReal}`,
    `CPF: ${perfil.cpf ? maskCpf(perfil.cpf) : '—'}`,
    `Telefone: ${perfil.telefone ? maskTelefone(perfil.telefone) : '—'}`,
    `Nascimento: ${c.nascimento || '—'}`,
    `Idade: ${c.idade != null && c.idade !== '' ? c.idade : '—'}`,
    `Sexo: ${c.sexo || '—'}`,
    `Cadastro: ${perfil.created_at ? new Date(perfil.created_at).toLocaleString('pt-BR') : '—'}`,
    '',
    'Pagamentos confirmados (0):',
    '  — nenhum pagamento confirmado.',
  ].join('\n')
}

// Monta o conteúdo .txt de UM pedido (dados essenciais do cliente).
// Reusado tanto na exportação individual quanto na em massa.
function montarTxtPedido(pedido, cliente) {
  const { numeros } = resumoPedido(pedido)
  const cpf = cpfPagador(pedido, { [pedido.user_id]: cliente })
  const tel = telPagador(pedido, { [pedido.user_id]: cliente })
  const c = cliente || {} // dados de consulta (OwnData): nome/nascimento/idade/profissão/score/renda
  const nomeDigitado = nomePagador(pedido, { [pedido.user_id]: cliente })
  const nomeReal = nomeConsulta(c) || nomeDigitado // consulta tem prioridade (cadastro pode vir errado)

  const linhas = [
    `Nome: ${nomeReal}`,
    ...(nomeConsulta(c) && normNome(nomeConsulta(c)) !== normNome(nomeDigitado) ? [`Nome (cadastro): ${nomeDigitado}`] : []),
    `CPF: ${cpf ? maskCpf(cpf) : '—'}`,
    `Telefone: ${tel ? maskTelefone(tel) : '—'}`,
    `Data de nascimento: ${c.nascimento || '—'}`,
    `Idade: ${c.idade != null && c.idade !== '' ? c.idade : '—'}`,
    `Cidade/Estado (IP): ${cidadeLabel(pedido)}`,
    `Banco (Pix): ${bancoLabel(pedido)}`,
    `Data/Hora da compra: ${pedido.created_at ? new Date(pedido.created_at).toLocaleString('pt-BR') : '—'}`,
    `Valor pago: ${formatBRL(pedido.total)}`,
    '',
    `Quantidade de números comprados: ${numeros == null ? '—' : numeros}`,
    `Números da sorte: ${numerosLabel(numeros)}`,
    '',
    `Status: ${(pedido.status || '—').toUpperCase()}`,
  ]
  return linhas.join('\n')
}

// Nome de arquivo amigável p/ a exportação individual.
const slugNome = (s) =>
  String(s || 'pedido')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'pedido'

// ---- Modal de detalhe do pedido (exportado p/ reuso) ----------------------
export function PedidoModal({
  pedido,
  cliente,
  ligadores = [],
  onClose,
  onExport,
  onReverter,
  onAtribuir,
  onDesatribuir,
}) {
  const [ligLocal, setLigLocal] = useState('')
  useTravaScroll(true)
  useVoltarFecha(true, onClose)
  const ligAtual = ligadores.find((l) => l.id === pedido.ligador_id)
  const itens = Array.isArray(pedido.itens) ? pedido.itens : []
  const { numeros } = resumoPedido(pedido)
  const nome = nomePagador(pedido, { [pedido.user_id]: cliente })
  const cpf = cpfPagador(pedido, { [pedido.user_id]: cliente })
  const tel = telPagador(pedido, { [pedido.user_id]: cliente })
  const c = cliente || {} // dados de consulta (Serasa) — uso interno
  const historico = pedido._historico || [pedido]
  const nomeReal = nomeConsulta(c) || nome // nome da consulta tem prioridade (cadastro pode vir errado)
  const linhas = [
    ['Pagador', nomeReal],
    ...(nomeConsulta(c) && normNome(nomeConsulta(c)) !== normNome(nome) ? [['Nome (cadastro)', nome]] : []),
    ['CPF', cpf ? maskCpf(cpf) : '—'],
    ['Telefone', tel ? maskTelefone(tel) : '—'],
    ['Nascimento', c.nascimento || '—'],
    ['Idade', c.idade != null && c.idade !== '' ? String(c.idade) : '—'],
    ['Números comprados', numeros == null ? '—' : String(numeros)],
    ['Cidade', cidadeLabel(pedido)],
    ['IP', pedido.ip || '—'],
    ['Status', <StatusPill key="s" status={pedido.status} />],
    ['Gerou pedidos', `${pedido._totalGerados || historico.length}×`],
    ...(pedido._totalPagos > 0 ? [['Pagou', `${pedido._totalPagos}×`]] : []),
    ...(pedido._voltou ? [['🔁 Voltou', `gerou/pagou de novo depois de exportado em ${dataCurta(pedido._exportadoEm)}`]] : []),
    ['Banco (Pix)', bancoLabel(pedido)],
    ['Total', formatBRL(pedido.total)],
  ]
  return (
    <div className="admmodal" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="admmodal__box" onClick={(e) => e.stopPropagation()}>
        <div className="admmodal__head">
          <div>
            <h2>Detalhe do pedido</h2>
            <span className="admmodal__sub">
              #{String(pedido.id).slice(0, 8)} · {pedido.created_at ? new Date(pedido.created_at).toLocaleString('pt-BR') : '—'}
            </span>
          </div>
          <button className="admmodal__x" onClick={onClose} aria-label="Fechar">×</button>
        </div>

        <dl className="admmodal__grid">
          {linhas.map(([k, v]) => (
            <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
          ))}
        </dl>

        <h3 className="admmodal__h3">Histórico do cliente ({historico.length})</h3>
        <div className="admmodal__history">
          {historico.map((item, i) => {
            const resumo = resumoPedido(item)
            return (
              <div key={item.id || i} className={`admmodal__history-row ${i === 0 ? 'is-latest' : ''}`}>
                <div>
                  <strong>{i === 0 ? 'Mais recente' : `Pedido ${historico.length - i}`}</strong>
                  <span className="admmodal__history-description">{dataCurta(item.created_at)} · {resumo.sorteioCurto}</span>
                </div>
                <div className="admmodal__history-result">
                  {lembreteWhatsappEm(item) && <span className="adm__whatsapp-tag">WhatsApp</span>}
                  <StatusPill status={item.status} />
                  <b>{formatBRL(item.total)}</b>
                </div>
              </div>
            )
          })}
        </div>


        <h3 className="admmodal__h3">Itens ({itens.length})</h3>
        <ul className="admmodal__itens">
          {itens.length === 0 ? (
            <li><span className="adm-muted">Sem itens neste pedido.</span></li>
          ) : (
            itens.map((it, i) => (
              <li key={i}>
                <span>{it.qty || 1}× {it.title || 'Item'}{it.numeros ? ` · ${it.numeros} nº` : ''}</span>
                <b>{it.price != null ? formatBRL(Number(it.price) * (it.qty || 1)) : ''}</b>
              </li>
            ))
          )}
        </ul>

        <div className="admmodal__lig">
          {pedido.ligador_id ? (
            <>
              <span className="admmodal__lig-info">
                📞 Ligador: <strong>{ligAtual ? (ligAtual.nome || ligAtual.usuario) : '—'}</strong>
                {' · '}{pedido.ligador_status === 'bom' ? '👍 Deu bom' : pedido.ligador_status === 'ruim' ? '👎 Deu ruim' : pedido.ligador_status === 'retorno' ? '↻ Retornar' : 'A ligar'}
              </span>
              {pedido.ligador_obs && <p className="admmodal__lig-obs">“{pedido.ligador_obs}”</p>}
              <button className="adm__btn adm__btn--ghost" onClick={() => onDesatribuir?.(pedido)}>Tirar do ligador</button>
            </>
          ) : (
            <div className="admmodal__lig-assign">
              <select value={ligLocal} onChange={(e) => setLigLocal(e.target.value)} disabled={!ligadores.length}>
                <option value="">{ligadores.length ? 'Enviar pro ligador…' : 'Nenhum ligador cadastrado'}</option>
                {ligadores.map((l) => <option key={l.id} value={l.id}>{l.nome || l.usuario}</option>)}
              </select>
              <button className="adm__btn" disabled={!ligLocal} onClick={() => onAtribuir?.(pedido, ligLocal)}>
                <Phone size={15} /> Enviar
              </button>
            </div>
          )}
        </div>

        <div className="admmodal__foot">
          {pedido.exportado && <span className="admmodal__exp-tag"><Check size={14} /> Já exportado</span>}
          {pedido.exportado && (
            <button className="adm__btn adm__btn--ghost" onClick={() => onReverter?.(pedido)}>
              Reverter p/ não exportados
            </button>
          )}
          <button className="adm__btn adm__btn--primary" onClick={() => onExport?.(pedido)}>
            <Download size={16} /> Exportar .txt
          </button>
        </div>
      </div>
    </div>
  )
}

// ---- Modal de detalhe de um "só cadastro" (perfil sem nenhum pedido) ------
function CadastroModal({ perfil, consulta, ligadores = [], onClose, onExport, onReverter, onAtribuir, onDesatribuir }) {
  const [ligLocal, setLigLocal] = useState('')
  useTravaScroll(true)
  useVoltarFecha(true, onClose)
  const ligAtual = ligadores.find((l) => l.id === perfil.ligador_id)
  const c = consulta || {}
  const nomeReal = nomeConsulta(c) || perfil.nome || 'Cliente'
  const linhas = [
    ['Nome', nomeReal],
    ['CPF', perfil.cpf ? maskCpf(perfil.cpf) : '—'],
    ['Telefone', perfil.telefone ? maskTelefone(perfil.telefone) : '—'],
    ['Nascimento', c.nascimento || '—'],
    ['Idade', c.idade != null && c.idade !== '' ? String(c.idade) : '—'],
    ['Sexo', c.sexo || '—'],
    ['Cadastro', perfil.created_at ? new Date(perfil.created_at).toLocaleString('pt-BR') : '—'],
  ]
  return (
    <div className="admmodal" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="admmodal__box" onClick={(e) => e.stopPropagation()}>
        <div className="admmodal__head">
          <div>
            <h2>{nomeReal}</h2>
            <span className="admmodal__sub">Só cadastro — nunca gerou pedido</span>
          </div>
          <button className="admmodal__x" onClick={onClose} aria-label="Fechar">×</button>
        </div>

        <dl className="admmodal__grid">
          {linhas.map(([k, v]) => (
            <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
          ))}
        </dl>

        <h3 className="admmodal__h3">Pagamentos confirmados (0)</h3>
        <p className="adm-muted">Nenhum pagamento confirmado ainda.</p>

        <div className="admmodal__lig">
          {perfil.ligador_id ? (
            <>
              <span className="admmodal__lig-info">
                📞 Ligador: <strong>{ligAtual ? (ligAtual.nome || ligAtual.usuario) : '—'}</strong>
                {' · '}{perfil.ligador_status === 'bom' ? '👍 Deu bom' : perfil.ligador_status === 'ruim' ? '👎 Deu ruim' : perfil.ligador_status === 'retorno' ? '↻ Retornar' : 'A ligar'}
              </span>
              {perfil.ligador_obs && <p className="admmodal__lig-obs">“{perfil.ligador_obs}”</p>}
              <button className="adm__btn adm__btn--ghost" onClick={() => onDesatribuir?.(perfil)}>Tirar do ligador</button>
            </>
          ) : (
            <div className="admmodal__lig-assign">
              <select value={ligLocal} onChange={(e) => setLigLocal(e.target.value)} disabled={!ligadores.length}>
                <option value="">{ligadores.length ? 'Enviar pro ligador…' : 'Nenhum ligador cadastrado'}</option>
                {ligadores.map((l) => <option key={l.id} value={l.id}>{l.nome || l.usuario}</option>)}
              </select>
              <button className="adm__btn" disabled={!ligLocal} onClick={() => onAtribuir?.(perfil, ligLocal)}>
                <Phone size={15} /> Enviar
              </button>
            </div>
          )}
        </div>

        <div className="admmodal__foot">
          {perfil.exportado_cadastro && <span className="admmodal__exp-tag"><Check size={14} /> Já exportado</span>}
          {perfil.exportado_cadastro && (
            <button className="adm__btn adm__btn--ghost" onClick={() => onReverter?.(perfil)}>
              Reverter p/ não exportados
            </button>
          )}
          <button className="adm__btn adm__btn--primary" onClick={() => onExport?.(perfil)}>
            <Download size={16} /> Exportar .txt
          </button>
        </div>
      </div>
    </div>
  )
}

export default function AdminPedidos() {
  const [rows, setRows] = useState(null)
  const [nomes, setNomes] = useState({}) // user_id -> { nome, cpf, email, telefone }
  // Chave Pix que o ganhador informou no resgate (cpf -> { tipo, chave, whatsapp_ok }).
  const [pixPorCpf, setPixPorCpf] = useState({})
  useEffect(() => {
    supabase.from('premio_pix').select('cpf,tipo,chave,whatsapp_ok,whatsapp_erro').then(({ data }) => {
      if (data) setPixPorCpf(Object.fromEntries(data.map((x) => [x.cpf, x])))
    }, () => {})
  }, [])
  const pixDe = (cpf) => pixPorCpf[String(cpf || '').replace(/\D/g, '')]
  const pixLinha = (cpf) => {
    const x = pixDe(cpf)
    if (!x) return null
    return (
      <p className="adm__pcard-obs" title={x.whatsapp_ok ? 'Confirmação enviada no WhatsApp' : `WhatsApp não enviado${x.whatsapp_erro ? `: ${x.whatsapp_erro}` : ''}`}>
        💸 Chave Pix ({x.tipo === 'aleatoria' ? 'aleatória' : x.tipo}): <strong style={{ userSelect: 'all' }}>{x.chave}</strong>{x.whatsapp_ok ? ' · ✅ WhatsApp' : ''}
      </p>
    )
  }
  const [cadastros, setCadastros] = useState(null) // perfis SEM nenhum pedido ("Somente Cadastros")
  const [aba, setAba] = useState('nao') // 'nao'|'exp'|'lig'|'cad'|'cadexp'
  const abasRef = useRef(null)
  useAbaVisivel(abasRef, aba)
  const [filtro, setFiltro] = useState('todos')
  // Aba Enviados: filtra por quem está com a ficha e pelo resultado da ligação.
  const [ligDono, setLigDono] = useState('')
  const [ligRes, setLigRes] = useState('')
  const [busca, setBusca] = useState('')
  const [erro, setErro] = useState('')
  const [sel, setSel] = useState(null)
  const [selecionados, setSelecionados] = useState(() => new Set())
  const [qtdSelecionar, setQtdSelecionar] = useState('')
  const [processando, setProcessando] = useState(false)
  const [ligadores, setLigadores] = useState([]) // [{ id, usuario, nome, ... }]
  const [ligadorSel, setLigadorSel] = useState('') // id do ligador, ou 'g:<id>' de gerente
  const [gerentes, setGerentes] = useState([])
  const [whatsappConfig, setWhatsappConfig] = useState(WHATSAPP_CONFIG_INICIAL)
  const [whatsappProcessando, setWhatsappProcessando] = useState('')
  const [gateways, setGateways] = useState(['pagarme'])
  const [agora, setAgora] = useState(Date.now())

  useEffect(() => {
    const id = setInterval(() => setAgora(Date.now()), 15000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    let active = true
    ;(async () => {
      let data = []
      let error = null
      try {
        data = await fetchAllPedidos()
      } catch (e) {
        error = e
      }
      if (!active) return
      if (error) setErro(error.message)
      const pedidos = data || []
      setRows(pedidos)

      const idsComPedido = new Set(pedidos.map((p) => p.user_id).filter(Boolean))

      // TODOS os perfis (não só quem tem pedido) — precisamos pra achar quem é
      // "só cadastro" (nunca gerou pedido nenhum). Se a coluna exportado_cadastro
      // ainda não existir (migration não rodada), cai pro select sem ela.
      let perfis = []
      try {
        perfis = await fetchAllProfiles()
      } catch {
        try {
          perfis = await fetchAllProfiles(CAMPOS_PERFIL) // gerentes_setup.sql ainda não rodado
        } catch { /* tenta o mínimo abaixo */ }
      }
      if (!perfis.length) {
        try {
          perfis = await (async () => {
            const out = []
            const size = 1000
            for (let from = 0; ; from += size) {
              const { data: pg, error: e2 } = await supabase.from('profiles')
                .select('id,nome,cpf,email,telefone,is_admin,created_at')
                .order('created_at', { ascending: false })
                .range(from, from + size - 1)
              if (e2 || !pg?.length) break
              out.push(...pg)
              if (pg.length < size) break
            }
            return out
          })()
        } catch { /* segue sem perfis */ }
      }
      if (!active) return

      const ids = perfis.map((p) => p.id)
      // dados_consulta (Serasa, interno). Só admin lê (RLS). Se a tabela ainda não
      // existir (migration não rodada), a query só volta vazia.
      const { data: cons } = ids.length
        ? await supabase.from('dados_consulta').select('user_id,nascimento,idade,profissao,score,renda,telefones,telefone_confere,nomeConsulta:nome').in('user_id', ids)
        : { data: [] }
      if (!active) return
      const consMap = {}
      ;(cons || []).forEach((c) => { consMap[c.user_id] = c })
      const map = {}
      perfis.forEach((p) => { map[p.id] = { ...p, ...(consMap[p.id] || {}) } })
      setNomes(map)
      setCadastros(perfis.filter((p) => !p.is_admin && !idsComPedido.has(p.id)))
    })()
    // Lista de ligadores (p/ o seletor "Enviar pro ligador" + mostrar o nome na aba).
    supabase.rpc('listar_ligadores').then(({ data }) => { if (active) setLigadores(data || []) }).catch(() => {})
    supabase.rpc('listar_gerentes').then(({ data }) => { if (active) setGerentes(data || []) }).catch(() => {})

    Promise.all([
      getConfig(CONFIG_KEYS.whatsappCobrancaAtivo),
      getConfig(CONFIG_KEYS.whatsappCobrancaNumero),
      getConfig(CONFIG_KEYS.whatsappCobrancaEsperaMinutos),
      getConfig(CONFIG_KEYS.whatsappCobrancaMensagem),
      getConfig(CONFIG_KEYS.gatewayAtivo),
      getConfig(CONFIG_KEYS.gatewayRodizio),
    ]).then(([ativo, numeroAtendimento, esperaMinutos, mensagem, gatewayAtivo, gatewayRodizio]) => {
      if (!active) return
      setWhatsappConfig({
        ativo: ativo === 'true',
        numeroAtendimento: numeroAtendimento || '',
        esperaMinutos: Math.max(0, Number(esperaMinutos) || 0),
        mensagem: normalizarTemplateCobrancaWhatsapp(mensagem || DEFAULT_WHATSAPP_COBRANCA_MESSAGE),
      })
      const gatewayPrincipal = GATEWAYS.includes(gatewayAtivo) ? gatewayAtivo : 'pagarme'
      setGateways(montarRodizio(gatewayPrincipal, gatewayRodizio))
    }).catch(() => {})

    return () => { active = false }
  }, [])

  // Trocar de aba zera a seleção (são "baldes" diferentes) e fecha o modal aberto
  // (pedido x cadastro usam modais diferentes — evita ficar com o tipo errado).
  const trocarAba = (a) => {
    setAba(a)
    setSelecionados(new Set())
    setSel(null)
  }

  const consolidados = useMemo(() => fichasPorPedido(rows || [], nomes), [rows, nomes])
  const enviado = (r) => Boolean(r.ligador_id || r.gerente_id)

  // Abas de cadastro-só (perfis sem nenhum pedido) — some da lista quando vai pro
  // ligador (mesma regra dos pedidos). Filtro/busca reaproveitam nome/cpf/telefone.
  const cadFiltrados = useMemo(() => {
    let list = (cadastros || []).filter((p) => !enviado(p) && Boolean(p.exportado_cadastro) === (aba === 'cadexp'))
    const q = busca.trim().toLowerCase()
    const qd = onlyDigits(busca)
    if (q) {
      list = list.filter((p) => {
        const c = nomes[p.id] || {}
        const alvo = `${nomeConsulta(c) || p.nome || ''}`.toLowerCase()
        const docs = `${onlyDigits(p.cpf)} ${onlyDigits(p.telefone)}`
        return alvo.includes(q) || (qd && docs.includes(qd))
      })
    }
    return list
  }, [cadastros, aba, busca, nomes])

  // Cadastros-só já enviados ao ligador — aparecem junto com os pedidos na aba
  // "Enviados ao ligador" (marcados com _kind pra escolher o layout do card certo).
  const ligCadastros = useMemo(() => {
    let list = (cadastros || []).filter(enviado).map((p) => ({ ...p, _kind: 'cadastro' }))
    const q = busca.trim().toLowerCase()
    const qd = onlyDigits(busca)
    if (q) {
      list = list.filter((p) => {
        const c = nomes[p.id] || {}
        const alvo = `${nomeConsulta(c) || p.nome || ''}`.toLowerCase()
        const docs = `${onlyDigits(p.cpf)} ${onlyDigits(p.telefone)}`
        return alvo.includes(q) || (qd && docs.includes(qd))
      })
    }
    return list
  }, [cadastros, busca, nomes])

  const donoDe = (r) => (r.ligador_id ? r.ligador_id : r.gerente_id ? `g:${r.gerente_id}` : '')
  const resDe = (r) => (r.ligador_id ? (r.ligador_status || 'a_ligar') : 'estoque')
  const passaLig = (r) => (!ligDono || donoDe(r) === ligDono) && (!ligRes || resDe(r) === ligRes)

  const filtrados = useMemo(() => {
    if (aba === 'cad' || aba === 'cadexp') return cadFiltrados
    let list = consolidados
    // Abas: 'lig' = atribuídos a um ligador; 'exp' = exportados (sem ligador);
    // 'nao' = caixa de entrada (sem ligador e não exportados).
    if (aba === 'lig') list = list.filter(enviado)
    else list = list.filter((r) => !enviado(r) && Boolean(r.exportado) === (aba === 'exp'))
    if (filtro !== 'todos') {
      list = list.filter((r) => (filtro === 'pago' ? r.status === 'pago' : r.status !== 'pago'))
    }
    const q = busca.trim().toLowerCase()
    if (q) {
      list = list.filter((r) => {
        const { sorteioCurto } = resumoPedido(r)
        const alvo = `${nomePagador(r, nomes)} ${cpfPagador(r, nomes)} ${telPagador(r, nomes)} ${sorteioCurto} ${cidadeLabel(r)} ${METODOS[r.metodo] || r.metodo || ''} ${r.status}`
        return alvo.toLowerCase().includes(q)
      })
    }
    // Cadastros-só enviados ao ligador entram junto na aba "Enviados ao ligador".
    if (aba === 'lig') list = [...list, ...ligCadastros].filter(passaLig)
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consolidados, aba, filtro, busca, nomes, cadFiltrados, ligCadastros, ligDono, ligRes])

  const naoCount = useMemo(() => consolidados.filter((r) => !r.exportado && !enviado(r)).length, [consolidados])
  const expCount = useMemo(() => consolidados.filter((r) => r.exportado && !enviado(r)).length, [consolidados])
  const ligCount = useMemo(
    () => consolidados.filter(enviado).length + (cadastros || []).filter(enviado).length,
    [consolidados, cadastros]
  )
  const cadCount = useMemo(() => (cadastros || []).filter((p) => !enviado(p) && !p.exportado_cadastro).length, [cadastros])
  const cadExpCount = useMemo(() => (cadastros || []).filter((p) => !enviado(p) && p.exportado_cadastro).length, [cadastros])

  const ligadorNome = (id) => {
    const l = ligadores.find((x) => x.id === id)
    return l ? (l.nome || l.usuario) : '—'
  }
  const destinoNome = (r) => {
    const lig = r.ligador_id
    if (lig) return ligadorNome(lig)
    const g = gerentes.find((x) => x.id === r.gerente_id)
    return g ? `Gerente ${g.nome || g.usuario} (no estoque)` : '—'
  }
  const ligResultado = (s) => (s === 'bom' ? '👍 Deu bom' : s === 'ruim' ? '👎 Deu ruim' : s === 'retorno' ? '↻ Retornar' : 'A ligar')

  const toggleSel = (id) =>
    setSelecionados((prev) => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })

  const todosFiltradosSelec = filtrados.length > 0 && filtrados.every((r) => selecionados.has(r.id))
  const toggleTodos = () =>
    setSelecionados((prev) => {
      const n = new Set(prev)
      if (filtrados.every((r) => n.has(r.id))) filtrados.forEach((r) => n.delete(r.id))
      else filtrados.forEach((r) => n.add(r.id))
      return n
    })

  // Seleciona os primeiros N da lista filtrada (ordem atual — mais recentes primeiro).
  // Substitui a seleção anterior (não soma).
  const selecionarQuantidade = () => {
    const n = Math.max(0, Math.min(filtrados.length, parseInt(qtdSelecionar, 10) || 0))
    if (!n) return
    setSelecionados(new Set(filtrados.slice(0, n).map((r) => r.id)))
  }

  // Marca/desmarca como exportado no banco + atualiza a lista local.
  const marcarExportado = async (ids, valor) => {
    if (!ids.length) return true
    setProcessando(true)
    setErro('')
    const exportado_at = valor ? new Date().toISOString() : null
    const { error } = await supabase
      .from('pedidos')
      .update({ exportado: valor, exportado_at })
      .in('id', ids)
    setProcessando(false)
    if (error) {
      setErro(`Não foi possível atualizar os pedidos: ${error.message}`)
      return false
    }
    const idset = new Set(ids)
    setRows((prev) => (prev || []).map((r) => (idset.has(r.id) ? { ...r, exportado: valor, exportado_at } : r)))
    return true
  }

  // Baixa uma lista de pedidos como UM .txt (separados por divisória). Na aba
  // "Enviados ao ligador" a lista pode vir misturada com cadastros-só (_kind).
  const baixarLista = (lista, nomeArquivo) => {
    const conteudo = lista
      .map((r) => (r._kind === 'cadastro' ? montarTxtCadastro(r, nomes[r.id]) : montarTxtPedido(r, nomes[r.user_id])))
      .join(`\n\n${'-'.repeat(48)}\n\n`)
    baixarArquivo(nomeArquivo, conteudo)
  }

  const hoje = () => new Date().toISOString().slice(0, 10)

  // Exportar selecionados (aba "não exportados"): baixa 1 arquivo e MOVE p/ exportados.
  const exportarSelecionados = async () => {
    const lista = filtrados.filter((r) => selecionados.has(r.id))
    if (!lista.length) return
    baixarLista(lista, `pedidos-viva-sorte-${hoje()}.txt`)
    const ok = await marcarExportado(lista.map((r) => r.id), true)
    if (ok) setSelecionados(new Set())
  }

  // Re-baixar selecionados (aba "exportados") — sem alterar o estado.
  const baixarSelecionados = () => {
    const lista = filtrados.filter((r) => selecionados.has(r.id))
    if (!lista.length) return
    baixarLista(lista, `pedidos-exportados-${hoje()}.txt`)
  }

  // Reverter selecionados/individual de volta p/ "não exportados".
  const reverter = async (ids) => {
    const ok = await marcarExportado(ids, false)
    if (ok) {
      setSelecionados(new Set())
      setSel(null)
    }
  }

  // Exportar UM pedido (a partir do modal): baixa + marca exportado (se ainda não estava).
  const exportarUm = async (pedido) => {
    const nome = slugNome(nomePagador(pedido, nomes))
    baixarArquivo(`pedido-${nome}-${String(pedido.id).slice(0, 8)}.txt`, montarTxtPedido(pedido, nomes[pedido.user_id]))
    if (!pedido.exportado) await marcarExportado([pedido.id], true)
    setSel(null)
  }

  // ---- "Somente Cadastros" (perfis sem nenhum pedido) -----------------------
  // Marca/desmarca como exportado no profile + atualiza a lista local.
  const marcarExportadoCadastro = async (ids, valor) => {
    if (!ids.length) return true
    setProcessando(true)
    setErro('')
    const exportado_cadastro_at = valor ? new Date().toISOString() : null
    const { error } = await supabase
      .from('profiles')
      .update({ exportado_cadastro: valor, exportado_cadastro_at })
      .in('id', ids)
    setProcessando(false)
    if (error) {
      setErro(`Não foi possível atualizar os cadastros: ${error.message}`)
      return false
    }
    const idset = new Set(ids)
    setCadastros((prev) => (prev || []).map((p) => (idset.has(p.id) ? { ...p, exportado_cadastro: valor, exportado_cadastro_at } : p)))
    return true
  }

  const baixarListaCadastro = (lista, nomeArquivo) => {
    const conteudo = lista
      .map((p) => montarTxtCadastro(p, nomes[p.id]))
      .join(`\n\n${'-'.repeat(48)}\n\n`)
    baixarArquivo(nomeArquivo, conteudo)
  }

  // Exportar selecionados (aba "Somente Cadastros"): baixa 1 arquivo e MOVE p/ exportados.
  const exportarSelecionadosCadastro = async () => {
    const lista = cadFiltrados.filter((p) => selecionados.has(p.id))
    if (!lista.length) return
    baixarListaCadastro(lista, `cadastros-viva-sorte-${hoje()}.txt`)
    const ok = await marcarExportadoCadastro(lista.map((p) => p.id), true)
    if (ok) setSelecionados(new Set())
  }

  // Re-baixar selecionados (aba "Somente Cadastros - Exportados") — sem alterar o estado.
  const baixarSelecionadosCadastro = () => {
    const lista = cadFiltrados.filter((p) => selecionados.has(p.id))
    if (!lista.length) return
    baixarListaCadastro(lista, `cadastros-exportados-${hoje()}.txt`)
  }

  // Reverter selecionados/individual de volta p/ "não exportados".
  const reverterCadastro = async (ids) => {
    const ok = await marcarExportadoCadastro(ids, false)
    if (ok) {
      setSelecionados(new Set())
      setSel(null)
    }
  }

  // Exportar UM cadastro (a partir do modal): baixa + marca exportado (se ainda não estava).
  const exportarUmCadastro = async (perfil) => {
    const nome = slugNome(nomeConsulta(nomes[perfil.id] || {}) || perfil.nome)
    baixarArquivo(`cadastro-${nome}-${String(perfil.id).slice(0, 8)}.txt`, montarTxtCadastro(perfil, nomes[perfil.id]))
    if (!perfil.exportado_cadastro) await marcarExportadoCadastro([perfil.id], true)
    setSel(null)
  }

  const atualizarPedidoLocal = (pedidoId, patch) => {
    const aplicar = (item) => {
      if (!item || item.id !== pedidoId) return item
      return {
        ...item,
        ...patch,
        pagador: patch.pagador ? { ...(item.pagador || {}), ...patch.pagador } : item.pagador,
      }
    }
    setRows((prev) => (prev || []).map(aplicar))
    setSel((prev) => {
      if (!prev) return prev
      const atualizado = aplicar(prev)
      return {
        ...atualizado,
        _historico: (prev._historico || [prev]).map(aplicar),
      }
    })
  }

  const montarPayloadPixWhatsapp = (pedido, cliente) => {
    const itensPagamento = (Array.isArray(pedido.itens) ? pedido.itens : [])
      .filter((it) => it && it.tipo !== 'deposito')
      .map((it) => ({
        title: it.title || 'Titulo Viva Sorte',
        qty: Number(it.qty) || 1,
        price: Number(it.price) || Number(pedido.total) || 0,
      }))
    const { sorteios, numeros } = resumoPedido(pedido)
    return {
      pedidoId: pedido.id,
      amount: Number(pedido.total),
      items: itensPagamento,
      descricao: { sorteios, numeros: numeros || 0 },
      metodo: pedido.metodo || 'pix',
      utm: pedido.utm || {},
      customer: {
        name: nomeConsulta(cliente) || cliente?.nome || nomePagador(pedido, nomes),
        email: emailPagador(pedido, nomes),
        cpf: cpfPagador(pedido, nomes),
        phone: telPagador(pedido, nomes),
      },
      regenerar: true,
    }
  }

  const renovarPixParaWhatsapp = async (pedido, cliente) => {
    const dados = await criarPagamentoPixFailover(montarPayloadPixWhatsapp(pedido, cliente), gateways, 0)
    const pix = String(dados?.qrCode || '').trim()
    const expiraEm = isoDePix(dados?.expiresAt)
    if (!pix || !expiraEm) {
      throw new Error('O gateway nao devolveu um Pix valido. Tente novamente em instantes.')
    }
    const geradoAt = new Date().toISOString()
    const patch = {
      gateway: dados.gateway || pedido.gateway || 'pagarme',
      pagarme_order_id: dados.orderId || pedido.pagarme_order_id || null,
      pagarme_charge_id: dados.chargeId || pedido.pagarme_charge_id || null,
      pix_copia_cola: pix,
      pix_gerado_at: geradoAt,
      pix_expira_em: expiraEm,
      pagador: {
        pix_copia_cola: pix,
        pix_gerado_at: geradoAt,
        pix_expira_em: expiraEm,
      },
    }
    atualizarPedidoLocal(pedido.id, patch)
    return {
      ...pedido,
      ...patch,
      pagador: { ...(pedido.pagador || {}), ...patch.pagador },
    }
  }

  const registrarWhatsappPreparado = async (pedidoId, marcador) => {
    atualizarPedidoLocal(pedidoId, { ...marcador, pagador: marcador })
    try {
      await supabase.from('pedidos').update(marcador).eq('id', pedidoId)
    } catch {
      /* registro interno best-effort: nunca bloqueia a abertura do WhatsApp */
    }
  }

  const abrirWhatsapp = async (pedido) => {
    const cliente = nomes[pedido.user_id] || {}
    let pedidoAtual = pedido
    let avaliacao = avaliarCobrancaWhatsapp(pedidoAtual, cliente, whatsappConfig, Date.now())
    const precisaRenovarPix = deveRenovarPixWhatsapp(avaliacao)
    if (!avaliacao.ok && !avaliacao.podeReabrir && !precisaRenovarPix) {
      setErro(avaliacao.motivo)
      return
    }

    // Abre uma aba vazia dentro do clique (nao e bloqueada). Depois, se precisar,
    // gera um Pix novo e troca essa aba pelo link wa.me do telefone do cliente.
    const janela = window.open('about:blank', '_blank')
    if (!janela) {
      setErro('O navegador bloqueou a nova aba do WhatsApp. Libere pop-ups para este site e tente novamente.')
      return
    }

    setWhatsappProcessando(pedido.id)
    setErro('')

    try {
      if (precisaRenovarPix) {
        pedidoAtual = await renovarPixParaWhatsapp(pedidoAtual, cliente)
        avaliacao = avaliarCobrancaWhatsapp(pedidoAtual, cliente, { ...whatsappConfig, esperaMinutos: 0 }, Date.now())
        if (!avaliacao.ok && !avaliacao.podeReabrir) {
          throw new Error(avaliacao.motivo || 'Nao foi possivel validar o novo Pix para WhatsApp.')
        }
      }

      const { sorteioCurto } = resumoPedido(pedidoAtual)
      const numeroAtendimento = whatsappConfig.numeroAtendimento
        ? maskTelefone(String(whatsappConfig.numeroAtendimento).replace(/^55/, ''))
        : ''
      const mensagem = montarMensagemWhatsappInicial(
        whatsappConfig.mensagem,
        {
          nome: nomeConsulta(cliente) || cliente.nome || nomePagador(pedidoAtual, nomes),
          pedido: String(pedidoAtual.id).slice(0, 8).toUpperCase(),
          valor: formatBRL(pedidoAtual.total),
          pix: pixDoPedido(pedidoAtual),
          expiracao: dataCurta(avaliacao.expiraEm),
          sorteio: sorteioCurto,
          numeroAtendimento,
        },
      )
      const url = montarWaMeUrl(avaliacao.destino, mensagem)
      if (!url) throw new Error('Nao foi possivel montar o link do WhatsApp para este telefone.')

      const preparadoAt = new Date().toISOString()
      const marcador = {
        whatsapp_lembrete_at: preparadoAt,
        whatsapp_lembrete_status: 'preparado',
        whatsapp_lembrete_destino: avaliacao.destino,
        whatsapp_lembrete_modelo: whatsappConfig.mensagem,
        ...(numeroAtendimento ? { whatsapp_lembrete_atendimento: numeroAtendimento } : {}),
      }
      setWhatsappProcessando('')
      try {
        janela.opener = null
        janela.location.replace(url)
      } catch {
        setErro('O link foi montado, mas o navegador nao conseguiu abrir o WhatsApp. Atualize a pagina antes de tentar novamente.')
      }
      registrarWhatsappPreparado(pedidoAtual.id, marcador)
    } catch (e) {
      setWhatsappProcessando('')
      try { janela.close() } catch { /* best-effort */ }
      setErro(e.message || 'Nao foi possivel abrir o WhatsApp para este pedido. Tente novamente.')
    }
  }

  // destino = id do ligador, ou 'g:<id>' pro estoque do gerente (ele repassa aos ligadores dele).
  const patchDestino = (destino) => {
    if (String(destino).startsWith('g:')) {
      return { gerente_id: destino.slice(2), ligador_id: null, ligador_status: null, ligador_obs: null, ligador_at: null, ligador_liberado_at: null }
    }
    return { ligador_id: destino, ligador_status: 'a_ligar', ligador_obs: null, ligador_at: null, ligador_liberado_at: null }
  }
  // Pedido de fichas do gerente em aberto fica atendido quando o admin envia.
  // Ligador direto: libera na hora, sem esperar pedido de fichas.
  const avisarGerente = async (destino) => {
    if (String(destino).startsWith('g:')) supabase.rpc('atender_solicitacoes_gerente', { p_gerente: destino.slice(2) }).then(() => {}, () => {})
    else {
      const { error } = await supabase.rpc('admin_liberar_fichas_ligador', { p_ligador: destino })
      if (error) setErro(`Enviado, mas as fichas não foram liberadas pro ligador: ${error.message}. Rode o supabase/admin_liberar_fichas_setup.sql no Supabase.`)
    }
  }

  // Atribui pedidos a um ligador ou gerente (sai da lista → aba "Enviados").
  const atribuirLigador = async (ids, destino) => {
    if (!ids.length || !destino) return
    const repetidas = (rows || []).filter((r) => ids.includes(r.id) && Number(r.ordem_cliente) > 1)
    if (repetidas.length && !window.confirm(`Fichas repetidas:
${repetidas.map((r) => `• ${r.pagador?.nome || 'Cliente'} — ${r.ordem_cliente}ª ficha deste cliente`).join('\n')}

Enviar mesmo assim?`)) return
    setProcessando(true)
    setErro('')
    const patch = patchDestino(destino)
    const { error } = await supabase
      .from('pedidos')
      .update(patch)
      .in('id', ids)
    setProcessando(false)
    if (error) { setErro(`Não foi possível enviar: ${error.message}`); return }
    await avisarGerente(destino)
    const idset = new Set(ids)
    setRows((prev) => (prev || []).map((r) => (idset.has(r.id) ? { ...r, ...patch } : r)))
    setSelecionados(new Set())
    setLigadorSel('')
    setSel(null)
  }

  // Tira a atribuição (volta o pedido pro fluxo normal).
  const desatribuir = async (ids) => {
    if (!ids.length) return
    setProcessando(true)
    setErro('')
    const { error } = await supabase
      .from('pedidos')
      .update({ ligador_id: null, gerente_id: null, ligador_status: null, ligador_obs: null, ligador_at: null, ligador_liberado_at: null })
      .in('id', ids)
    setProcessando(false)
    if (error) { setErro(error.message); return }
    const idset = new Set(ids)
    setRows((prev) => (prev || []).map((r) => (idset.has(r.id) ? { ...r, ligador_id: null, gerente_id: null, ligador_status: null, ligador_obs: null } : r)))
    setSelecionados(new Set())
    setSel(null)
  }

  // Atribui cadastros-só a um ligador (sai de "Somente Cadastros" → "Enviados ao ligador").
  const atribuirLigadorCadastro = async (ids, destino) => {
    if (!ids.length || !destino) return
    setProcessando(true)
    setErro('')
    const patch = patchDestino(destino)
    const { error } = await supabase
      .from('profiles')
      .update(patch)
      .in('id', ids)
    setProcessando(false)
    if (error) { setErro(`Não foi possível enviar: ${error.message}`); return }
    await avisarGerente(destino)
    const idset = new Set(ids)
    setCadastros((prev) => (prev || []).map((p) => (idset.has(p.id) ? { ...p, ...patch } : p)))
    setSelecionados(new Set())
    setLigadorSel('')
    setSel(null)
  }

  // Tira a atribuição de um cadastro-só (volta pra "Somente Cadastros").
  const desatribuirCadastro = async (ids) => {
    if (!ids.length) return
    setProcessando(true)
    setErro('')
    const { error } = await supabase
      .from('profiles')
      .update({ ligador_id: null, gerente_id: null, ligador_status: null, ligador_obs: null, ligador_at: null, ligador_liberado_at: null })
      .in('id', ids)
    setProcessando(false)
    if (error) { setErro(error.message); return }
    const idset = new Set(ids)
    setCadastros((prev) => (prev || []).map((p) => (idset.has(p.id) ? { ...p, ligador_id: null, gerente_id: null, ligador_status: null, ligador_obs: null } : p)))
    setSelecionados(new Set())
    setSel(null)
  }

  // Transfere pra outro ligador/gerente só as fichas que ainda não foram ligadas
  // ("A ligar" ou paradas no estoque do gerente). Deu bom / ruim / retorno ficam onde estão.
  const transferir = async (ids, destino) => {
    if (!ids.length || !destino) return
    const idsCadastro = new Set(ligCadastros.map((c) => c.id))
    const todas = [...(rows || []), ...ligCadastros]
    const naoLigou = (r) => r && !['bom', 'ruim', 'retorno'].includes(r.ligador_status)
    const mover = ids.filter((id) => naoLigou(todas.find((r) => r.id === id)) && donoDe(todas.find((r) => r.id === id)) !== destino)
    const pulou = ids.length - mover.length
    if (!mover.length) { setErro('Nenhuma ficha selecionada está "A ligar" — nada foi transferido.'); return }
    if (!window.confirm(`Transferir ${mover.length} ficha(s) que ainda não foram ligadas?${pulou ? `
${pulou} já ligada(s) (ou já com esse destino) ficam onde estão.` : ''}`)) return
    setProcessando(true)
    setErro('')
    const patch = patchDestino(destino)
    const doPedido = mover.filter((id) => !idsCadastro.has(id))
    const doCadastro = mover.filter((id) => idsCadastro.has(id))
    const naoLigadas = 'ligador_status.is.null,ligador_status.eq.a_ligar'
    const r1 = doPedido.length ? await supabase.from('pedidos').update(patch).in('id', doPedido).or(naoLigadas) : {}
    const r2 = doCadastro.length ? await supabase.from('profiles').update(patch).in('id', doCadastro).or(naoLigadas) : {}
    setProcessando(false)
    const error = r1.error || r2.error
    if (error) { setErro(`Não foi possível transferir: ${error.message}`); return }
    await avisarGerente(destino)
    const sp = new Set(doPedido), sc = new Set(doCadastro)
    setRows((prev) => (prev || []).map((r) => (sp.has(r.id) ? { ...r, ...patch } : r)))
    setCadastros((prev) => (prev || []).map((p) => (sc.has(p.id) ? { ...p, ...patch } : p)))
    setSelecionados(new Set())
    setLigadorSel('')
    setSel(null)
  }

  // "Tirar do ligador" na aba mista (pode ter pedidos e cadastros-só juntos).
  const desatribuirMisto = (ids) => {
    const idsCadastro = new Set(ligCadastros.map((c) => c.id))
    const doPedido = ids.filter((id) => !idsCadastro.has(id))
    const doCadastro = ids.filter((id) => idsCadastro.has(id))
    if (doPedido.length) desatribuir(doPedido)
    if (doCadastro.length) desatribuirCadastro(doCadastro)
  }

  return (
    <div>
      <header className="adm__pagehead">
        <div>
          <h1 className="adm__title">Pedidos</h1>
          <p className="adm__subtitle">
            {rows ? `${consolidados.length} cliente(s) · ${rows.length} pedido(s) gerado(s)` : 'Carregando…'}
            {cadastros && ` · ${cadastros.length} só cadastro`}
          </p>
        </div>
      </header>

      {/* Abas: não exportados x exportados */}
      <div className="adm__tabs" role="tablist" ref={abasRef}>
        <button className={`adm__tab ${aba === 'nao' ? 'is-active' : ''}`} onClick={() => trocarAba('nao')} role="tab" aria-selected={aba === 'nao'}>
          Pedidos {rows && <span className="adm__tab-badge">{naoCount}</span>}
        </button>
        <button className={`adm__tab ${aba === 'exp' ? 'is-active' : ''}`} onClick={() => trocarAba('exp')} role="tab" aria-selected={aba === 'exp'}>
          Pedidos Exportados {rows && <span className="adm__tab-badge">{expCount}</span>}
        </button>
        <button className={`adm__tab ${aba === 'lig' ? 'is-active' : ''}`} onClick={() => trocarAba('lig')} role="tab" aria-selected={aba === 'lig'}>
          Enviados {rows && <span className="adm__tab-badge">{ligCount}</span>}
        </button>
        <button className={`adm__tab ${aba === 'cad' ? 'is-active' : ''}`} onClick={() => trocarAba('cad')} role="tab" aria-selected={aba === 'cad'}>
          Somente Cadastros {cadastros && <span className="adm__tab-badge">{cadCount}</span>}
        </button>
        <button className={`adm__tab ${aba === 'cadexp' ? 'is-active' : ''}`} onClick={() => trocarAba('cadexp')} role="tab" aria-selected={aba === 'cadexp'}>
          Somente Cadastros - Exportados {cadastros && <span className="adm__tab-badge">{cadExpCount}</span>}
        </button>
      </div>

      {erro && <p className="auth__erro">{erro}</p>}

      <div className="adm__toolbar">
        <div className="adm__searchwrap">
          <Search size={16} />
          <input
            className="adm__search"
            placeholder={aba === 'cad' || aba === 'cadexp' ? 'Buscar por nome, CPF ou telefone…' : 'Buscar por pagador, sorteio, cidade ou método…'}
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        {aba !== 'cad' && aba !== 'cadexp' && (
          <div className="adm__filtros">
            {[['todos', 'Todos'], ['pago', 'Pagos'], ['pendente', 'Não pagos']].map(([f, label]) => (
              <button key={f} className={`adm__chip ${filtro === f ? 'is-active' : ''}`} onClick={() => setFiltro(f)}>
                {label}
              </button>
            ))}
          </div>
        )}
        {aba === 'lig' && (
          <div className="adm__filtros">
            <select className="adm__ligsel" value={ligDono} onChange={(e) => { setLigDono(e.target.value); setSelecionados(new Set()) }}>
              <option value="">Todos os ligadores</option>
              {ligadores.length > 0 && (
                <optgroup label="Ligadores">
                  {ligadores.map((l) => <option key={l.id} value={l.id}>{l.nome || l.usuario}</option>)}
                </optgroup>
              )}
              {gerentes.length > 0 && (
                <optgroup label="Estoque do gerente">
                  {gerentes.map((g) => <option key={g.id} value={`g:${g.id}`}>{g.nome || g.usuario}</option>)}
                </optgroup>
              )}
            </select>
            <select className="adm__ligsel" value={ligRes} onChange={(e) => { setLigRes(e.target.value); setSelecionados(new Set()) }}>
              <option value="">Todos os resultados</option>
              <option value="a_ligar">A ligar</option>
              <option value="retorno">Retornar</option>
              <option value="bom">Deu bom</option>
              <option value="ruim">Deu ruim</option>
              <option value="estoque">No estoque do gerente</option>
            </select>
          </div>
        )}
      </div>

      {/* Selecionar todos (filtrados) + selecionar por quantidade (pega os primeiros N na ordem atual) */}
      {(rows || cadastros) && filtrados.length > 0 && (
        <div className="adm__selrow">
          <label className="adm__selall">
            <input type="checkbox" checked={todosFiltradosSelec} onChange={toggleTodos} />
            <span className="adm__check-box"><Check size={13} /></span>
            Selecionar todos ({filtrados.length})
          </label>
          <form
            className="adm__selqtd"
            onSubmit={(e) => { e.preventDefault(); selecionarQuantidade() }}
          >
            <span>Selecionar os primeiros</span>
            <input
              type="number"
              min="1"
              max={filtrados.length}
              placeholder="qtd"
              value={qtdSelecionar}
              onChange={(e) => setQtdSelecionar(e.target.value)}
            />
            <button type="submit" className="adm__btn" disabled={!qtdSelecionar}>Selecionar</button>
          </form>
        </div>
      )}

      {/* Barra de ações em massa */}
      {selecionados.size > 0 && (
        <div className="adm__bulkbar">
          <span className="adm__bulkbar-count">{selecionados.size} selecionado(s)</span>
          <div className="adm__bulkbar-actions">
            {aba === 'nao' && (
              <>
                <button className="adm__btn adm__btn--primary" onClick={exportarSelecionados} disabled={processando}>
                  <Download size={16} /> Exportar selecionados
                </button>
                <select className="adm__ligsel" value={ligadorSel} onChange={(e) => setLigadorSel(e.target.value)} disabled={!ligadores.length && !gerentes.length}>
                  <option value="">{ligadores.length || gerentes.length ? 'Enviar para…' : 'Nenhum ligador'}</option>
                  {ligadores.length > 0 && (
                    <optgroup label="Ligadores">
                      {ligadores.map((l) => <option key={l.id} value={l.id}>{l.nome || l.usuario}</option>)}
                    </optgroup>
                  )}
                  {gerentes.length > 0 && (
                    <optgroup label="Gerentes (estoque dele)">
                      {gerentes.map((g) => <option key={g.id} value={`g:${g.id}`}>{g.nome || g.usuario}</option>)}
                    </optgroup>
                  )}
                </select>
                <button className="adm__btn" onClick={() => atribuirLigador([...selecionados], ligadorSel)} disabled={processando || !ligadorSel}>
                  <Phone size={15} /> Enviar
                </button>
              </>
            )}
            {aba === 'exp' && (
              <>
                <button className="adm__btn" onClick={baixarSelecionados} disabled={processando}>
                  <Download size={16} /> Baixar novamente
                </button>
                <button className="adm__btn adm__btn--ghost" onClick={() => reverter([...selecionados])} disabled={processando}>
                  Reverter p/ não exportados
                </button>
              </>
            )}
            {aba === 'lig' && (
              <>
                <button className="adm__btn" onClick={baixarSelecionados} disabled={processando}>
                  <Download size={16} /> Baixar .txt
                </button>
                <select className="adm__ligsel" value={ligadorSel} onChange={(e) => setLigadorSel(e.target.value)}>
                  <option value="">Transferir para…</option>
                  {ligadores.length > 0 && (
                    <optgroup label="Ligadores">
                      {ligadores.map((l) => <option key={l.id} value={l.id}>{l.nome || l.usuario}</option>)}
                    </optgroup>
                  )}
                  {gerentes.length > 0 && (
                    <optgroup label="Gerentes (estoque dele)">
                      {gerentes.map((g) => <option key={g.id} value={`g:${g.id}`}>{g.nome || g.usuario}</option>)}
                    </optgroup>
                  )}
                </select>
                <button className="adm__btn" onClick={() => transferir([...selecionados], ligadorSel)} disabled={processando || !ligadorSel}>
                  <Phone size={15} /> Transferir só “A ligar”
                </button>
                <button className="adm__btn adm__btn--ghost" onClick={() => desatribuirMisto([...selecionados])} disabled={processando}>
                  Tirar do ligador/gerente
                </button>
              </>
            )}
            {aba === 'cad' && (
              <>
                <button className="adm__btn adm__btn--primary" onClick={exportarSelecionadosCadastro} disabled={processando}>
                  <Download size={16} /> Exportar selecionados
                </button>
                <select className="adm__ligsel" value={ligadorSel} onChange={(e) => setLigadorSel(e.target.value)} disabled={!ligadores.length && !gerentes.length}>
                  <option value="">{ligadores.length || gerentes.length ? 'Enviar para…' : 'Nenhum ligador'}</option>
                  {ligadores.length > 0 && (
                    <optgroup label="Ligadores">
                      {ligadores.map((l) => <option key={l.id} value={l.id}>{l.nome || l.usuario}</option>)}
                    </optgroup>
                  )}
                  {gerentes.length > 0 && (
                    <optgroup label="Gerentes (estoque dele)">
                      {gerentes.map((g) => <option key={g.id} value={`g:${g.id}`}>{g.nome || g.usuario}</option>)}
                    </optgroup>
                  )}
                </select>
                <button className="adm__btn" onClick={() => atribuirLigadorCadastro([...selecionados], ligadorSel)} disabled={processando || !ligadorSel}>
                  <Phone size={15} /> Enviar
                </button>
              </>
            )}
            {aba === 'cadexp' && (
              <>
                <button className="adm__btn" onClick={baixarSelecionadosCadastro} disabled={processando}>
                  <Download size={16} /> Baixar novamente
                </button>
                <button className="adm__btn adm__btn--ghost" onClick={() => reverterCadastro([...selecionados])} disabled={processando}>
                  Reverter p/ não exportados
                </button>
              </>
            )}
            <button className="adm__btn adm__btn--ghost" onClick={() => setSelecionados(new Set())}>Limpar</button>
          </div>
        </div>
      )}

      <div className="adm__plist">
        {(aba === 'cad' || aba === 'cadexp') ? (
          !cadastros ? (
            [...Array(6)].map((_, i) => (
              <div key={i} className="adm__pcard adm__pcard--skel"><span className="adm__skel" /></div>
            ))
          ) : filtrados.length === 0 ? (
            <p className="adm__empty-cell">
              {aba === 'cadexp' ? 'Nenhum cadastro exportado ainda.' : 'Nenhum cliente só-cadastro encontrado.'}
              {!busca && cadastros.some(enviado) && (
                <>
                  <br />
                  {cadastros.filter(enviado).length} já foram enviados ao ligador/gerente.{' '}
                  <button type="button" className="adm__linkbtn" onClick={() => trocarAba('lig')}>Ver na aba Enviados</button>
                </>
              )}
            </p>
          ) : (
            filtrados.map((p) => {
              const c = nomes[p.id] || {}
              const checked = selecionados.has(p.id)
              return (
                <div
                  key={p.id}
                  className={`adm__pcard ${checked ? 'is-sel' : ''}`}
                  onClick={() => setSel(p)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); setSel(p) } }}
                >
                  <div className="adm__pcard-top">
                    <label className="adm__pcard-check" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={checked} onChange={() => toggleSel(p.id)} aria-label="Selecionar cadastro" />
                      <span className="adm__check-box"><Check size={13} /></span>
                    </label>
                    <strong className="adm__pcard-nome">{nomeConsulta(c) || p.nome || '—'}</strong>
                  </div>
                  <dl className="adm__pcard-grid">
                    <dt>CPF</dt><dd>{p.cpf ? maskCpf(p.cpf) : '—'}</dd>
                    <dt>Telefone</dt><dd>{p.telefone ? maskTelefone(p.telefone) : '—'}</dd>
                    <dt>Idade</dt><dd>{c.idade != null && c.idade !== '' ? c.idade : '—'}</dd>
                    <dt>Cadastro</dt><dd>{dataCurta(p.created_at)}</dd>
                  </dl>
                </div>
              )
            })
          )
        ) : !rows ? (
          [...Array(6)].map((_, i) => (
            <div key={i} className="adm__pcard adm__pcard--skel"><span className="adm__skel" /></div>
          ))
        ) : filtrados.length === 0 ? (
          <p className="adm__empty-cell">
            {aba === 'exp' ? 'Nenhum pedido exportado ainda.' : 'Nenhum pedido encontrado.'}
          </p>
        ) : (
          filtrados.map((r) => {
            if (r._kind === 'cadastro') {
              const c = nomes[r.id] || {}
              const checked = selecionados.has(r.id)
              return (
                <div
                  key={r.id}
                  className={`adm__pcard ${checked ? 'is-sel' : ''}`}
                  onClick={() => setSel(r)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); setSel(r) } }}
                >
                  <div className="adm__pcard-top">
                    <label className="adm__pcard-check" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={checked} onChange={() => toggleSel(r.id)} aria-label="Selecionar cadastro" />
                      <span className="adm__check-box"><Check size={13} /></span>
                    </label>
                    <strong className="adm__pcard-nome">{nomeConsulta(c) || r.nome || '—'}</strong>
                    <span className="adm__tag">Só cadastro</span>
                  </div>
                  <dl className="adm__pcard-grid">
                    <dt>CPF</dt><dd>{r.cpf ? maskCpf(r.cpf) : '—'}</dd>
                    <dt>Telefone</dt><dd>{r.telefone ? maskTelefone(r.telefone) : '—'}</dd>
                    <dt>Idade</dt><dd>{c.idade != null && c.idade !== '' ? c.idade : '—'}</dd>
                    <dt>Ligador</dt><dd>{destinoNome(r)}</dd>
                    <dt>Resultado</dt><dd>{ligResultado(r.ligador_status)}</dd>
                  </dl>
                  {r.ligador_obs && <p className="adm__pcard-obs">“{r.ligador_obs}”</p>}
                  {pixLinha(r.cpf)}
                </div>
              )
            }
            const { sorteioCurto, numeros } = resumoPedido(r)
            const checked = selecionados.has(r.id)
            const whatsapp = avaliarCobrancaWhatsapp(r, nomes[r.user_id], whatsappConfig, agora)
            const renovarPix = deveRenovarPixWhatsapp(whatsapp)
            const whatsappPreparado = lembreteWhatsappEm(r)
            return (
              <div
                key={r.id}
                className={`adm__pcard ${checked ? 'is-sel' : ''}`}
                onClick={() => setSel(r)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); setSel(r) } }}
              >
                <div className="adm__pcard-top">
                  <label className="adm__pcard-check" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={checked} onChange={() => toggleSel(r.id)} aria-label="Selecionar pedido" />
                    <span className="adm__check-box"><Check size={13} /></span>
                  </label>
                  <strong className="adm__pcard-nome">{nomePagador(r, nomes)}</strong>
                  <StatusPill status={r.status} />
                </div>
                <div className="adm__pcard-history" aria-label="Histórico de pedidos do cliente">
                  <span>Gerou <b>{r._totalGerados}×</b></span>
                  {r._totalPagos > 0 && <span className="is-paid">Pagou <b>{r._totalPagos}×</b></span>}
                  {Number(r.ordem_cliente) > 1 && <span className="is-voltou" title="Já tem compra paga antes desta">{r.ordem_cliente}ª ficha</span>}
                  {r._voltou && <span className="is-voltou" title={`Gerou/pagou de novo depois de exportado (${dataCurta(r._exportadoEm)})`}>🔁 Voltou</span>}
                  {whatsappPreparado && <span className="is-whatsapp">WhatsApp preparado</span>}
                </div>
                <dl className="adm__pcard-grid">
                  <dt>Sorteio</dt><dd title={sorteioCurto}>{sorteioCurto}</dd>
                  <dt>Números</dt><dd>{numeros == null ? '—' : numeros}</dd>
                  <dt>Total</dt><dd>{formatBRL(r.total)}</dd>
                  <dt>Idade</dt><dd>{nomes[r.user_id]?.idade != null && nomes[r.user_id]?.idade !== '' ? nomes[r.user_id].idade : '—'}</dd>
                  <dt>Banco</dt><dd>{bancoLabel(r)}</dd>
                  <dt>Cidade</dt><dd>{cidadeLabel(r)}</dd>
                  <dt>Data</dt><dd>{dataCurta(r.created_at)}</dd>
                  {aba === 'lig' && (
                    <>
                      <dt>Ligador</dt><dd>{destinoNome(r)}</dd>
                      <dt>Resultado</dt><dd>{ligResultado(r.ligador_status)}</dd>
                    </>
                  )}
                </dl>
                {(whatsapp.ok || whatsapp.podeReabrir || renovarPix) && (
                  <button
                    type="button"
                    className="adm__btn adm__btn--whatsapp adm__pcard-whatsapp"
                    disabled={whatsappProcessando === r.id}
                    onClick={(e) => { e.stopPropagation(); setSel(r) }}
                  >
                    <Phone size={15} /> {whatsappProcessando === r.id ? 'Abrindo...' : whatsapp.podeReabrir ? 'Ver lembrete' : 'Preparar lembrete'}
                  </button>
                )}
                {aba === 'lig' && r.ligador_obs && <p className="adm__pcard-obs">“{r.ligador_obs}”</p>}
                {pixLinha(cpfPagador(r, nomes))}
              </div>
            )
          })
        )}
      </div>

      {sel && (aba === 'cad' || aba === 'cadexp' || sel._kind === 'cadastro') && (
        <CadastroModal
          perfil={sel}
          consulta={nomes[sel.id]}
          ligadores={ligadores}
          onClose={() => setSel(null)}
          onExport={exportarUmCadastro}
          onReverter={(p) => reverterCadastro([p.id])}
          onAtribuir={(p, ligId) => atribuirLigadorCadastro([p.id], ligId)}
          onDesatribuir={(p) => desatribuirCadastro([p.id])}
        />
      )}
      {sel && aba !== 'cad' && aba !== 'cadexp' && sel._kind !== 'cadastro' && (
        <PedidoModal
          pedido={sel}
          cliente={nomes[sel.user_id]}
          ligadores={ligadores}
          onClose={() => setSel(null)}
          onExport={exportarUm}
          onReverter={(p) => reverter([p.id])}
          onAtribuir={(p, ligId) => atribuirLigador([p.id], ligId)}
          onDesatribuir={(p) => desatribuir([p.id])}
        />
      )}
    </div>
  )
}
