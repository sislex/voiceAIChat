import { describe, expect, it, vi } from 'vitest'
import { createServer, type Socket } from 'node:net'
import { loadConfig } from '../config.js'
import { createMailer, sendSmtp } from './mailer.js'

/** Фейковый SMTP без TLS: отвечает по протоколу и записывает DATA. */
function fakeSmtp(): Promise<{ port: number; received: string[]; close(): void }> {
  const received: string[] = []
  return new Promise((resolve) => {
    const server = createServer((sock: Socket) => {
      let data = false, buf = ''
      sock.write('220 fake ESMTP\r\n')
      sock.on('data', (chunk) => {
        buf += chunk.toString('utf8')
        let idx: number
        while ((idx = buf.indexOf('\r\n')) >= 0) {
          const line = buf.slice(0, idx); buf = buf.slice(idx + 2)
          if (data) { if (line === '.') { data = false; sock.write('250 OK queued\r\n') } else received.push(line); continue }
          const command = line.split(' ')[0]!.toUpperCase()
          if (command === 'EHLO') sock.write('250-fake\r\n250 AUTH PLAIN LOGIN\r\n')
          else if (command === 'AUTH') sock.write(line.includes('PLAIN') ? '235 ok\r\n' : '334 VXNlcm5hbWU6\r\n')
          else if (command === 'MAIL' || command === 'RCPT') sock.write('250 OK\r\n')
          else if (command === 'DATA') { data = true; sock.write('354 go\r\n') }
          else if (command === 'QUIT') { sock.write('221 bye\r\n'); sock.end() }
          else sock.write('250 OK\r\n')
        }
      })
    })
    server.listen(0, '127.0.0.1', () => resolve({ port: (server.address() as { port: number }).port, received, close: () => server.close() }))
  })
}

const ok = (): Response => new Response(JSON.stringify({ messageId: 'provider-id' }), { status: 201, headers: { 'content-type': 'application/json' } })

describe('mailer', () => {
  // @testCase TC-01
  it('выбирает transport явно и по fallback HTTP → SMTP → console, а неверную конфигурацию отклоняет', () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => ok())
    const log = vi.fn()
    expect(createMailer({ mailApiKey: 'key', mailFrom: 'a@b.co', smtpUrl: 'smtp://host', fetch }, log).configured).toBe(true)
    expect(createMailer({ smtpUrl: 'smtp://host' }, log).configured).toBe(true)
    expect(createMailer({}, log).configured).toBe(false)
    expect(createMailer({ mailTransport: 'http', mailApiKey: 'key', mailFrom: 'a@b.co', fetch }, log).configured).toBe(true)
    expect(createMailer({ mailTransport: 'smtp', smtpUrl: 'smtp://host' }, log).configured).toBe(true)
    expect(() => createMailer({ mailTransport: 'http', smtpUrl: 'smtp://host' }, log)).toThrow('VC_MAIL_API_KEY')
    expect(() => createMailer({ mailTransport: 'smtp', mailApiKey: 'key' }, log)).toThrow('VC_SMTP_URL')
    expect(() => createMailer({ mailTransport: 'other' }, log)).toThrow('http или smtp')
    expect(loadConfig({ VC_MAIL_API_KEY: 'key' })).toMatchObject({
      mailTransport: null,
      mailApiKey: 'key',
      mailApiUrl: 'https://api.brevo.com/v3/smtp/email'
    })
    expect(loadConfig({ VC_MAIL_TRANSPORT: 'http', VC_MAIL_API_URL: 'https://mail.test/send' })).toMatchObject({
      mailTransport: 'http',
      mailApiUrl: 'https://mail.test/send'
    })
    expect(() => loadConfig({ VC_MAIL_TRANSPORT: 'console' })).toThrow('http или smtp')
  })

  // @testCase TC-02
  it('отправляет Brevo-запрос с api-key, sender и нормализованным to', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => ok())
    const mailer = createMailer({ mailTransport: 'http', mailApiKey: 'secret-key', mailApiUrl: 'https://mail.test/send', mailFrom: 'ChatAI <Verified@Example.com>', fetch }, vi.fn())
    await mailer.send({ to: ' Nina@Example.com ', subject: 'Привет', text: 'text', html: '<b>html</b>' })
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe('https://mail.test/send')
    expect(init).toMatchObject({ method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': 'secret-key' } })
    expect(JSON.parse(String(init?.body))).toEqual({
      sender: { name: 'ChatAI', email: 'verified@example.com' },
      to: [{ email: 'nina@example.com' }],
      subject: 'Привет',
      textContent: 'text',
      htmlContent: '<b>html</b>'
    })
  })

  // @testCase TC-03
  it('не добавляет htmlContent для plain-text письма', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => ok())
    const mailer = createMailer({ mailApiKey: 'key', mailFrom: 'a@b.co', fetch }, vi.fn())
    await mailer.send({ to: 'c@d.co', subject: 's', text: 'plain' })
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body))).not.toHaveProperty('htmlContent')
  })

  // @testCase TC-04
  it('не повторяет 4xx и не раскрывает чувствительные значения в ошибке или логе', async () => {
    const email = 'private.person@example.com', token = 'verification-token-unique', key = 'api-key-unique'
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify({ code: 'unauthorized', message: `${email} ${token} ${key}` }), { status: 401 }))
    const logs: string[] = []
    const mailer = createMailer({ mailApiKey: key, mailFrom: 'sender@example.com', fetch }, (message, extra) => logs.push(`${message} ${JSON.stringify(extra)}`))
    const error = await mailer.send({ to: email, subject: token, text: `body ${token}` }).catch((value: unknown) => value as Error)
    expect(fetch).toHaveBeenCalledTimes(1)
    const output = `${(error as Error).message} ${logs.join(' ')}`
    expect(output).toContain('401')
    for (const secret of [email, token, key, `body ${token}`]) expect(output).not.toContain(secret)
  })

  // @testCase TC-05
  it.each([[429, 201], [500, 201], [503, 503]])('повторяет %i ровно один раз', async (first, second) => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response('{}', { status: first }))
      .mockResolvedValueOnce(second === 201 ? ok() : new Response('{}', { status: second }))
    const mailer = createMailer({ mailApiKey: 'key', mailFrom: 'a@b.co', fetch }, vi.fn())
    const sent = mailer.send({ to: 'c@d.co', subject: 's', text: 't' })
    if (second === 201) await expect(sent).resolves.toBeUndefined()
    else await expect(sent).rejects.toThrow('503')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  // @testCase TC-06
  it('прерывает HTTP-запрос по таймауту безопасной ошибкой', async () => {
    vi.useFakeTimers()
    try {
      const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      }))
      const mailer = createMailer({ mailApiKey: 'timeout-key', mailFrom: 'a@b.co', fetch, httpTimeoutMs: 20_000 }, vi.fn())
      const sent = mailer.send({ to: 'private@example.com', subject: 'token', text: 'secret body' })
      const rejection = expect(sent).rejects.toThrow('timed out')
      await vi.advanceTimersByTimeAsync(20_000)
      await rejection
      expect(fetch.mock.calls[0]![1]?.signal?.aborted).toBe(true)
    } finally { vi.useRealTimers() }
  })

  // @testCase TC-07
  it('sendSmtp проходит EHLO/AUTH PLAIN/MAIL/RCPT/DATA и отправляет письмо', async () => {
    const srv = await fakeSmtp()
    try {
      await sendSmtp({ url: `smtp://user:secret@127.0.0.1:${srv.port}`, from: 'ChatAI <no-reply@test>' }, { to: 'nina@example.com', subject: 'Привет', text: 'Ссылка: http://x/#/verify/abc' })
      const raw = srv.received.join('\n')
      expect(raw).toContain('From: ChatAI <no-reply@test>')
      expect(raw).toContain('To: nina@example.com')
      expect(raw).toContain(Buffer.from('Ссылка: http://x/#/verify/abc').toString('base64'))
    } finally { srv.close() }
  })
})
