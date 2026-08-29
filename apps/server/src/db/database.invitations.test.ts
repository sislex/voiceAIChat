import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { VoiceChatDb } from './database.js'

let db: VoiceChatDb
let clock = 1000

beforeEach(() => {
  let id = 0
  clock = 1000
  db = new VoiceChatDb(':memory:', { newId: () => `id-${++id}`, now: () => (clock += 10) })
  db.createUser('alice', '', 'developer')
  db.createUser('bob', '', 'developer')
  db.createUser('carol', '', 'developer')
})
afterEach(() => db.close())

/** Пользователь с подтверждённым адресом: регистрация по email проходит так же. */
function withEmail(name: string, email: string): void {
  db.createEmailVerification({ token: `t-${name}`, name, email, password: 'x', ttlMs: 60_000 })
  db.redeemEmailVerification(`t-${name}`, 'developer')
}

describe('приглашения: создание', () => {
  it('по логину адресуется пользователю, по адресу — почте', () => {
    const p = db.createProject('alice', { name: 'P' })
    const byLogin = db.createProjectInvitation('alice', p.id, 'bob')!
    expect(byLogin.invitation.invitedUsername).toBe('bob')
    expect(byLogin.invitation.email).toBeNull()
    expect(byLogin.token).toMatch(/^[\w-]{20,}$/)

    const byMail = db.createProjectInvitation('alice', p.id, 'NEW@Example.COM ')!
    expect(byMail.invitation.email).toBe('new@example.com')
    expect(byMail.invitation.invitedUsername).toBeNull()
    expect(byMail.email).toBe('new@example.com')
  })

  it('известный по адресу пользователь приглашается поимённо', () => {
    withEmail('dave', 'dave@example.com')
    const p = db.createProject('alice', { name: 'P' })
    const invite = db.createProjectInvitation('alice', p.id, 'dave@example.com')!
    expect(invite.invitation.invitedUsername).toBe('dave')
    expect(invite.email).toBe('dave@example.com')
  })

  it('не владелец не приглашает; мусор и уже-участник отклоняются', () => {
    const p = db.createProject('alice', { name: 'P' })
    expect(db.createProjectInvitation('bob', p.id, 'carol')).toBeNull()
    expect(() => db.createProjectInvitation('alice', p.id, '   ')).toThrow(/логин или email/i)
    expect(() => db.createProjectInvitation('alice', p.id, 'нет-такого')).toThrow(/не найден/i)
    expect(() => db.createProjectInvitation('alice', p.id, 'кто@то')).toThrow(/Некорректный email/i)
    expect(() => db.createProjectInvitation('alice', p.id, 'alice')).toThrow(/уже участник/i)
  })

  it('повторное приглашение того же адресата отзывает прежнее', () => {
    const p = db.createProject('alice', { name: 'P' })
    const first = db.createProjectInvitation('alice', p.id, 'bob')!
    const second = db.createProjectInvitation('alice', p.id, 'bob')!
    expect(db.listProjectInvitations('alice', p.id)!.map((i) => i.id)).toEqual([second.invitation.id])
    // Старый токен больше не работает: два живых токена на одного — лишняя поверхность.
    expect(() => db.acceptProjectInvitation('bob', first.token)).toThrow(/недействительно/i)
    expect(db.acceptProjectInvitation('bob', second.token).projectId).toBe(p.id)
  })
})

describe('приглашения: приём', () => {
  it('принять может только адресат', () => {
    const p = db.createProject('alice', { name: 'P' })
    const invite = db.createProjectInvitation('alice', p.id, 'bob')!
    // Утёкшая ссылка не должна пускать в проект кого угодно.
    expect(() => db.acceptProjectInvitation('carol', invite.token)).toThrow(/адресовано другому/i)
    expect(db.getProject('carol', p.id)).toBeNull()

    db.acceptProjectInvitation('bob', invite.token)
    expect(db.getProject('bob', p.id)).not.toBeNull()
  })

  it('приглашение «на адрес» принимает владелец этого адреса', () => {
    const p = db.createProject('alice', { name: 'P' })
    const invite = db.createProjectInvitation('alice', p.id, 'erin@example.com')!
    // Пока адрес ничей — принять некому.
    expect(() => db.acceptProjectInvitation('bob', invite.token)).toThrow(/адресовано другому/i)
    withEmail('erin', 'erin@example.com')
    expect(db.acceptProjectInvitation('erin', invite.token).projectId).toBe(p.id)
  })

  it('истёкшее отклоняется, отозванное — тоже', () => {
    const p = db.createProject('alice', { name: 'P' })
    const short = db.createProjectInvitation('alice', p.id, 'bob', { ttlMs: 5 })!
    clock += 1000
    expect(() => db.acceptProjectInvitation('bob', short.token)).toThrow(/истёк/i)

    const revoked = db.createProjectInvitation('alice', p.id, 'carol')!
    db.revokeProjectInvitation('alice', p.id, revoked.invitation.id)
    expect(() => db.acceptProjectInvitation('carol', revoked.token)).toThrow(/недействительно/i)
  })

  it('роль из приглашения переносится в членство', () => {
    const p = db.createProject('alice', { name: 'P' })
    const invite = db.createProjectInvitation('alice', p.id, 'bob', { role: 'owner' })!
    db.acceptProjectInvitation('bob', invite.token)
    expect(db.isProjectOwner('bob', p.id)).toBe(true)
  })

  it('отклонение закрывает приглашение и не даёт членства', () => {
    const p = db.createProject('alice', { name: 'P' })
    const invite = db.createProjectInvitation('alice', p.id, 'bob')!
    expect(db.declineProjectInvitation('bob', invite.token)).toBe(true)
    expect(db.getProject('bob', p.id)).toBeNull()
    expect(db.listProjectInvitations('alice', p.id)).toEqual([])
    expect(() => db.acceptProjectInvitation('bob', invite.token)).toThrow(/недействительно/i)
  })
})

describe('приглашения: список, отзыв и перевыпуск', () => {
  it('пользователь видит свои приглашения по логину и по адресу', () => {
    withEmail('frank', 'frank@example.com')
    const p1 = db.createProject('alice', { name: 'Первый' })
    const p2 = db.createProject('alice', { name: 'Второй' })
    db.createProjectInvitation('alice', p1.id, 'frank')
    db.createProjectInvitation('alice', p2.id, 'frank@example.com')
    const mine = db.listInvitationsForUser('frank')
    expect(mine.map((i) => i.projectName).sort()).toEqual(['Второй', 'Первый'])
    expect(db.listInvitationsForUser('bob')).toEqual([])
  })

  it('отзыв делает токен нерабочим, перевыпуск выдаёт новый', () => {
    const p = db.createProject('alice', { name: 'P' })
    const invite = db.createProjectInvitation('alice', p.id, 'bob')!
    expect(db.revokeProjectInvitation('bob', p.id, invite.invitation.id)).toBe(false)
    expect(db.revokeProjectInvitation('alice', p.id, invite.invitation.id)).toBe(true)
    expect(() => db.acceptProjectInvitation('bob', invite.token)).toThrow(/недействительно/i)

    const again = db.createProjectInvitation('alice', p.id, 'bob')!
    const refreshed = db.refreshProjectInvitationToken('alice', p.id, again.invitation.id)!
    expect(refreshed.token).not.toBe(again.token)
    // Прежний токен после перевыпуска не работает.
    expect(() => db.acceptProjectInvitation('bob', again.token)).toThrow(/недействительно/i)
    expect(db.acceptProjectInvitation('bob', refreshed.token).projectId).toBe(p.id)
  })

  it('регистрация по приглашённому адресу привязывает его, но не принимает автоматически', () => {
    const p = db.createProject('alice', { name: 'P' })
    db.createProjectInvitation('alice', p.id, 'grace@example.com')
    withEmail('grace', 'grace@example.com')
    expect(db.attachInvitationsToNewUser('grace', 'grace@example.com')).toBeGreaterThanOrEqual(0)
    // Членства ещё нет — человек подтверждает вступление сам.
    expect(db.getProject('grace', p.id)).toBeNull()
    expect(db.listInvitationsForUser('grace').length).toBe(1)
  })

  it('удаление проекта уносит его приглашения', () => {
    const p = db.createProject('alice', { name: 'P' })
    db.createProjectInvitation('alice', p.id, 'bob')
    db.deleteProject('alice', p.id)
    expect(db.listInvitationsForUser('bob')).toEqual([])
  })
})

describe('приглашения: ответ из интерфейса по id', () => {
  it('приглашённый по логину принимает по id — токена у него нет', () => {
    const p = db.createProject('alice', { name: 'P' })
    const invite = db.createProjectInvitation('alice', p.id, 'bob')!
    const mine = db.listInvitationsForUser('bob')
    expect(mine.length).toBe(1)
    // В списке токена нет — только id.
    expect(JSON.stringify(mine)).not.toContain(invite.token)
    expect(db.acceptProjectInvitation('bob', mine[0].id).projectId).toBe(p.id)
    expect(db.getProject('bob', p.id)).not.toBeNull()
  })

  it('чужой id так же отклоняется, как чужой токен', () => {
    const p = db.createProject('alice', { name: 'P' })
    const invite = db.createProjectInvitation('alice', p.id, 'bob')!
    expect(() => db.acceptProjectInvitation('carol', invite.invitation.id)).toThrow(/адресовано другому/i)
    expect(db.getProject('carol', p.id)).toBeNull()
  })

  it('отклонить из списка тоже можно по id', () => {
    const p = db.createProject('alice', { name: 'P' })
    const invite = db.createProjectInvitation('alice', p.id, 'bob')!
    expect(db.declineProjectInvitation('bob', invite.invitation.id)).toBe(true)
    expect(db.listInvitationsForUser('bob')).toEqual([])
  })
})

describe('удаление пользователя и приглашения', () => {
  it('живые приглашения удалённого пользователя закрываются', () => {
    withEmail('hank', 'hank@example.com')
    const p = db.createProject('alice', { name: 'P' })
    db.createProjectInvitation('alice', p.id, 'hank')
    expect(db.listInvitationsForUser('hank').length).toBe(1)

    db.deleteUserData('hank')
    // Повторная регистрация того же логина не должна возвращать чужое приглашение.
    withEmail('hank', 'hank@example.com')
    expect(db.listInvitationsForUser('hank')).toEqual([])
  })

  it('приглашение на адрес удалённого пользователя тоже закрывается', () => {
    withEmail('iris', 'iris@example.com')
    const p = db.createProject('alice', { name: 'P' })
    db.createProjectInvitation('alice', p.id, 'iris@example.com')
    db.deleteUserData('iris')
    withEmail('iris', 'iris@example.com')
    expect(db.listInvitationsForUser('iris')).toEqual([])
  })

  it('повторный переход по принятой ссылке ведёт в проект, а не в отказ', () => {
    const p = db.createProject('alice', { name: 'P' })
    const { token } = db.createProjectInvitation('alice', p.id, 'bob')!
    expect(db.acceptProjectInvitation('bob', token)).toEqual({ projectId: p.id })
    // Письмо остаётся в почте, вкладок может быть две — второй переход того же
    // человека новых прав не даёт, но и отказом быть не должен.
    expect(db.acceptProjectInvitation('bob', token)).toEqual({ projectId: p.id })
  })

  it('принятое приглашение чужому пользователю по-прежнему отказывает', () => {
    const p = db.createProject('alice', { name: 'P' })
    const { token } = db.createProjectInvitation('alice', p.id, 'bob')!
    db.acceptProjectInvitation('bob', token)
    expect(() => db.acceptProjectInvitation('carol', token)).toThrow()
  })

  it('исключённый участник по старой принятой ссылке обратно не входит', () => {
    const p = db.createProject('alice', { name: 'P' })
    const { token } = db.createProjectInvitation('alice', p.id, 'bob')!
    db.acceptProjectInvitation('bob', token)
    db.removeMember('alice', p.id, 'bob')
    // Идемпотентность держится на членстве: без него ссылка снова недействительна.
    expect(() => db.acceptProjectInvitation('bob', token)).toThrow('Приглашение недействительно')
  })
})
