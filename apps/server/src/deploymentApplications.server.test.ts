import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { loadConfig } from './config.js'
import { buildServer } from './server.js'
import { VoiceChatDb } from './db/database.js'

it.each(['make', 'web-reader', 'image-studio', 'playwright-reader'].flatMap(owner =>
  ['local', 'disabled', 'external'].map(mode => ({ owner, mode }))
))('uses the frontend source for $owner only when $mode is local', async ({ owner, mode }) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'deployment-frontends-'))
  const id = owner + '-ui'
  const applications = mode === 'disabled' ? 'chat'
    : mode === 'external' ? `chat,${owner}=https://owner.example.org` : `chat,${owner}`
  const config = loadConfig({
    VC_APPLICATIONS: applications, VC_DATA_DIR: dataDir,
    VC_APPLICATION_FRONTENDS: JSON.stringify({ [id]: 'http://127.0.0.1:25284' }),
    VC_INTERNAL_TOKEN: 'test-internal', VC_MCP_SECRET: 'test-mcp',
  })
  const manifest = {
    schemaVersion: 1, applicationId: id, version: '9.8.7', apiVersion: '1.0.0',
    commit: 'a'.repeat(40),
    host: { minVersion: '1.0.0', maxVersionExclusive: '2.0.0' },
    entry: { path: 'panel-local.js', integrity: 'sha384-' + 'a'.repeat(64) },
    styles: [],
  }
  const fetchSource = vi.fn(async (_url: string | URL | Request, _options?: RequestInit) => new Response(JSON.stringify(manifest)))
  const db = new VoiceChatDb(':memory:')
  const app = await buildServer({ config, db })
  vi.stubGlobal('fetch', fetchSource)
  try {
    const response = await app.inject(`/applications/${id}/manifest.json`)
    if (mode === 'local') {
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual(manifest)
      expect(fetchSource).toHaveBeenCalledOnce()
      expect(String(fetchSource.mock.calls[0]?.[0])).toBe('http://127.0.0.1:25284/manifest.json')
    } else {
      expect(fetchSource).not.toHaveBeenCalled()
      expect(response.body).not.toContain('9.8.7')
    }
  } finally {
    vi.unstubAllGlobals()
    await app.close()
    await db.close()
    rmSync(dataDir, { recursive: true, force: true })
  }
})

it.each(['chat', 'chat,make', 'chat,make=https://make.example.org', 'chat,web-reader,projects'])('boots Core with %s and no disabled owner routes', async applications => {
  const dataDir = mkdtempSync(join(tmpdir(), 'deployment-core-'))
  const config = loadConfig({ VC_APPLICATIONS: applications, VC_DATA_DIR: dataDir, VC_CORE_ID: 'test-core',
    VC_KANBAN_MODE: 'remote', VC_KANBAN_URL: 'http://kanban', VC_INTERNAL_TOKEN: 'test-internal', VC_MCP_SECRET: 'test-mcp',
  })
  const db = new VoiceChatDb(':memory:')
  const app = await buildServer({ config, db })
  try {
    expect((await app.inject('/api/health')).statusCode).toBe(200)
    for (const url of ['/api/image-studio', '/api/browser/status', '/mcp/image-studio']) {
      const response = await app.inject(url)
      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ error: 'application_disabled' })
    }
    expect(app.hasRoute({ method: 'POST', url: '/mcp/make' })).toBe(applications === 'chat,make')
    expect(app.hasRoute({ method: 'POST', url: '/mcp/preview' })).toBe(applications.includes('web-reader'))
    expect(app.hasRoute({ method: 'GET', url: '/mcp/kanban' })).toBe(applications.includes('projects'))
  } finally {
    await app.close()
    await db.close()
    rmSync(dataDir, { recursive: true, force: true })
  }
})
