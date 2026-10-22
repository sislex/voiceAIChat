import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { loadConfig } from './config.js'
import { buildServer } from './server.js'
import { VoiceChatDb } from './db/database.js'

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
