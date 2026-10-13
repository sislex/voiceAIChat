import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { STAND_DELIVERY_ERROR_CODES } from '@voicechat/shared'
import { coordinatorDeliveries, StandDeliveryCoordinator, standDeliveryIntegration } from './standDeliveryCoordinator.js'

afterEach(() => vi.unstubAllEnvs())
const candidate = { repository: 'sislex/core-ui', branch: 'make/test', targetBranch: 'dev', headSha: 'a'.repeat(40), title: 'Change', author: 'alice' }
const integration = () => ({ url: 'https://coordinator.test', token: randomUUID() })
const submitCandidate = { ...candidate, targetBranch: 'dev' as const }

it.each(STAND_DELIVERY_ERROR_CODES)('accepts public refusal %s', async error => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error }), { status: 400 }))
  await expect(new StandDeliveryCoordinator(integration, fetchImpl).submit('p', submitCandidate))
    .rejects.toMatchObject({ statusCode: 400, message: error })
})

it('keeps interrupted response bodies generic', async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { controller.error(new Error('private upstream diagnostics')) }
  })
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(stream, { status: 409 }))
  await expect(new StandDeliveryCoordinator(integration, fetchImpl).submit('p', submitCandidate))
    .rejects.toMatchObject({ statusCode: 409, message: 'stand_delivery_request_failed' })
})

it.each([400, 403, 409, 503])('passes an allow-listed refusal with coordinator status %i', async status => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: 'branch_patch_empty_or_large' }), { status }))
  await expect(new StandDeliveryCoordinator(integration, fetchImpl).submit('p', submitCandidate))
    .rejects.toMatchObject({ statusCode: status, message: 'branch_patch_empty_or_large' })
})

it.each([
  { status: 400, body: { error: 'unknown_code' }, expectedStatus: 502 },
  { status: 409, body: { error: 'unknown_code' }, expectedStatus: 409 },
  { status: 403, body: { error: 'branch_patch_empty_or_large', diagnostics: 'private upstream data' }, expectedStatus: 502 },
  { status: 500, body: { error: 'branch_patch_empty_or_large' }, expectedStatus: 502 },
  { status: 400, body: { error: 123 }, expectedStatus: 502 },
  { status: 400, body: null, expectedStatus: 502 },
  { status: 400, body: ['branch_patch_empty_or_large'], expectedStatus: 502 }
])('keeps unsafe refusal $status / $body generic', async ({ status, body, expectedStatus }) => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body), { status }))
  await expect(new StandDeliveryCoordinator(integration, fetchImpl).submit('p', submitCandidate))
    .rejects.toMatchObject({ statusCode: expectedStatus, message: 'stand_delivery_request_failed' })
})

it.each(['', '{invalid JSON'])('keeps malformed body %j generic', async body => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status: 400 }))
  await expect(new StandDeliveryCoordinator(integration, fetchImpl).submit('p', submitCandidate))
    .rejects.toMatchObject({ statusCode: 502, message: 'stand_delivery_request_failed' })
})

it('stops reading at 4 KiB and cancels the remainder even with a valid error prefix', async () => {
  let reads = 0
  const cancel = vi.fn()
  const prefix = JSON.stringify({ error: 'branch_patch_empty_or_large' })
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      reads++
      controller.enqueue(new TextEncoder().encode(reads === 1 ? prefix.padEnd(1024) : ' '.repeat(1024)))
    }, cancel
  }, { highWaterMark: 0 })
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(stream, { status: 400 }))
  await expect(new StandDeliveryCoordinator(integration, fetchImpl).submit('p', submitCandidate))
    .rejects.toMatchObject({ statusCode: 502, message: 'stand_delivery_request_failed' })
  expect(reads).toBe(4)
  expect(cancel).toHaveBeenCalledTimes(1)
})

it('rejects a single oversized chunk without reading another', async () => {
  const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
    controller.enqueue(new TextEncoder().encode(JSON.stringify({ error: 'branch_patch_empty_or_large' }).padEnd(8192)))
  })
  const cancel = vi.fn()
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream({ pull, cancel }, { highWaterMark: 0 }), { status: 400 }))
  await expect(new StandDeliveryCoordinator(integration, fetchImpl).submit('p', submitCandidate))
    .rejects.toThrow('stand_delivery_request_failed')
  expect(pull).toHaveBeenCalledTimes(1)
  expect(cancel).toHaveBeenCalledTimes(1)
})

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
