import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { coordinatorDeliveries, StandDeliveryCoordinator, standDeliveryIntegration } from './standDeliveryCoordinator.js'

afterEach(() => vi.unstubAllEnvs())
const candidate = { repository: 'sislex/core-ui', branch: 'make/test', targetBranch: 'dev', headSha: 'a'.repeat(40), title: 'Change', author: 'alice' }
it('joins persisted candidates with integration attempts and events across restarts', () => {
  const status = {
    candidates: [{ ...candidate, runId: 'stand-delivery', taskId: 'T-1', createdAt: '2026-10-12T12:00:00Z' }],
    runs: [{ runId: 'stand-delivery', tasks: [{ taskId: 'T-1', attempts: [{ integrationStatus: 'integration_failed', gateLogTail: 'failed assertion' }] }] }],
    events: [{ runId: 'stand-delivery', taskId: 'T-1', type: 'candidate.branch_submitted' }]
  }
  expect(coordinatorDeliveries(status, candidate.repository, candidate.branch)[0]).toMatchObject({ state: 'rejected', gateLogTail: 'failed assertion' })
  status.events.push({ runId: 'stand-delivery', taskId: 'T-1', type: 'attempt.integration_integrated' })
  expect(coordinatorDeliveries(status, candidate.repository, candidate.branch)[0]?.state).toBe('integrated')
  expect(coordinatorDeliveries(status, 'other/repo', candidate.branch)).toEqual([])
})
it('rejects malformed status instead of fabricating an empty or successful history', () => {
  expect(() => coordinatorDeliveries({}, candidate.repository, candidate.branch)).toThrow('invalid_delivery_status')
  expect(() => coordinatorDeliveries({ candidates: [{ ...candidate, runId: 'r', taskId: 't', createdAt: '', state: 'unknown' }] }, candidate.repository, candidate.branch)).toThrow('invalid_delivery_state')
})
it('uses only the requested project integration and never falls back to a global credential', async () => {
  const fixtureToken = randomUUID()
  vi.stubEnv('VC_STAND_DELIVERY_PROJECTS', JSON.stringify({ p: { url: 'https://coordinator.test', token: fixtureToken } }))
  expect(standDeliveryIntegration('p')).toEqual({ url: 'https://coordinator.test', token: fixtureToken })
  expect(standDeliveryIntegration('other')).toBeUndefined()
  const fetchImpl = vi.fn<typeof fetch>()
  await expect(new StandDeliveryCoordinator(undefined, fetchImpl).list('other', candidate.repository, candidate.branch)).rejects.toThrow('stand_delivery_unconfigured')
  expect(fetchImpl).not.toHaveBeenCalled()
  vi.stubEnv('VC_STAND_DELIVERY_PROJECTS', '{bad json')
  expect(() => standDeliveryIntegration('p')).toThrow('stand_delivery_configuration_invalid')
})
