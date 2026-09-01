import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { VoiceChatDb } from './database'

describe('login enrollment storage', () => {
  let now = 1_000
  let db: VoiceChatDb

  beforeEach(() => {
    db = new VoiceChatDb(':memory:', { now: () => now })
  })
  afterEach(() => db.close())

  it('atomically creates one machine, consumes token and assigns personal default', () => {
    const enrollment = db.createLoginEnrollment('alice', 120_000)
    expect(db.getLoginEnrollmentStatus('bob', enrollment.statusId)).toBeNull()
    const result = db.redeemLoginEnrollment(enrollment.token, 'Alice Mac')
    expect(result).toMatchObject({ name: 'Alice Mac', userId: 'alice' })
    expect(db.getSettings('alice').defaultAgentId).toBe(result?.id)
    expect(db.getLoginEnrollmentStatus('alice', enrollment.statusId)).toMatchObject({ status: 'completed', agentId: result?.id })
    expect(db.redeemLoginEnrollment(enrollment.token, 'Duplicate')).toBeNull()
    expect(db.listAgents('alice')).toHaveLength(1)
  })

  it('rejects expired and unknown tokens without changing machines or settings', () => {
    const enrollment = db.createLoginEnrollment('alice', 50)
    now = enrollment.expiresAt
    expect(db.redeemLoginEnrollment(enrollment.token, 'Late Mac')).toBeNull()
    expect(db.redeemLoginEnrollment('unknown', 'Unknown Mac')).toBeNull()
    expect(db.listAgents('alice')).toHaveLength(0)
    expect(db.getSettings('alice').defaultAgentId).toBeNull()
    expect(db.getLoginEnrollmentStatus('alice', enrollment.statusId)?.status).toBe('expired')
  })
})
