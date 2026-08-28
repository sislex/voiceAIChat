// Отправка писем (регистрация с подтверждением email). Минимальный SMTP-клиент без зависимостей:
// smtps:// — TLS сразу, smtp:// — STARTTLS при поддержке; AUTH PLAIN/LOGIN. Без VC_SMTP_URL письма
// не отправляются, а ссылка подтверждения пишется в лог сервера — так регистрацию можно проверить на стенде.
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

/** Мейлер из окружения: SMTP при VC_SMTP_URL, иначе «консольный» — пишет письмо в лог и ничего не шлёт. */
export function createMailer(cfg: { smtpUrl?: string | null; mailFrom?: string | null }, log: (msg: string, extra?: Record<string, unknown>) => void): Mailer {
  if (cfg.smtpUrl) {
    const from = cfg.mailFrom || 'ChatAI <no-reply@localhost>'
    return { configured: true, send: (msg) => sendSmtp({ url: cfg.smtpUrl!, from }, msg) }
  }
  // Дублируем в stdout: логгер Fastify на стенде может быть отключён или на уровне выше warn, а ссылку подтверждения надо где-то увидеть.
  return { configured: false, send: async (msg) => { log('mail (SMTP не настроен, письмо не отправлено)', { to: msg.to, subject: msg.subject, text: msg.text }); console.warn(`[mail] SMTP не настроен — письмо для ${msg.to}: ${msg.subject}\n${msg.text}`) } }
}
