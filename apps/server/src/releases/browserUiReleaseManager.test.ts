import { afterEach, describe, expect, it, vi } from 'vitest'
import { VoiceChatDb } from '../db/database.js'
import { BrowserUiReleaseCatalog, BrowserUiReleaseManager, type BrowserUiReleaseRuntime } from './browserUiReleaseManager.js'

const databases: VoiceChatDb[] = []
afterEach(async () => {
  for (const db of databases.splice(0)) await db.close()
})

function github(commit = 'a'.repeat(40), archive = Buffer.from('tgz')) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer token')
    if (url.endsWith('/releases?per_page=30')) return new Response(JSON.stringify([{
      tag_name: 'v1.2.3', draft: false, prerelease: false, published_at: '2026-09-22T00:00:00Z',
      assets: [{ id: 7, name: `sislexa-core-ui-browser-1.2.3-${commit.slice(0, 12)}.tgz`, size: archive.length, url: 'https://api.github.test/assets/7' }]
    }]))
    if (url.includes('/git/ref/tags/')) return new Response(JSON.stringify({ object: { type: 'commit', sha: commit } }))
    if (url === 'https://api.github.test/assets/7') return new Response(archive)
    return new Response('', { status: 404 })
  })
}

async function setup() {
  const db = new VoiceChatDb(':memory:')
  databases.push(db)
  await db.ready
  await db.identity.createUser('owner', '', 'developer')
  const project = await db.projects.createProject('owner', { name: 'browser releases' })
  const commit = 'a'.repeat(40), id = `1.2.3-${commit}`
  const inspection = { runtime: { schemaVersion: 1 as const, coreApi: '1.1.0', applicationHost: '1.1.0', active: id, generation: 'g1', configuredGeneration: 'g1' }, activation: null, installed: [] }
  const runtime: BrowserUiReleaseRuntime = {
    write: vi.fn(async () => ({})),
    remove: vi.fn(async () => ({})),
    exec: vi.fn(async (_target, command) => command.includes('BROWSER_UI_RESULT=')
      ? { exitCode: 0, output: `BROWSER_UI_RESULT=${JSON.stringify({ inspection, coreContainerUnchanged: true })}` }
      : { exitCode: 0, output: JSON.stringify(inspection) })
  }
  const manager = new BrowserUiReleaseManager(db, runtime, new BrowserUiReleaseCatalog('token', github()))
  const target = { projectId: project.id, agentId: 'prod', path: '/srv/core', gitUrl: 'git', baseBranch: 'main', testCommand: 'gate', prepareCheckout: false }
  return { db, project, runtime, manager, target, id }
}

describe('browser UI release center', () => {
  it('lists only the exact asset for a signed release tag', async () => {
    const fetchImpl = github()
    const releases = await new BrowserUiReleaseCatalog('token', fetchImpl).list()
    expect(releases).toEqual([expect.objectContaining({ version: '1.2.3', commit: 'a'.repeat(40), size: 3 })])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('uploads, activates and audits an immutable release idempotently', async () => {
    const { db, project, runtime, manager, target, id } = await setup()
    const input = { requestId: 'request_123', action: 'install' as const, version: '1.2.3' }
    const first = await manager.act('owner', project.id, target, input)
    const second = await manager.act('owner', project.id, target, input)
    expect(first).toMatchObject({ status: 'succeeded', releaseId: id, coreContainerUnchanged: true })
    expect(second.id).toBe(first.id)
    expect(runtime.write).toHaveBeenCalledTimes(1)
    expect(runtime.remove).toHaveBeenCalledTimes(1)
    expect((await db.releases.browserUiReleaseOperations('owner', project.id))).toHaveLength(1)
  })

  it('records a failed operation without claiming that Core stayed unchanged', async () => {
    const { db, project, runtime, manager, target } = await setup()
    vi.mocked(runtime.exec).mockResolvedValueOnce({ exitCode: 1, output: 'compatibility rejected' })
    const result = await manager.act('owner', project.id, target, { requestId: 'request_456', action: 'rollback' })
    expect(result).toMatchObject({ status: 'failed', coreContainerUnchanged: null })
    expect(result.log).toContain('compatibility rejected')
    expect((await db.releases.browserUiReleaseOperations('owner', project.id))[0].status).toBe('failed')
  })
})
