import { afterEach, expect, it, vi } from 'vitest'
import { createCiRest } from './httpApi'
import { setToken, setCsrf } from './session'
import { queuedMergeRun } from '../test/fixtures/queuedMerge'

afterEach(() => { vi.unstubAllGlobals(); setToken(null); setCsrf(null) })

// @testCase TC-API-01
it.each([200, 409, 422])('the common web/desktop bridge preserves the structured %i response', async status => {
  const result = status === 200 ? { ok: true, run: { ...queuedMergeRun, agentId: 'machine-b', assignmentVersion: 1 } }
    : status === 409 ? { ok: false, code: 'assignment_changed', error: 'Changed', run: queuedMergeRun }
    : { ok: false, code: 'readiness_failed', error: 'Offline' }
  const fetcher = vi.fn(async () => new Response(JSON.stringify(result), { status }))
  vi.stubGlobal('fetch', fetcher)
  setToken('test-only'); setCsrf('test-csrf')
  const input = { agentId: 'machine-b', expectedAssignmentVersion: 0 }
  expect(await createCiRest('https://server.example').changeMergeMachine('run/1', input)).toEqual(result)
  expect(fetcher).toHaveBeenCalledWith('https://server.example/api/merge/runs/run%2F1/machine', {
    method: 'POST', headers: { authorization: 'Bearer test-only', 'x-vc-csrf': 'test-csrf', 'content-type': 'application/json' },
    body: JSON.stringify(input), credentials: 'include'
  })
})

// @testCase TC-API-01
it('does not silently treat an unstructured server error as a snapshot', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'unavailable' }), { status: 503 })))
  await expect(createCiRest('').changeMergeMachine('r', { agentId: 'b', expectedAssignmentVersion: 0 })).rejects.toThrow('Сервис временно недоступен.')
})
