import { describe, expect, it } from 'vitest'
import { createServer, type Socket } from 'node:net'
import { createMailer, sendSmtp } from './mailer'

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
          const cmd = line.split(' ')[0]!.toUpperCase()
          if (cmd === 'EHLO') sock.write('250-fake\r\n250 AUTH PLAIN LOGIN\r\n')
          else if (cmd === 'AUTH') sock.write(line.includes('PLAIN') ? '235 ok\r\n' : '334 VXNlcm5hbWU6\r\n')
          else if (cmd === 'MAIL' || cmd === 'RCPT') sock.write('250 OK\r\n')
          else if (cmd === 'DATA') { data = true; sock.write('354 go\r\n') }
          else if (cmd === 'QUIT') { sock.write('221 bye\r\n'); sock.end() }
          else sock.write('250 OK\r\n')
        }
      })
    })
    server.listen(0, '127.0.0.1', () => resolve({ port: (server.address() as { port: number }).port, received, close: () => server.close() }))
  })
}

describe('mailer', () => {
  it('sendSmtp проходит EHLO/AUTH PLAIN/MAIL/RCPT/DATA и отправляет заголовки с base64-телом', async () => {
    const srv = await fakeSmtp()
    try {
      await sendSmtp({ url: `smtp://user:secret@127.0.0.1:${srv.port}`, from: 'ChatAI <no-reply@test>' }, { to: 'nina@example.com', subject: 'Привет', text: 'Ссылка: http://x/#/verify/abc' })
      const raw = srv.received.join('\n')
      expect(raw).toContain('From: ChatAI <no-reply@test>')
      expect(raw).toContain('To: nina@example.com')
      expect(raw).toContain(`Subject: =?UTF-8?B?${Buffer.from('Привет').toString('base64')}?=`)
      expect(raw).toContain(Buffer.from('Ссылка: http://x/#/verify/abc').toString('base64'))
    } finally { srv.close() }
  })
  it('без VC_SMTP_URL мейлер «консольный»: не настроен, пишет письмо в лог', async () => {
    const logs: string[] = []
    const m = createMailer({}, (msg, extra) => logs.push(`${msg} ${JSON.stringify(extra)}`))
    expect(m.configured).toBe(false)
    await m.send({ to: 'a@b.co', subject: 's', text: 't' })
    expect(logs[0]).toContain('a@b.co')
  })
})
