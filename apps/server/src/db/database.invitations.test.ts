import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { Sql } from '@sislexa/identity/storage-sql/types'
import { VoiceChatDb } from './database.js'

// Kanban creates, accepts and revokes project invitations in the shared database.
// Core keeps the Identity hooks: registration attaches address invitations and
// account deletion closes the deleted user's pending invitations.

let db: VoiceChatDb
let seq = 0
const sql = (): Sql => (db as unknown as { sql: Sql }).sql

beforeEach(async () => {
  db = new VoiceChatDb(':memory:')
  await db.identity.createUser('alice', '', 'developer')
})
afterEach(() => db.close())

async function withEmail(name: string, email: string): Promise<void> {
  await db.identity.createEmailVerification({ token: `t-${name}`, name, email, password: 'x', ttlMs: 60_000 })
  await db.identity.redeemEmailVerification(`t-${name}`, 'developer')
}

async function invite(projectId: string, target: { email?: string; username?: string }): Promise<string> {
  const id = `inv-${++seq}`
  await sql().run(`INSERT INTO project_invitations (id, project_id, email, invited_username, role, token_hash, status, invited_by, created_at, expires_at)
    VALUES (?, ?, ?, ?, 'member', ?, 'pending', 'alice', ?, ?)`, [id, projectId, target.email ?? null, target.username ?? null, `hash-${id}`, Date.now(), Date.now() + 60_000])
  return id
}

const invitation = async (id: string) => sql().get<{ status: string; invited_username: string | null }>('SELECT status, invited_username FROM project_invitations WHERE id = ?', [id])

describe('project invitations: Identity hooks', () => {
  it('registration by an invited address binds the invitation without accepting it', async () => {
    const p = await db.projects.createProject('alice', { name: 'P' })
    const id = await invite(p.id, { email: 'grace@example.com' })
    await withEmail('grace', 'grace@example.com')
    expect(await db.projects.attachInvitationsToNewUser('grace', 'Grace@Example.com')).toBe(1)
    expect(await invitation(id)).toEqual({ status: 'pending', invited_username: 'grace' })
    expect(await db.projects.getProject('grace', p.id)).toBeNull()
  })

  it('deleting a user closes pending invitations addressed by login and by address', async () => {
    await withEmail('hank', 'hank@example.com')
    const p = await db.projects.createProject('alice', { name: 'P' })
    const byLogin = await invite(p.id, { username: 'hank' })
    const byMail = await invite(p.id, { email: 'hank@example.com' })
    const other = await invite(p.id, { email: 'other@example.com' })
    await db.identity.deleteUserData('hank')
    expect((await invitation(byLogin))!.status).toBe('revoked')
    expect((await invitation(byMail))!.status).toBe('revoked')
    expect((await invitation(other))!.status).toBe('pending')
  })
})
