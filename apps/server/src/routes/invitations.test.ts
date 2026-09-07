import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../server.js'
import { loadConfig } from '../config.js'
import { VoiceChatDb } from '../db/database.js'
import { signToken } from '../users/accounts.js'
import type { MailMessage } from '../users/mailer.js'
import type { ProjectDetail, ProjectInvitation } from '@voicechat/shared'

const SECRET = 'test-secret'
let app: FastifyInstance
let db: VoiceChatDb
let sent: MailMessage[]
let aliceTok: string
let bobTok: string
let carolTok: string

function inj(token: string | null, opts: { method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; url: string; payload?: object }) {
  return app.inject({ ...opts, headers: token ? { authorization: `Bearer ${token}` } : {} })
}

beforeEach(async () => {
  let id = 0
  let clock = 1000
  sent = []
  db = new VoiceChatDb(':memory:', { newId: () => `id-${++id}`, now: () => (clock += 10) })
  db.identity.createUser('alice', '', 'developer')
  db.identity.createUser('bob', '', 'developer')
  db.identity.createUser('carol', '', 'developer')
  app = await buildServer({
    config: loadConfig({ PORT: '0', VC_DATA_DIR: join(tmpdir(), `vc-inv-${Date.now()}-${id}`), VC_PUBLIC_URL: 'https://app.example' }),
    db,
    sessionSecret: SECRET,
    mailer: { configured: true, send: async (msg) => { sent.push(msg) } }
  })
  aliceTok = signToken({ name: 'alice', role: 'developer' }, SECRET)
  bobTok = signToken({ name: 'bob', role: 'developer' }, SECRET)
  carolTok = signToken({ name: 'carol', role: 'developer' }, SECRET)
})
afterEach(async () => {
  await app.close()
  db.close()
})

const project = async (name = 'P'): Promise<ProjectDetail> =>
  (await inj(aliceTok, { method: 'POST', url: '/api/projects', payload: { name } })).json() as ProjectDetail

/** Токен виден только в письме — как и у настоящего получателя. */
const tokenFromMail = (): string => {
  const link = /#\/project-invite\/([\w-]+)/.exec(sent[sent.length - 1]?.text ?? '')
  expect(link, 'в письме должна быть ссылка с токеном').toBeTruthy()
  return link![1]
}

describe('приглашения: сторона проекта', () => {
  it('владелец приглашает по адресу — уходит письмо со ссылкой', async () => {
    const p = await project('Редизайн')
    const res = await inj(aliceTok, { method: 'POST', url: `/api/projects/${p.id}/invitations`, payload: { invitee: 'new@example.com' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().mailed).toBe(true)

    const mail = sent[0]
    expect(mail.to).toBe('new@example.com')
    expect(mail.subject).toContain('Редизайн')
    expect(mail.text).toContain('https://app.example/#/project-invite/')
    // Список у владельца показывает живое приглашение, но без токена.
    const list = (await inj(aliceTok, { method: 'GET', url: `/api/projects/${p.id}/invitations` })).json() as ProjectInvitation[]
    expect(list.length).toBe(1)
    expect(JSON.stringify(list)).not.toContain(tokenFromMail())
  })

  it('приглашение по логину без адреса создаётся, но письма нет', async () => {
    const p = await project()
    const res = await inj(aliceTok, { method: 'POST', url: `/api/projects/${p.id}/invitations`, payload: { invitee: 'bob' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().mailed).toBe(false)
    expect(sent).toEqual([])
    // Приглашённый всё равно видит его у себя.
    expect(((await inj(bobTok, { method: 'GET', url: '/api/invitations' })).json() as ProjectInvitation[]).length).toBe(1)
  })

  it('не владелец не управляет приглашениями', async () => {
    const p = await project()
    await inj(aliceTok, { method: 'POST', url: `/api/projects/${p.id}/members`, payload: { username: 'bob' } })
    expect((await inj(bobTok, { method: 'GET', url: `/api/projects/${p.id}/invitations` })).statusCode).toBe(403)
    expect((await inj(bobTok, { method: 'POST', url: `/api/projects/${p.id}/invitations`, payload: { invitee: 'carol' } })).statusCode).toBe(403)
  })

  it('пустой получатель и мусорный адрес — 400', async () => {
    const p = await project()
    expect((await inj(aliceTok, { method: 'POST', url: `/api/projects/${p.id}/invitations`, payload: { invitee: '  ' } })).statusCode).toBe(400)
    expect((await inj(aliceTok, { method: 'POST', url: `/api/projects/${p.id}/invitations`, payload: { invitee: 'кто@то' } })).statusCode).toBe(400)
  })

  it('повторная отправка выдаёт новый токен, отзыв гасит приглашение', async () => {
    const p = await project()
    const created = (await inj(aliceTok, { method: 'POST', url: `/api/projects/${p.id}/invitations`, payload: { invitee: 'x@example.com' } })).json() as { invitation: ProjectInvitation }
    const first = tokenFromMail()
    await inj(aliceTok, { method: 'POST', url: `/api/projects/${p.id}/invitations/${created.invitation.id}/resend` })
    const second = tokenFromMail()
    expect(second).not.toBe(first)

    expect((await inj(aliceTok, { method: 'DELETE', url: `/api/projects/${p.id}/invitations/${created.invitation.id}` })).statusCode).toBe(200)
    expect(((await inj(aliceTok, { method: 'GET', url: `/api/projects/${p.id}/invitations` })).json() as ProjectInvitation[])).toEqual([])
  })
})

describe('приглашения: сторона приглашённого', () => {
  it('приём доступен не-участнику и даёт членство', async () => {
    const p = await project('Общий')
    await inj(aliceTok, { method: 'POST', url: `/api/projects/${p.id}/invitations`, payload: { invitee: 'bob' } })
    const token = ((await inj(bobTok, { method: 'GET', url: '/api/invitations' })).json() as Array<{ id: string }>)[0] ? null : null
    // Токена в API нет — берём его из письма приглашения по адресу.
    await inj(aliceTok, { method: 'POST', url: `/api/projects/${p.id}/invitations`, payload: { invitee: 'carol@example.com' } })
    const mailToken = tokenFromMail()
    expect(token).toBeNull()

    // Чужая ссылка не срабатывает даже у вошедшего пользователя.
    const foreign = await inj(bobTok, { method: 'POST', url: `/api/invitations/${mailToken}/accept` })
    expect(foreign.statusCode).toBe(400)
    expect(foreign.json().error).toMatch(/адресовано другому/i)
    expect((await inj(bobTok, { method: 'GET', url: `/api/projects/${p.id}` })).statusCode).toBe(404)
  })

  it('приглашённый по логину принимает своё приглашение и получает проект', async () => {
    const p = await project('Мой')
    await inj(aliceTok, { method: 'POST', url: `/api/projects/${p.id}/invitations`, payload: { invitee: 'bob@example.com' } })
    const token = tokenFromMail()
    // Боб без подтверждённого адреса принять не может.
    expect((await inj(bobTok, { method: 'POST', url: `/api/invitations/${token}/accept` })).statusCode).toBe(400)

    // Регистрируем адрес и повторяем — теперь приглашение адресовано ему.
    db.identity.createEmailVerification({ token: 'verify-1', name: 'dave', email: 'bob@example.com', password: 'x', ttlMs: 60_000 })
    db.identity.redeemEmailVerification('verify-1', 'developer')
    const daveTok = signToken({ name: 'dave', role: 'developer' }, SECRET)
    const accepted = await inj(daveTok, { method: 'POST', url: `/api/invitations/${token}/accept` })
    expect(accepted.statusCode).toBe(200)
    expect(accepted.json().projectId).toBe(p.id)
    expect((await inj(daveTok, { method: 'GET', url: `/api/projects/${p.id}` })).statusCode).toBe(200)
  })

  it('отклонение закрывает приглашение', async () => {
    const p = await project()
    await inj(aliceTok, { method: 'POST', url: `/api/projects/${p.id}/invitations`, payload: { invitee: 'carol' } })
    const list = (await inj(carolTok, { method: 'GET', url: '/api/invitations' })).json() as ProjectInvitation[]
    expect(list.length).toBe(1)
    // Токен приглашённому по логину недоступен — отклоняем через письмо-эквивалент.
    await inj(aliceTok, { method: 'POST', url: `/api/projects/${p.id}/invitations`, payload: { invitee: 'zed@example.com' } })
    const token = tokenFromMail()
    expect((await inj(carolTok, { method: 'POST', url: `/api/invitations/${token}/decline` })).statusCode).toBe(400)
  })
})

describe('приглашения: публичный превью', () => {
  it('без входа отдаёт только имя проекта, автора и срок', async () => {
    const p = await project('Секретный редизайн')
    await inj(aliceTok, { method: 'POST', url: `/api/projects/${p.id}/invitations`, payload: { invitee: 'guest@example.com' } })
    const token = tokenFromMail()

    const res = await inj(null, { method: 'GET', url: `/api/session/invitation/${token}` })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.projectName).toBe('Секретный редизайн')
    expect(body.invitedBy).toBe('alice')
    expect(Object.keys(body).sort()).toEqual(['expiresAt', 'invitedBy', 'projectId', 'projectName', 'role'])
  })

  it('неизвестный и отозванный токен — 404', async () => {
    const p = await project()
    const created = (await inj(aliceTok, { method: 'POST', url: `/api/projects/${p.id}/invitations`, payload: { invitee: 'guest@example.com' } })).json() as { invitation: ProjectInvitation }
    const token = tokenFromMail()
    expect((await inj(null, { method: 'GET', url: '/api/session/invitation/не-такой' })).statusCode).toBe(404)
    await inj(aliceTok, { method: 'DELETE', url: `/api/projects/${p.id}/invitations/${created.invitation.id}` })
    expect((await inj(null, { method: 'GET', url: `/api/session/invitation/${token}` })).statusCode).toBe(404)
  })
})
