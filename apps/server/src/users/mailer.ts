// Отправка писем (регистрация с подтверждением email): Brevo через HTTPS либо минимальный
// SMTP-клиент без зависимостей (smtps:// — TLS сразу, smtp:// — STARTTLS; AUTH PLAIN/LOGIN).
// Без настроенного транспорта ссылка подтверждения пишется в лог для проверки стенда.
import { connect as tlsConnect, type TLSSocket } from 'node:tls'
import { connect as netConnect, type Socket } from 'node:net'

export interface MailMessage { to: string; subject: string; text: string; html?: string }
export type Mailer = { send(msg: MailMessage): Promise<void>; readonly configured: boolean }

export interface SmtpConfig { url: string; from: string }

function readReply(sock: Socket): Promise<{ code: number; text: string }> {
  return new Promise((resolve, reject) => {
    let buf = ''
    const onData = (chunk: Buffer): void => {
      buf += chunk.toString('utf8')
      const lines = buf.split(/\r?\n/).filter(Boolean)
      const last = lines[lines.length - 1]
      // Многострочный ответ: строки вида "250-..." продолжаются, "250 ..." — финальная.
      if (last && /^\d{3} /.test(last)) { cleanup(); resolve({ code: Number(last.slice(0, 3)), text: buf }) }
    }
    const onErr = (e: Error): void => { cleanup(); reject(e) }
    const cleanup = (): void => { sock.off('data', onData); sock.off('error', onErr) }
    sock.on('data', onData); sock.on('error', onErr)
  })
}

async function cmd(sock: Socket, line: string, ok: number[]): Promise<string> {
  const p = readReply(sock)
  sock.write(line + '\r\n')
  const r = await p
  if (!ok.includes(r.code)) throw new Error(`SMTP ${line.split(' ')[0]}: ${r.text.trim().slice(0, 200)}`)
  return r.text
}

/** Письмо одним SMTP-сеансом; таймаут 20 с на всё. */
export async function sendSmtp(cfg: SmtpConfig, msg: MailMessage): Promise<void> {
  const u = new URL(cfg.url)
  const secure = u.protocol === 'smtps:'
  const host = u.hostname, port = Number(u.port || (secure ? 465 : 587))
  const user = decodeURIComponent(u.username), pass = decodeURIComponent(u.password)
  let sock: Socket = secure ? tlsConnect({ host, port, servername: host }) : netConnect({ host, port })
  const timer = setTimeout(() => sock.destroy(new Error('SMTP timeout')), 20_000)
  try {
    await new Promise<void>((res, rej) => { sock.once(secure ? 'secureConnect' : 'connect', () => res()); sock.once('error', rej) })
    const greet = await readReply(sock)
    if (greet.code !== 220) throw new Error(`SMTP greeting: ${greet.text.trim()}`)
    let ehlo = await cmd(sock, `EHLO chatai.local`, [250])
    if (!secure && /STARTTLS/i.test(ehlo)) {
      await cmd(sock, 'STARTTLS', [220])
      sock = await new Promise<TLSSocket>((res, rej) => { const t = tlsConnect({ socket: sock, servername: host }, () => res(t)); t.once('error', rej) })
      ehlo = await cmd(sock, `EHLO chatai.local`, [250])
    }
    if (user) {
      if (/AUTH[^\n]*PLAIN/i.test(ehlo)) await cmd(sock, `AUTH PLAIN ${Buffer.from(`\0${user}\0${pass}`).toString('base64')}`, [235])
      else { await cmd(sock, 'AUTH LOGIN', [334]); await cmd(sock, Buffer.from(user).toString('base64'), [334]); await cmd(sock, Buffer.from(pass).toString('base64'), [235]) }
    }
    const fromAddr = /<([^>]+)>/.exec(cfg.from)?.[1] ?? cfg.from
    await cmd(sock, `MAIL FROM:<${fromAddr}>`, [250])
    await cmd(sock, `RCPT TO:<${msg.to}>`, [250, 251])
    await cmd(sock, 'DATA', [354])
    const boundary = `b${Date.now().toString(36)}`
    const body = msg.html
      ? [`Content-Type: multipart/alternative; boundary="${boundary}"`, '', `--${boundary}`, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', Buffer.from(msg.text).toString('base64'), `--${boundary}`, 'Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: base64', '', Buffer.from(msg.html).toString('base64'), `--${boundary}--`].join('\r\n')
      : ['Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', Buffer.from(msg.text).toString('base64')].join('\r\n')
    const headers = [`From: ${cfg.from}`, `To: ${msg.to}`, `Subject: =?UTF-8?B?${Buffer.from(msg.subject).toString('base64')}?=`, `Date: ${new Date().toUTCString()}`, `Message-ID: <${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}@chatai>`, 'MIME-Version: 1.0']
    const data = (headers.join('\r\n') + '\r\n' + body).replace(/\r?\n\./g, '\r\n..')
    await cmd(sock, data + '\r\n.', [250])
    await cmd(sock, 'QUIT', [221]).catch(() => undefined)
  } finally { clearTimeout(timer); sock.end(); sock.destroy() }
}

export interface HttpMailConfig {
  apiKey: string
  apiUrl: string
  from: string
  fetch?: typeof fetch
  timeoutMs?: number
  log?: (msg: string, extra?: Record<string, unknown>) => void
}

function parseMailbox(value: string): { email: string; name?: string } {
  const match = /^\s*(?:(.*?)\s*)?<([^<>\s@]+@[^<>\s@]+)>\s*$/.exec(value)
  const email = (match?.[2] ?? value.trim()).toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Некорректная конфигурация отправителя почты')
  const name = match?.[1]?.trim().replace(/^["']|["']$/g, '')
  return name ? { email, name } : { email }
}

function safeProviderCode(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-z0-9_.-]{1,64}$/i.test(value) ? value : undefined
}

/** Отправляет письмо через Brevo Transactional Email API. */
export async function sendHttp(cfg: HttpMailConfig, msg: MailMessage): Promise<void> {
  const sender = parseMailbox(cfg.from)
  const recipient = msg.to.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) throw new Error('Некорректный адрес получателя')
  const body: Record<string, unknown> = {
    sender,
    to: [{ email: recipient }],
    subject: msg.subject,
    textContent: msg.text
  }
  if (msg.html !== undefined) body.htmlContent = msg.html

  const request = cfg.fetch ?? globalThis.fetch
  for (let attempt = 1; attempt <= 2; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs ?? 20_000)
    let response: Response
    try {
      response = await request(cfg.apiUrl, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': cfg.apiKey },
        body: JSON.stringify(body),
        signal: controller.signal
      })
    } catch (error) {
      const timeout = controller.signal.aborted
      cfg.log?.('mail http request failed', { method: 'POST', reason: timeout ? 'timeout' : 'network' })
      throw new Error(timeout ? 'HTTP mail delivery timed out' : 'HTTP mail delivery failed')
    } finally {
      clearTimeout(timer)
    }

    let payload: unknown
    try { payload = await response.json() } catch { payload = null }
    const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    if (response.status === 201 && typeof record.messageId === 'string' && record.messageId) return

    const retryable = response.status === 429 || response.status >= 500
    if (retryable && attempt === 1) continue
    cfg.log?.('mail http provider rejected request', {
      method: 'POST',
      status: response.status,
      code: safeProviderCode(record.code)
    })
    throw new Error(response.status === 201 ? 'HTTP mail provider returned an invalid response' : `HTTP mail delivery failed (${response.status})`)
  }
}

export interface MailerConfig {
  mailTransport?: string | null
  mailApiKey?: string | null
  mailApiUrl?: string | null
  smtpUrl?: string | null
  mailFrom?: string | null
  fetch?: typeof fetch
  httpTimeoutMs?: number
}

/** Мейлер из окружения: явный transport либо совместимый приоритет HTTP → SMTP → console. */
export function createMailer(cfg: MailerConfig, log: (msg: string, extra?: Record<string, unknown>) => void): Mailer {
  if (cfg.mailTransport && cfg.mailTransport !== 'http' && cfg.mailTransport !== 'smtp') {
    throw new Error('VC_MAIL_TRANSPORT должен быть http или smtp')
  }
  const transport = cfg.mailTransport ?? (cfg.mailApiKey ? 'http' : cfg.smtpUrl ? 'smtp' : 'console')
  if (transport === 'http') {
    if (!cfg.mailApiKey) throw new Error('Для HTTP mail transport требуется VC_MAIL_API_KEY')
    if (!cfg.mailFrom) throw new Error('Для HTTP mail transport требуется VC_MAIL_FROM')
    parseMailbox(cfg.mailFrom)
    const httpCfg: HttpMailConfig = {
      apiKey: cfg.mailApiKey,
      apiUrl: cfg.mailApiUrl || 'https://api.brevo.com/v3/smtp/email',
      from: cfg.mailFrom,
      log,
      ...(cfg.fetch ? { fetch: cfg.fetch } : {}),
      ...(cfg.httpTimeoutMs !== undefined ? { timeoutMs: cfg.httpTimeoutMs } : {})
    }
    return { configured: true, send: (msg) => sendHttp(httpCfg, msg) }
  }
  if (transport === 'smtp') {
    if (!cfg.smtpUrl) throw new Error('Для SMTP mail transport требуется VC_SMTP_URL')
    const from = cfg.mailFrom || 'ChatAI <no-reply@localhost>'
    return { configured: true, send: (msg) => sendSmtp({ url: cfg.smtpUrl!, from }, msg) }
  }
  // Дублируем в stdout: на стенде verification-ссылка должна оставаться доступной.
  return { configured: false, send: async (msg) => { log('mail (транспорт не настроен, письмо не отправлено)', { to: msg.to, subject: msg.subject, text: msg.text }); console.warn(`[mail] транспорт не настроен — письмо для ${msg.to}: ${msg.subject}\n${msg.text}`) } }
}
