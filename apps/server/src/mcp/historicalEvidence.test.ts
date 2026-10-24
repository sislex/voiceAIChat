import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import Fastify from 'fastify'
import { HistoricalEvidence, type HistoricalEvidenceGrant } from './historicalEvidence.js'
import { registerRemoteBashMcp } from './remoteBashMcp.js'
import type { MachinesService } from '../machines/service.js'

const commandId = 'c8855c44-89ff-4716-878d-5f8fb2126681'
const secondId = '020ee9a2-c0ef-44af-96cc-0a75a0e6508b'
// Synthetic bytes only; neither historical claim is treated as observed evidence.
const original = Buffer.from('private synthetic journal\r\nsecret=test-only\n\u0000', 'utf8')
const digest = createHash('sha256').update(original).digest('hex')
const context = { token: 'existing-run-capability', projectId: 'project', agentId: 'm1', cwd: '/task' }

function fixture() {
  const grant: HistoricalEvidenceGrant = {
    userId: 'user', projectId: 'project', taskId: 'task', runId: 'run',
    agentId: 'm1', cwd: '/task', expiresAt: 2000,
    journals: [
      { commandId, sourceId: 'private-source-one', expectedSha256: digest },
      { commandId: secondId, sourceId: 'private-source-two', expectedSha256: '0'.repeat(64) }
    ]
  }
  const resolveRun = vi.fn(async (token: string): Promise<HistoricalEvidenceGrant | undefined> =>
    token === context.token ? grant : undefined)
  const readJournal = vi.fn(async (): Promise<AsyncIterable<Uint8Array> | undefined> => (async function* () {
    yield original.subarray(0, 9)
    yield original.subarray(9)
  })())
  const canAccess = vi.fn(async () => true)
  const service = new HistoricalEvidence({ resolveRun, readJournal }, canAccess, () => 1000)
  return { service, grant, resolveRun, readJournal, canAccess }
}

describe('scoped historical evidence', () => {
  it('hashes exact bytes, records a mismatch, and never discloses content or source identifiers', async () => {
    const f = fixture()
    const match = await f.service.verify(context, commandId)
    expect(match).toMatchObject({ status: 'verified', sha256: digest, matches: true, bytes: original.length, runId: 'run' })
    const mismatch = await f.service.verify(context, secondId)
    expect(mismatch).toMatchObject({ status: 'verified', sha256: digest, matches: false })
    expect(JSON.stringify([match, mismatch])).not.toMatch(/private|secret|existing-run-capability/)
    expect(f.canAccess).toHaveBeenCalledWith('user', 'project')
  })

  it.each([
    { token: undefined }, { token: 'other-run' }, { projectId: 'other-project' },
    { agentId: 'other-machine' }, { cwd: '/other-task' }
  ])('denies context mismatch %j before reading', async patch => {
    const f = fixture()
    expect(await f.service.verify({ ...context, ...patch }, commandId)).toEqual({ status: 'denied' })
    expect(f.readJournal).not.toHaveBeenCalled()
  })

  it.each(['../secret', '11111111-1111-4111-8111-111111111111'])('rejects ungranted command %s', async id => {
    const f = fixture()
    expect(await f.service.verify(context, id)).toEqual({ status: 'denied' })
    expect(f.readJournal).not.toHaveBeenCalled()
  })

  it('denies expiry and lost project membership', async () => {
    const f = fixture()
    f.grant.expiresAt = 1000
    expect(await f.service.verify(context, commandId)).toEqual({ status: 'denied' })
    f.grant.expiresAt = 2000
    f.canAccess.mockResolvedValue(false)
    expect(await f.service.verify(context, commandId)).toEqual({ status: 'denied' })
    expect(f.readJournal).not.toHaveBeenCalled()
  })

  it('rejects duplicate journal grants', async () => {
    const f = fixture()
    f.grant.journals = [...f.grant.journals, f.grant.journals[0]]
    expect(await f.service.verify(context, commandId)).toEqual({ status: 'denied' })
    expect(f.readJournal).not.toHaveBeenCalled()
  })

  it('withholds the digest when the run is revoked during reading', async () => {
    const f = fixture()
    f.resolveRun.mockResolvedValueOnce(f.grant).mockResolvedValueOnce(undefined)
    expect(await f.service.verify(context, commandId)).toEqual({ status: 'denied' })
  })

  it('withholds the digest if project membership is revoked during reading', async () => {
    const f = fixture()
    f.canAccess.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    expect(await f.service.verify(context, commandId)).toEqual({ status: 'denied' })
  })

  it('withholds the digest if the source binding changes during reading', async () => {
    const f = fixture()
    f.readJournal.mockImplementationOnce(async () => {
      f.grant.journals = [{ commandId, sourceId: 'replacement', expectedSha256: digest }]
      return (async function* () { yield original })()
    })
    expect(await f.service.verify(context, commandId)).toEqual({ status: 'denied' })
  })

  it('reports unavailable sources and suppresses private adapter errors and partial bytes', async () => {
    const f = fixture()
    f.readJournal.mockResolvedValueOnce(undefined)
    expect(await f.service.verify(context, commandId)).toEqual({ status: 'source_unavailable' })
    f.readJournal.mockResolvedValueOnce((async function* () {
      yield original
      throw new Error('/private/credentials secret=test-only')
    })())
    expect(await f.service.verify(context, commandId)).toEqual({ status: 'source_unavailable' })
  })

  it('bounds source size and closes the iterator', async () => {
    const f = fixture()
    let closed = false
    f.readJournal.mockResolvedValueOnce((async function* () {
      try { yield new Uint8Array(8 * 1024 * 1024 + 1) } finally { closed = true }
    })())
    expect(await f.service.verify(context, commandId)).toEqual({ status: 'source_too_large' })
    expect(closed).toBe(true)
  })
})

describe('historical evidence MCP', () => {
  it('requires the existing bridge secret plus scoped authority; never uses machine filesystem or shell', async () => {
    const f = fixture()
    const app = Fastify()
    const exec = vi.fn()
    const fsRead = vi.fn()
    registerRemoteBashMcp(app, { exec, fsRead } as unknown as MachinesService, 'bridge-secret',
      undefined, undefined, undefined, undefined, f.service)
    const invoke = (query: string, args: object = { commandId }) => app.inject({
      method: 'POST', url: '/mcp/remote-bash?' + query,
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'historical_evidence_verify', arguments: args } }
    })
    try {
      expect((await invoke('k=wrong')).statusCode).toBe(403)
      expect(f.resolveRun).not.toHaveBeenCalled()
      const query = 'k=bridge-secret&agent=m1&project=project&cwd=/task'
      expect((await invoke(query)).json().result.isError).toBe(true)
      expect(f.readJournal).not.toHaveBeenCalled()
      const response = (await invoke(query + '&evidence=existing-run-capability')).json().result
      expect(response.isError).toBe(false)
      expect(JSON.parse(response.content[0].text)).toMatchObject({ sha256: digest, matches: true })
      const mismatch = (await invoke(query + '&evidence=existing-run-capability', { commandId: secondId })).json().result
      expect(mismatch.isError).toBe(true)
      expect(JSON.parse(mismatch.content[0].text)).toMatchObject({ matches: false })
      expect(exec).not.toHaveBeenCalled()
      expect(fsRead).not.toHaveBeenCalled()
    } finally { await app.close() }
  })

  it('fails closed when no source adapter is commissioned', async () => {
    const app = Fastify()
    registerRemoteBashMcp(app, {} as MachinesService, 'bridge-secret')
    try {
      const response = await app.inject({
        method: 'POST', url: '/mcp/remote-bash?k=bridge-secret',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        payload: { jsonrpc: '2.0', id: 1, method: 'tools/call',
          params: { name: 'historical_evidence_verify', arguments: { commandId } } }
      })
      expect(JSON.parse(response.json().result.content[0].text)).toEqual({ status: 'source_unavailable' })
    } finally { await app.close() }
  })
})
