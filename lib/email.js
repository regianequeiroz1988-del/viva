// Envio de e-mail (via Resend) — usado pelo backend pra avisar o GANHADOR quando o
// pagamento é confirmado. A chave e o remetente vêm do env OU da tabela
// `configuracoes` (campos no /admin). NÃO lança erro: se faltar chave/e-mail, só
// não envia (não atrapalha o pagamento).
//
// ⚠️ Mantenha o prêmio/bilhete em sincronia com src/utils/premio.js.
const PREMIO = 50000
const BILHETE = '192273'
const RESEND_URL = 'https://api.resend.com/emails'

async function configDoBanco(chave) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const srk = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !srk) return ''
  try {
    const r = await fetch(`${url}/rest/v1/configuracoes?chave=eq.${chave}&select=valor`, {
      headers: { apikey: srk, Authorization: `Bearer ${srk}` },
    })
    if (!r.ok) return ''
    const rows = await r.json()
    return rows?.[0]?.valor || ''
  } catch {
    return ''
  }
}

const brl = (v) => 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })

function emailGanhadorHtml(nome, grupoUrl) {
  const primeiro = nome ? String(nome).split(' ')[0] : ''
  return `<!doctype html><html><body style="margin:0;background:#0e1633;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:30px 22px;color:#ffffff;text-align:center">
    <div style="font-size:40px">🎉🏆🎉</div>
    <h1 style="font-size:24px;margin:8px 0 6px">Parabéns${primeiro ? ', ' + primeiro : ''}!</h1>
    <p style="font-size:16px;color:#cdd6ff;margin:0 0 4px">Você foi <strong>sorteado(a)</strong> com um número premiado!</p>
    <div style="background:#ffffff;color:#1a1c2b;border-radius:14px;padding:20px;margin:18px 0">
      <div style="font-size:12px;color:#6b7196;text-transform:uppercase;letter-spacing:.5px">Bilhete premiado</div>
      <div style="font-size:30px;font-weight:800;letter-spacing:3px;color:#1e3fcf">${BILHETE}</div>
      <div style="font-size:12px;color:#6b7196;margin-top:14px;text-transform:uppercase;letter-spacing:.5px">Você ganhou na hora</div>
      <div style="font-size:26px;font-weight:800;color:#1e9e4a">${brl(PREMIO)}</div>
    </div>
    <p style="font-size:14px;color:#cdd6ff">📱 Em até <strong>24 horas</strong> entraremos em contato pelo seu telefone para realizar o pagamento do prêmio. Fique atento(a)!</p>
    ${grupoUrl ? `<a href="${grupoUrl}" style="display:inline-block;margin-top:14px;background:#25ad4b;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:700">Entrar no grupo dos ganhadores</a>` : ''}
    <p style="font-size:12px;color:#7681b0;margin-top:24px;line-height:1.5">Viva Sorte+ — nunca pedimos senha, PIX ou taxa adiantada para liberar prêmios. Desconfie de quem pedir.</p>
  </div></body></html>`
}

const SITE_URL = (process.env.SITE_URL || 'https://sortepremios.club').replace(/\/$/, '')

const maskCpfStr = (v) => {
  const d = String(v || '').replace(/\D/g, '').slice(0, 11)
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : (v || '')
}

const dataHora = (iso) => {
  const d = iso ? new Date(iso) : new Date()
  if (Number.isNaN(d.getTime())) return ''
  return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
}

// Configuração por status (assunto + frase + emoji), no padrão dos e-mails do Viva Sorte.
// Só enviamos PENDENTE (ao gerar o Pix) e APROVADO (ao confirmar) — sem e-mail de cancelamento.
const STATUS_EMAIL = {
  pendente: { rotulo: 'pendente', frase: 'está pendente', emoji: '💬' },
  aprovado: { rotulo: 'aprovado', frase: 'foi aprovado', emoji: '✅' },
}

function emailPedidoHtml({ nome, cpf, numero, valor, quando, frase, emoji }) {
  const primeiro = nome ? String(nome).split(' ')[0] : ''
  return `<!doctype html><html><body style="margin:0;background:#0e1633;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:560px;margin:0 auto">
    <div style="background:#8c8cf2;padding:22px;text-align:center">
      <span style="font-size:24px;font-weight:800;color:#0e1633;letter-spacing:1px">VIVA SORTE+</span>
    </div>
    <div style="background:#2c2f3a;color:#ffffff;padding:28px 26px">
      <h1 style="font-size:22px;margin:0 0 16px">Olá, ${primeiro || 'cliente'}</h1>
      <p style="font-size:15px;line-height:1.5;margin:0 0 18px;color:#e6e8f2">
        O pagamento do seu pedido feito em <strong>${quando}</strong> no valor de <strong>${valor}</strong> ${frase} ${emoji}
      </p>
      <p style="font-size:15px;line-height:1.7;margin:0 0 22px;color:#e6e8f2">
        Cliente: <strong>${nome || '—'}</strong><br>
        CPF: <strong>${maskCpfStr(cpf) || '—'}</strong><br>
        Pedido nº: <strong>${numero}</strong>
      </p>
      <a href="${SITE_URL}/usuario/meus-pedidos" style="display:inline-block;background:#8c8cf2;color:#0e1633;text-decoration:none;padding:13px 26px;border-radius:999px;font-weight:800;font-size:15px">Acessar meu pedido</a>
    </div>
    <div style="background:#e9eaf0;color:#444;padding:22px 26px;font-size:12px;line-height:1.6">
      <p style="margin:0 0 14px">Esse e-mail não é monitorado, em caso de dúvida fale conosco através do nosso site: <a href="${SITE_URL}/contato" style="color:#5b6bd6">${SITE_URL}/contato</a></p>
      <p style="margin:0 0 8px">© ${new Date().getFullYear()} Viva Sorte - Todos os direitos reservados</p>
      <p style="margin:0;color:#7a7f93">Sorteios lastreados por Títulos de Capitalização emitidos pela VIA Capitalização SA, inscritos no CNPJ sob nº 88.076.302/0001-94, e aprovados pela SUSEP.</p>
    </div>
  </div></body></html>`
}

/**
 * Envia o e-mail transacional do pedido (status: 'pendente' | 'aprovado' | 'cancelado'),
 * no mesmo formato dos e-mails do Viva Sorte. Pega nome/cpf/e-mail do snapshot do
 * pedido (pagador) e, se faltar e-mail, do profiles. NÃO bloqueia / não lança.
 */
export async function enviarEmailPedido(pedido, status) {
  try {
    const cfg = STATUS_EMAIL[status]
    if (!cfg || !pedido) return { ok: false, skipped: 'status-invalido' }
    if (pedido.metodo === 'deposito') return { ok: false, skipped: 'deposito' } // depósito de carteira não notifica

    const key = process.env.RESEND_API_KEY || (await configDoBanco('resend_api_key'))
    if (!key) return { ok: false, skipped: 'sem-key' }
    const from = process.env.EMAIL_FROM || (await configDoBanco('email_remetente')) || 'Viva Sorte+ <onboarding@resend.dev>'

    const pag = pedido.pagador || {}
    let email = pag.email || ''
    let nome = pag.nome || ''
    const cpf = pag.cpf || ''
    // Sem e-mail no snapshot → busca no profiles.
    if (!email && pedido.user_id) {
      const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
      const srk = process.env.SUPABASE_SERVICE_ROLE_KEY
      if (url && srk) {
        const r = await fetch(`${url}/rest/v1/profiles?id=eq.${encodeURIComponent(pedido.user_id)}&select=email,nome,cpf`, {
          headers: { apikey: srk, Authorization: `Bearer ${srk}` },
        })
        const p = (await r.json().catch(() => []))?.[0]
        email = email || p?.email || ''
        nome = nome || p?.nome || ''
      }
    }
    if (!email) return { ok: false, skipped: 'sem-email' }

    const valor = 'R$ ' + Number(pedido.total || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })
    const numero = String(pedido.id || '').slice(0, 8).toUpperCase()

    const r = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [email],
        subject: `Pedido ${numero} ${cfg.rotulo}`,
        html: emailPedidoHtml({ nome, cpf, numero, valor, quando: dataHora(pedido.created_at), frase: cfg.frase, emoji: cfg.emoji }),
      }),
    })
    if (!r.ok) return { ok: false, status: r.status, error: await r.text().catch(() => '') }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e?.message || String(e) }
  }
}

/**
 * Envia o e-mail de "você ganhou" para o cliente do pedido (busca e-mail/nome no
 * perfil). NÃO bloqueia / não lança. Retorna { ok, skipped?/error? }.
 */
export async function enviarEmailGanhador(pedido) {
  try {
    if (!pedido?.user_id) return { ok: false, skipped: 'sem-pedido' }
    const key = process.env.RESEND_API_KEY || (await configDoBanco('resend_api_key'))
    if (!key) return { ok: false, skipped: 'sem-key' }
    const from = process.env.EMAIL_FROM || (await configDoBanco('email_remetente')) || 'Viva Sorte+ <onboarding@resend.dev>'

    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
    const srk = process.env.SUPABASE_SERVICE_ROLE_KEY
    let email = '', nome = ''
    if (url && srk) {
      const r = await fetch(`${url}/rest/v1/profiles?id=eq.${encodeURIComponent(pedido.user_id)}&select=email,nome`, {
        headers: { apikey: srk, Authorization: `Bearer ${srk}` },
      })
      const rows = await r.json().catch(() => [])
      const p = Array.isArray(rows) ? rows[0] : null
      email = p?.email || ''
      nome = p?.nome || ''
    }
    if (!email) return { ok: false, skipped: 'sem-email' }

    let grupo = (await configDoBanco('whatsapp_grupo_ganhadores')).trim()
    if (grupo && !/^https?:\/\//i.test(grupo)) grupo = 'https://' + grupo

    const r = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [email],
        subject: '🎉 Parabéns! Você foi sorteado(a) no Viva Sorte+',
        html: emailGanhadorHtml(nome, grupo),
      }),
    })
    if (!r.ok) return { ok: false, status: r.status, error: await r.text().catch(() => '') }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e?.message || String(e) }
  }
}

// ── E-mail de BOAS-VINDAS (cadastro feito) ─────────────────────────────────────
const SITE_VS = (process.env.SITE_URL || 'https://sortepremios.club').replace(/\/$/, '')

function emailBoasVindasHtml(nome) {
  const primeiro = nome ? String(nome).split(' ')[0] : ''
  return `<!doctype html><html><body style="margin:0;background:#0e1633;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:560px;margin:0 auto">
    <div style="background:#1e3fcf;padding:22px;text-align:center">
      <span style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:1px">VIVENDO SORTEIOS</span>
    </div>
    <div style="background:#2c2f3a;color:#ffffff;padding:30px 26px;text-align:center">
      <div style="font-size:38px">🍀</div>
      <h1 style="font-size:23px;margin:8px 0 10px">Cadastro feito${primeiro ? ', ' + primeiro : ''}!</h1>
      <p style="font-size:15px;line-height:1.6;color:#e6e8f2;margin:0 0 20px">
        Seja bem-vindo(a) ao <strong>Vivendo Sorteios</strong>! Sua conta já está pronta. 🎉<br>
        Agora é só escolher seus números da sorte e concorrer aos prêmios.
      </p>
      <a href="${SITE_VS}" style="display:inline-block;background:#1e9e4a;color:#ffffff;text-decoration:none;padding:13px 28px;border-radius:999px;font-weight:800;font-size:15px">Começar agora</a>
    </div>
    <div style="background:#e9eaf0;color:#444;padding:22px 26px;font-size:12px;line-height:1.6">
      <p style="margin:0 0 10px">Você recebeu este e-mail porque criou uma conta no Vivendo Sorteios. Dúvidas? Fale conosco pelo site: <a href="${SITE_VS}/contato" style="color:#1e3fcf">${SITE_VS}/contato</a></p>
      <p style="margin:0 0 8px;color:#b03636"><strong>Segurança:</strong> nunca pedimos senha, PIX ou taxa adiantada para liberar prêmios. Desconfie de quem pedir.</p>
      <p style="margin:0;color:#7a7f93">© ${new Date().getFullYear()} Vivendo Sorteios — Todos os direitos reservados.</p>
    </div>
  </div></body></html>`
}

/**
 * Envia o e-mail de "cadastro feito / boas-vindas". Busca e-mail/nome no profiles
 * pelo userId (ou usa os passados). NÃO bloqueia / não lança. Só envia se o Resend
 * estiver configurado (chave + remetente).
 */
export async function enviarEmailBoasVindas({ userId, email, nome } = {}) {
  try {
    const key = process.env.RESEND_API_KEY || (await configDoBanco('resend_api_key'))
    if (!key) return { ok: false, skipped: 'sem-key' }
    const from = process.env.EMAIL_FROM || (await configDoBanco('email_remetente')) || 'Vivendo Sorteios <onboarding@resend.dev>'

    if ((!email || !nome) && userId) {
      const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
      const srk = process.env.SUPABASE_SERVICE_ROLE_KEY
      if (url && srk) {
        const r = await fetch(`${url}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=email,nome`, {
          headers: { apikey: srk, Authorization: `Bearer ${srk}` },
        })
        const p = (await r.json().catch(() => []))?.[0]
        email = email || p?.email || ''
        nome = nome || p?.nome || ''
      }
    }
    if (!email) return { ok: false, skipped: 'sem-email' }

    const r = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [email],
        subject: 'Bem-vindo(a) ao Vivendo Sorteios! 🍀',
        html: emailBoasVindasHtml(nome),
      }),
    })
    if (!r.ok) return { ok: false, status: r.status, error: await r.text().catch(() => '') }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e?.message || String(e) }
  }
}
