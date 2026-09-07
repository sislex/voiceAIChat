import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { VoiceChatDb } from './database'

describe('login enrollment storage', () => {
  let now = 1_000
  let db: VoiceChatDb

  beforeEach(() => {
    db = new VoiceChatDb(':memory:', { now: () => now })
  })
  afterEach(() => db.close())

  it('atomically creates one machine, consumes token and assigns personal default', async () => {
    const enrollment = await db.machines.createLoginEnrollment('alice', 120_000)
    expect(await db.machines.getLoginEnrollmentStatus('bob', enrollment.statusId)).toBeNull()
    const result = await db.machines.redeemLoginEnrollment(enrollment.token, 'Alice Mac')
    expect(result).toMatchObject({ name: 'Alice Mac', userId: 'alice' })
    expect((await db.settings.getSettings('alice')).defaultAgentId).toBe(result?.id)
    expect(await db.machines.getLoginEnrollmentStatus('alice', enrollment.statusId)).toMatchObject({ status: 'completed', agentId: result?.id })
    expect(await db.machines.redeemLoginEnrollment(enrollment.token, 'Duplicate')).toBeNull()
    expect(await db.machines.listAgents('alice')).toHaveLength(1)
  })

  it('rejects expired and unknown tokens without changing machines or settings', async () => {
    const enrollment = await db.machines.createLoginEnrollment('alice', 50)
    now = enrollment.expiresAt
    expect(await db.machines.redeemLoginEnrollment(enrollment.token, 'Late Mac')).toBeNull()
    expect(await db.machines.redeemLoginEnrollment('unknown', 'Unknown Mac')).toBeNull()
    expect(await db.machines.listAgents('alice')).toHaveLength(0)
    expect((await db.settings.getSettings('alice')).defaultAgentId).toBeNull()
    expect((await db.machines.getLoginEnrollmentStatus('alice', enrollment.statusId))?.status).toBe('expired')
  })
})
