import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { VoiceChatDb } from './database.js'

let db: VoiceChatDb
let clock = 1000

beforeEach(async () => {
  let id = 0
  clock = 1000
  db = new VoiceChatDb(':memory:', { newId: () => `id-${++id}`, now: () => (clock += 10) })
  await db.identity.createUser('alice', '', 'developer')
  await db.identity.createUser('bob', '', 'developer')
  await db.identity.createUser('carol', '', 'developer')
})
afterEach(() => db.close())

/** Пользователь с подтверждённым адресом: регистрация по email проходит так же. */
async function withEmail(name: string, email: string): Promise<void> {
  await db.identity.createEmailVerification({ token: `t-${name}`, name, email, password: 'x', ttlMs: 60_000 })
  await db.identity.redeemEmailVerification(`t-${name}`, 'developer')
}

describe('приглашения: создание', () => {
  it('по логину адресуется пользователю, по адресу — почте', async () => {
    const p = await db.projects.createProject('alice', { name: 'P' })
    const byLogin = (await db.projects.createProjectInvitation('alice', p.id, 'bob'))!
    expect(byLogin.invitation.invitedUsername).toBe('bob')
    expect(byLogin.invitation.email).toBeNull()
    expect(byLogin.token).toMatch(/^[\w-]{20,}$/)

    const byMail = (await db.projects.createProjectInvitation('alice', p.id, 'NEW@Example.COM '))!
    expect(byMail.invitation.email).toBe('new@example.com')
    expect(byMail.invitation.invitedUsername).toBeNull()
    expect(byMail.email).toBe('new@example.com')
  })

  it('известный по адресу пользователь приглашается поимённо', async () => {
    await withEmail('dave', 'dave@example.com')
    const p = await db.projects.createProject('alice', { name: 'P' })
    const invite = (await db.projects.createProjectInvitation('alice', p.id, 'dave@example.com'))!
    expect(invite.invitation.invitedUsername).toBe('dave')
    expect(invite.email).toBe('dave@example.com')
  })

  it('не владелец не приглашает; мусор и уже-участник отклоняются', async () => {
    const p = await db.projects.createProject('alice', { name: 'P' })
    expect(await db.projects.createProjectInvitation('bob', p.id, 'carol')).toBeNull()
    await expect(async () => await db.projects.createProjectInvitation('alice', p.id, '   ')).rejects.toThrow(/логин или email/i)
    await expect(async () => await db.projects.createProjectInvitation('alice', p.id, 'нет-такого')).rejects.toThrow(/не найден/i)
    await expect(async () => await db.projects.createProjectInvitation('alice', p.id, 'кто@то')).rejects.toThrow(/Некорректный email/i)
    await expect(async () => await db.projects.createProjectInvitation('alice', p.id, 'alice')).rejects.toThrow(/уже участник/i)
  })

  it('повторное приглашение того же адресата отзывает прежнее', async () => {
    const p = await db.projects.createProject('alice', { name: 'P' })
    const first = (await db.projects.createProjectInvitation('alice', p.id, 'bob'))!
    const second = (await db.projects.createProjectInvitation('alice', p.id, 'bob'))!
    expect((await db.projects.listProjectInvitations('alice', p.id))!.map((i) => i.id)).toEqual([second.invitation.id])
    // Старый токен больше не работает: два живых токена на одного — лишняя поверхность.
    await expect(async () => await db.projects.acceptProjectInvitation('bob', first.token)).rejects.toThrow(/недействительно/i)
    expect((await db.projects.acceptProjectInvitation('bob', second.token)).projectId).toBe(p.id)
  })
})

describe('приглашения: приём', () => {
  it('принять может только адресат', async () => {
    const p = await db.projects.createProject('alice', { name: 'P' })
    const invite = (await db.projects.createProjectInvitation('alice', p.id, 'bob'))!
    // Утёкшая ссылка не должна пускать в проект кого угодно.
    await expect(async () => await db.projects.acceptProjectInvitation('carol', invite.token)).rejects.toThrow(/адресовано другому/i)
    expect(await db.projects.getProject('carol', p.id)).toBeNull()

    await db.projects.acceptProjectInvitation('bob', invite.token)
    expect(await db.projects.getProject('bob', p.id)).not.toBeNull()
  })

  it('приглашение «на адрес» принимает владелец этого адреса', async () => {
    const p = await db.projects.createProject('alice', { name: 'P' })
    const invite = (await db.projects.createProjectInvitation('alice', p.id, 'erin@example.com'))!
    // Пока адрес ничей — принять некому.
    await expect(async () => await db.projects.acceptProjectInvitation('bob', invite.token)).rejects.toThrow(/адресовано другому/i)
    await withEmail('erin', 'erin@example.com')
    expect((await db.projects.acceptProjectInvitation('erin', invite.token)).projectId).toBe(p.id)
  })

  it('истёкшее отклоняется, отозванное — тоже', async () => {
    const p = await db.projects.createProject('alice', { name: 'P' })
    const short = (await db.projects.createProjectInvitation('alice', p.id, 'bob', { ttlMs: 5 }))!
    clock += 1000
    await expect(async () => await db.projects.acceptProjectInvitation('bob', short.token)).rejects.toThrow(/истёк/i)

    const revoked = (await db.projects.createProjectInvitation('alice', p.id, 'carol'))!
    await db.projects.revokeProjectInvitation('alice', p.id, revoked.invitation.id)
    await expect(async () => await db.projects.acceptProjectInvitation('carol', revoked.token)).rejects.toThrow(/недействительно/i)
  })

  it('роль из приглашения переносится в членство', async () => {
    const p = await db.projects.createProject('alice', { name: 'P' })
    const invite = (await db.projects.createProjectInvitation('alice', p.id, 'bob', { role: 'owner' }))!
    await db.projects.acceptProjectInvitation('bob', invite.token)
    expect(await db.projects.isProjectOwner('bob', p.id)).toBe(true)
  })

  it('отклонение закрывает приглашение и не даёт членства', async () => {
    const p = await db.projects.createProject('alice', { name: 'P' })
    const invite = (await db.projects.createProjectInvitation('alice', p.id, 'bob'))!
    expect(await db.projects.declineProjectInvitation('bob', invite.token)).toBe(true)
    expect(await db.projects.getProject('bob', p.id)).toBeNull()
    expect(await db.projects.listProjectInvitations('alice', p.id)).toEqual([])
    await expect(async () => await db.projects.acceptProjectInvitation('bob', invite.token)).rejects.toThrow(/недействительно/i)
  })
})

describe('приглашения: список, отзыв и перевыпуск', () => {
  it('пользователь видит свои приглашения по логину и по адресу', async () => {
    await withEmail('frank', 'frank@example.com')
    const p1 = await db.projects.createProject('alice', { name: 'Первый' })
    const p2 = await db.projects.createProject('alice', { name: 'Второй' })
    await db.projects.createProjectInvitation('alice', p1.id, 'frank')
    await db.projects.createProjectInvitation('alice', p2.id, 'frank@example.com')
    const mine = await db.projects.listInvitationsForUser('frank')
    expect(mine.map((i) => i.projectName).sort()).toEqual(['Второй', 'Первый'])
    expect(await db.projects.listInvitationsForUser('bob')).toEqual([])
  })

  it('отзыв делает токен нерабочим, перевыпуск выдаёт новый', async () => {
    const p = await db.projects.createProject('alice', { name: 'P' })
    const invite = (await db.projects.createProjectInvitation('alice', p.id, 'bob'))!
    expect(await db.projects.revokeProjectInvitation('bob', p.id, invite.invitation.id)).toBe(false)
    expect(await db.projects.revokeProjectInvitation('alice', p.id, invite.invitation.id)).toBe(true)
    await expect(async () => await db.projects.acceptProjectInvitation('bob', invite.token)).rejects.toThrow(/недействительно/i)

    const again = (await db.projects.createProjectInvitation('alice', p.id, 'bob'))!
    const refreshed = (await db.projects.refreshProjectInvitationToken('alice', p.id, again.invitation.id))!
    expect(refreshed.token).not.toBe(again.token)
    // Прежний токен после перевыпуска не работает.
    await expect(async () => await db.projects.acceptProjectInvitation('bob', again.token)).rejects.toThrow(/недействительно/i)
    expect((await db.projects.acceptProjectInvitation('bob', refreshed.token)).projectId).toBe(p.id)
  })

  it('регистрация по приглашённому адресу привязывает его, но не принимает автоматически', async () => {
    const p = await db.projects.createProject('alice', { name: 'P' })
    await db.projects.createProjectInvitation('alice', p.id, 'grace@example.com')
    await withEmail('grace', 'grace@example.com')
    expect(await db.projects.attachInvitationsToNewUser('grace', 'grace@example.com')).toBeGreaterThanOrEqual(0)
    // Членства ещё нет — человек подтверждает вступление сам.
    expect(await db.projects.getProject('grace', p.id)).toBeNull()
    expect((await db.projects.listInvitationsForUser('grace')).length).toBe(1)
  })

  it('удаление проекта уносит его приглашения', async () => {
    const p = await db.projects.createProject('alice', { name: 'P' })
    await db.projects.createProjectInvitation('alice', p.id, 'bob')
    await db.projects.deleteProject('alice', p.id)
    expect(await db.projects.listInvitationsForUser('bob')).toEqual([])
  })
})

describe('приглашения: ответ из интерфейса по id', () => {
  it('приглашённый по логину принимает по id — токена у него нет', async () => {
    const p = await db.projects.createProject('alice', { name: 'P' })
    const invite = (await db.projects.createProjectInvitation('alice', p.id, 'bob'))!
    const mine = await db.projects.listInvitationsForUser('bob')
    expect(mine.length).toBe(1)
    // В списке токена нет — только id.
    expect(JSON.stringify(mine)).not.toContain(invite.token)
    expect((await db.projects.acceptProjectInvitation('bob', mine[0].id)).projectId).toBe(p.id)
    expect(await db.projects.getProject('bob', p.id)).not.toBeNull()
  })

  it('чужой id так же отклоняется, как чужой токен', async () => {
    const p = await db.projects.createProject('alice', { name: 'P' })
    const invite = (await db.projects.createProjectInvitation('alice', p.id, 'bob'))!
    await expect(async () => await db.projects.acceptProjectInvitation('carol', invite.invitation.id)).rejects.toThrow(/адресовано другому/i)
    expect(await db.projects.getProject('carol', p.id)).toBeNull()
  })

  it('отклонить из списка тоже можно по id', async () => {
    const p = await db.projects.createProject('alice', { name: 'P' })
    const invite = (await db.projects.createProjectInvitation('alice', p.id, 'bob'))!
    expect(await db.projects.declineProjectInvitation('bob', invite.invitation.id)).toBe(true)
    expect(await db.projects.listInvitationsForUser('bob')).toEqual([])
  })
})

describe('удаление пользователя и приглашения', () => {
  it('живые приглашения удалённого пользователя закрываются', async () => {
    await withEmail('hank', 'hank@example.com')
    const p = await db.projects.createProject('alice', { name: 'P' })
    await db.projects.createProjectInvitation('alice', p.id, 'hank')
    expect((await db.projects.listInvitationsForUser('hank')).length).toBe(1)

    await db.identity.deleteUserData('hank')
    // Повторная регистрация того же логина не должна возвращать чужое приглашение.
    await withEmail('hank', 'hank@example.com')
    expect(await db.projects.listInvitationsForUser('hank')).toEqual([])
  })

  it('приглашение на адрес удалённого пользователя тоже закрывается', async () => {
    await withEmail('iris', 'iris@example.com')
    const p = await db.projects.createProject('alice', { name: 'P' })
    await db.projects.createProjectInvitation('alice', p.id, 'iris@example.com')
    await db.identity.deleteUserData('iris')
    await withEmail('iris', 'iris@example.com')
    expect(await db.projects.listInvitationsForUser('iris')).toEqual([])
  })

  it('повторный переход по принятой ссылке ведёт в проект, а не в отказ', async () => {
    const p = await db.projects.createProject('alice', { name: 'P' })
    const { token } = (await db.projects.createProjectInvitation('alice', p.id, 'bob'))!
    expect(await db.projects.acceptProjectInvitation('bob', token)).toEqual({ projectId: p.id })
    // Письмо остаётся в почте, вкладок может быть две — второй переход того же
    // человека новых прав не даёт, но и отказом быть не должен.
    expect(await db.projects.acceptProjectInvitation('bob', token)).toEqual({ projectId: p.id })
  })

  it('принятое приглашение чужому пользователю по-прежнему отказывает', async () => {
    const p = await db.projects.createProject('alice', { name: 'P' })
    const { token } = (await db.projects.createProjectInvitation('alice', p.id, 'bob'))!
    await db.projects.acceptProjectInvitation('bob', token)
    await expect(async () => await db.projects.acceptProjectInvitation('carol', token)).rejects.toThrow()
  })

  it('исключённый участник по старой принятой ссылке обратно не входит', async () => {
    const p = await db.projects.createProject('alice', { name: 'P' })
    const { token } = (await db.projects.createProjectInvitation('alice', p.id, 'bob'))!
    await db.projects.acceptProjectInvitation('bob', token)
    await db.projects.removeMember('alice', p.id, 'bob')
    // Идемпотентность держится на членстве: без него ссылка снова недействительна.
    await expect(async () => await db.projects.acceptProjectInvitation('bob', token)).rejects.toThrow('Приглашение недействительно')
  })
})
