import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { VoiceChatDb } from './database.js'

let db: VoiceChatDb
let clock = 1000

beforeEach(() => {
  let id = 0
  clock = 1000
  db = new VoiceChatDb(':memory:', { newId: () => `id-${++id}`, now: () => (clock += 10) })
  db.identity.createUser('alice', '', 'developer')
  db.identity.createUser('bob', '', 'developer')
  db.identity.createUser('carol', '', 'developer')
})
afterEach(() => db.close())

/** Пользователь с подтверждённым адресом: регистрация по email проходит так же. */
function withEmail(name: string, email: string): void {
  db.identity.createEmailVerification({ token: `t-${name}`, name, email, password: 'x', ttlMs: 60_000 })
  db.identity.redeemEmailVerification(`t-${name}`, 'developer')
}

describe('приглашения: создание', () => {
  it('по логину адресуется пользователю, по адресу — почте', () => {
    const p = db.projects.createProject('alice', { name: 'P' })
    const byLogin = db.projects.createProjectInvitation('alice', p.id, 'bob')!
    expect(byLogin.invitation.invitedUsername).toBe('bob')
    expect(byLogin.invitation.email).toBeNull()
    expect(byLogin.token).toMatch(/^[\w-]{20,}$/)

    const byMail = db.projects.createProjectInvitation('alice', p.id, 'NEW@Example.COM ')!
    expect(byMail.invitation.email).toBe('new@example.com')
    expect(byMail.invitation.invitedUsername).toBeNull()
    expect(byMail.email).toBe('new@example.com')
  })

  it('известный по адресу пользователь приглашается поимённо', () => {
    withEmail('dave', 'dave@example.com')
    const p = db.projects.createProject('alice', { name: 'P' })
    const invite = db.projects.createProjectInvitation('alice', p.id, 'dave@example.com')!
    expect(invite.invitation.invitedUsername).toBe('dave')
    expect(invite.email).toBe('dave@example.com')
  })

  it('не владелец не приглашает; мусор и уже-участник отклоняются', () => {
    const p = db.projects.createProject('alice', { name: 'P' })
    expect(db.projects.createProjectInvitation('bob', p.id, 'carol')).toBeNull()
    expect(() => db.projects.createProjectInvitation('alice', p.id, '   ')).toThrow(/логин или email/i)
    expect(() => db.projects.createProjectInvitation('alice', p.id, 'нет-такого')).toThrow(/не найден/i)
    expect(() => db.projects.createProjectInvitation('alice', p.id, 'кто@то')).toThrow(/Некорректный email/i)
    expect(() => db.projects.createProjectInvitation('alice', p.id, 'alice')).toThrow(/уже участник/i)
  })

  it('повторное приглашение того же адресата отзывает прежнее', () => {
    const p = db.projects.createProject('alice', { name: 'P' })
    const first = db.projects.createProjectInvitation('alice', p.id, 'bob')!
    const second = db.projects.createProjectInvitation('alice', p.id, 'bob')!
    expect(db.projects.listProjectInvitations('alice', p.id)!.map((i) => i.id)).toEqual([second.invitation.id])
    // Старый токен больше не работает: два живых токена на одного — лишняя поверхность.
    expect(() => db.projects.acceptProjectInvitation('bob', first.token)).toThrow(/недействительно/i)
    expect(db.projects.acceptProjectInvitation('bob', second.token).projectId).toBe(p.id)
  })
})

describe('приглашения: приём', () => {
  it('принять может только адресат', () => {
    const p = db.projects.createProject('alice', { name: 'P' })
    const invite = db.projects.createProjectInvitation('alice', p.id, 'bob')!
    // Утёкшая ссылка не должна пускать в проект кого угодно.
    expect(() => db.projects.acceptProjectInvitation('carol', invite.token)).toThrow(/адресовано другому/i)
    expect(db.projects.getProject('carol', p.id)).toBeNull()

    db.projects.acceptProjectInvitation('bob', invite.token)
    expect(db.projects.getProject('bob', p.id)).not.toBeNull()
  })

  it('приглашение «на адрес» принимает владелец этого адреса', () => {
    const p = db.projects.createProject('alice', { name: 'P' })
    const invite = db.projects.createProjectInvitation('alice', p.id, 'erin@example.com')!
    // Пока адрес ничей — принять некому.
    expect(() => db.projects.acceptProjectInvitation('bob', invite.token)).toThrow(/адресовано другому/i)
    withEmail('erin', 'erin@example.com')
    expect(db.projects.acceptProjectInvitation('erin', invite.token).projectId).toBe(p.id)
  })

  it('истёкшее отклоняется, отозванное — тоже', () => {
    const p = db.projects.createProject('alice', { name: 'P' })
    const short = db.projects.createProjectInvitation('alice', p.id, 'bob', { ttlMs: 5 })!
    clock += 1000
    expect(() => db.projects.acceptProjectInvitation('bob', short.token)).toThrow(/истёк/i)

    const revoked = db.projects.createProjectInvitation('alice', p.id, 'carol')!
    db.projects.revokeProjectInvitation('alice', p.id, revoked.invitation.id)
    expect(() => db.projects.acceptProjectInvitation('carol', revoked.token)).toThrow(/недействительно/i)
  })

  it('роль из приглашения переносится в членство', () => {
    const p = db.projects.createProject('alice', { name: 'P' })
    const invite = db.projects.createProjectInvitation('alice', p.id, 'bob', { role: 'owner' })!
    db.projects.acceptProjectInvitation('bob', invite.token)
    expect(db.projects.isProjectOwner('bob', p.id)).toBe(true)
  })

  it('отклонение закрывает приглашение и не даёт членства', () => {
    const p = db.projects.createProject('alice', { name: 'P' })
    const invite = db.projects.createProjectInvitation('alice', p.id, 'bob')!
    expect(db.projects.declineProjectInvitation('bob', invite.token)).toBe(true)
    expect(db.projects.getProject('bob', p.id)).toBeNull()
    expect(db.projects.listProjectInvitations('alice', p.id)).toEqual([])
    expect(() => db.projects.acceptProjectInvitation('bob', invite.token)).toThrow(/недействительно/i)
  })
})

describe('приглашения: список, отзыв и перевыпуск', () => {
  it('пользователь видит свои приглашения по логину и по адресу', () => {
    withEmail('frank', 'frank@example.com')
    const p1 = db.projects.createProject('alice', { name: 'Первый' })
    const p2 = db.projects.createProject('alice', { name: 'Второй' })
    db.projects.createProjectInvitation('alice', p1.id, 'frank')
    db.projects.createProjectInvitation('alice', p2.id, 'frank@example.com')
    const mine = db.projects.listInvitationsForUser('frank')
    expect(mine.map((i) => i.projectName).sort()).toEqual(['Второй', 'Первый'])
    expect(db.projects.listInvitationsForUser('bob')).toEqual([])
  })

  it('отзыв делает токен нерабочим, перевыпуск выдаёт новый', () => {
    const p = db.projects.createProject('alice', { name: 'P' })
    const invite = db.projects.createProjectInvitation('alice', p.id, 'bob')!
    expect(db.projects.revokeProjectInvitation('bob', p.id, invite.invitation.id)).toBe(false)
    expect(db.projects.revokeProjectInvitation('alice', p.id, invite.invitation.id)).toBe(true)
    expect(() => db.projects.acceptProjectInvitation('bob', invite.token)).toThrow(/недействительно/i)

    const again = db.projects.createProjectInvitation('alice', p.id, 'bob')!
    const refreshed = db.projects.refreshProjectInvitationToken('alice', p.id, again.invitation.id)!
    expect(refreshed.token).not.toBe(again.token)
    // Прежний токен после перевыпуска не работает.
    expect(() => db.projects.acceptProjectInvitation('bob', again.token)).toThrow(/недействительно/i)
    expect(db.projects.acceptProjectInvitation('bob', refreshed.token).projectId).toBe(p.id)
  })

  it('регистрация по приглашённому адресу привязывает его, но не принимает автоматически', () => {
    const p = db.projects.createProject('alice', { name: 'P' })
    db.projects.createProjectInvitation('alice', p.id, 'grace@example.com')
    withEmail('grace', 'grace@example.com')
    expect(db.projects.attachInvitationsToNewUser('grace', 'grace@example.com')).toBeGreaterThanOrEqual(0)
    // Членства ещё нет — человек подтверждает вступление сам.
    expect(db.projects.getProject('grace', p.id)).toBeNull()
    expect(db.projects.listInvitationsForUser('grace').length).toBe(1)
  })

  it('удаление проекта уносит его приглашения', () => {
    const p = db.projects.createProject('alice', { name: 'P' })
    db.projects.createProjectInvitation('alice', p.id, 'bob')
    db.projects.deleteProject('alice', p.id)
    expect(db.projects.listInvitationsForUser('bob')).toEqual([])
  })
})

describe('приглашения: ответ из интерфейса по id', () => {
  it('приглашённый по логину принимает по id — токена у него нет', () => {
    const p = db.projects.createProject('alice', { name: 'P' })
    const invite = db.projects.createProjectInvitation('alice', p.id, 'bob')!
    const mine = db.projects.listInvitationsForUser('bob')
    expect(mine.length).toBe(1)
    // В списке токена нет — только id.
    expect(JSON.stringify(mine)).not.toContain(invite.token)
    expect(db.projects.acceptProjectInvitation('bob', mine[0].id).projectId).toBe(p.id)
    expect(db.projects.getProject('bob', p.id)).not.toBeNull()
  })

  it('чужой id так же отклоняется, как чужой токен', () => {
    const p = db.projects.createProject('alice', { name: 'P' })
    const invite = db.projects.createProjectInvitation('alice', p.id, 'bob')!
    expect(() => db.projects.acceptProjectInvitation('carol', invite.invitation.id)).toThrow(/адресовано другому/i)
    expect(db.projects.getProject('carol', p.id)).toBeNull()
  })

  it('отклонить из списка тоже можно по id', () => {
    const p = db.projects.createProject('alice', { name: 'P' })
    const invite = db.projects.createProjectInvitation('alice', p.id, 'bob')!
    expect(db.projects.declineProjectInvitation('bob', invite.invitation.id)).toBe(true)
    expect(db.projects.listInvitationsForUser('bob')).toEqual([])
  })
})

describe('удаление пользователя и приглашения', () => {
  it('живые приглашения удалённого пользователя закрываются', () => {
    withEmail('hank', 'hank@example.com')
    const p = db.projects.createProject('alice', { name: 'P' })
    db.projects.createProjectInvitation('alice', p.id, 'hank')
    expect(db.projects.listInvitationsForUser('hank').length).toBe(1)

    db.identity.deleteUserData('hank')
    // Повторная регистрация того же логина не должна возвращать чужое приглашение.
    withEmail('hank', 'hank@example.com')
    expect(db.projects.listInvitationsForUser('hank')).toEqual([])
  })

  it('приглашение на адрес удалённого пользователя тоже закрывается', () => {
    withEmail('iris', 'iris@example.com')
    const p = db.projects.createProject('alice', { name: 'P' })
    db.projects.createProjectInvitation('alice', p.id, 'iris@example.com')
    db.identity.deleteUserData('iris')
    withEmail('iris', 'iris@example.com')
    expect(db.projects.listInvitationsForUser('iris')).toEqual([])
  })

  it('повторный переход по принятой ссылке ведёт в проект, а не в отказ', () => {
    const p = db.projects.createProject('alice', { name: 'P' })
    const { token } = db.projects.createProjectInvitation('alice', p.id, 'bob')!
    expect(db.projects.acceptProjectInvitation('bob', token)).toEqual({ projectId: p.id })
    // Письмо остаётся в почте, вкладок может быть две — второй переход того же
    // человека новых прав не даёт, но и отказом быть не должен.
    expect(db.projects.acceptProjectInvitation('bob', token)).toEqual({ projectId: p.id })
  })

  it('принятое приглашение чужому пользователю по-прежнему отказывает', () => {
    const p = db.projects.createProject('alice', { name: 'P' })
    const { token } = db.projects.createProjectInvitation('alice', p.id, 'bob')!
    db.projects.acceptProjectInvitation('bob', token)
    expect(() => db.projects.acceptProjectInvitation('carol', token)).toThrow()
  })

  it('исключённый участник по старой принятой ссылке обратно не входит', () => {
    const p = db.projects.createProject('alice', { name: 'P' })
    const { token } = db.projects.createProjectInvitation('alice', p.id, 'bob')!
    db.projects.acceptProjectInvitation('bob', token)
    db.projects.removeMember('alice', p.id, 'bob')
    // Идемпотентность держится на членстве: без него ссылка снова недействительна.
    expect(() => db.projects.acceptProjectInvitation('bob', token)).toThrow('Приглашение недействительно')
  })
})
