import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { loadConfig } from './config.js'
import { buildServer } from './server.js'
import { VoiceChatDb } from './db/database.js'

it.each(['make', 'web-reader', 'image-studio', 'playwright-reader'].flatMap(owner =>
  ['local', 'disabled', 'external'].flatMap(mode =>
    [
      { NODE_ENV: 'development' },
      { NODE_ENV: 'production' },
      { NODE_ENV: 'production', VC_APPLICATION_FRONTENDS_OVERRIDE: '1' },
      { NODE_ENV: 'production', VC_APPLICATION_FRONTENDS_OVERRIDE: '0' },
    ].map(env => ({ owner, mode, env }))
  )
))('selects the frontend for $owner ($mode, $env)', async ({ owner, mode, env }) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'deployment-frontends-'))
  const id = owner + '-ui'
  const applications = mode === 'disabled' ? 'chat'
    : mode === 'external' ? `chat,${owner}=https://owner.example.org` : `chat,${owner}`
  const config = loadConfig({
    ...env, VC_APPLICATIONS: applications, VC_DATA_DIR: dataDir,
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
  const sourceLog = vi.spyOn(console, 'info').mockImplementation(() => {})
  try {
    const response = await app.inject(`/applications/${id}/manifest.json`)
    if (mode === 'local' && (env.NODE_ENV !== 'production' || env.VC_APPLICATION_FRONTENDS_OVERRIDE === '1')) {
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual(manifest)
      expect(sourceLog).toHaveBeenCalledWith('[application-frontend]', JSON.stringify({
        id, source: 'override', version: manifest.version, commit: manifest.commit
      }))
      expect(fetchSource).toHaveBeenCalledTimes(2) // startup manifest and HTTP request
      expect(String(fetchSource.mock.calls[0]?.[0])).toBe('http://127.0.0.1:25284/manifest.json')
    } else {
      expect(fetchSource).not.toHaveBeenCalled()
      expect(response.statusCode).toBe(200)
      const require = createRequire(import.meta.url)
      const pinned = JSON.parse(readFileSync(require.resolve(`@sislexa/${owner}/frontend/manifest.json`), 'utf8'))
      expect(response.json()).toEqual(pinned)
      expect(sourceLog).toHaveBeenCalledWith('[application-frontend]', JSON.stringify({
        id, source: 'pinned', version: pinned.version, commit: pinned.commit
      }))
    }
  } finally {
    sourceLog.mockRestore()
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
