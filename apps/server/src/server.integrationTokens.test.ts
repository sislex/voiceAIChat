import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { signToken } from '@sislexa/identity/server/users/accounts'
import { VoiceChatDb } from './db/database.js'
import { buildServer } from './server.js'
import { loadConfig } from './config.js'

it('composes token management, internal whoami and global route denial in Core', async () => {
  const dir = mkdtempSync(join(process.env.DELIVERY_ATTEMPT_ROOT ? join(process.env.DELIVERY_ATTEMPT_ROOT, 'tmp') : process.cwd(), 'core-tokens-'))
  const sessionSecret = randomUUID()
  const serviceToken = randomUUID()
  const db = new VoiceChatDb(':memory:')
  let app: Awaited<ReturnType<typeof buildServer>> | undefined
  try {
    await db.ready
    await db.identity.createUser('owner', '', 'developer')
    const project = await db.projects.createProject('owner', { name: 'Project' })
    app = await buildServer({ db, config: loadConfig({ VC_DATA_DIR: dir, VC_INTERNAL_TOKEN: serviceToken }), sessionSecret: sessionSecret })
    const created = await app.inject({ method: 'POST', url: `/api/projects/${project.id}/integration-tokens`,
      headers: { authorization: 'Bearer ' + signToken({ name: 'owner', role: 'developer' }, sessionSecret) },
      payload: { name: 'Sync', scopes: ['tasks:external'] } })
    expect(created.statusCode).toBe(201)
    const authorization = 'Bearer ' + created.json().token
    const whoami = await app.inject({ method: 'POST', url: '/internal/whoami', headers: { authorization: 'Bearer ' + serviceToken },
      payload: { method: 'PUT', url: '/external-task', headers: { authorization } } })
    expect(whoami.json()).toEqual({ ok: true, principal: { kind: 'integration', projectId: project.id, projectIds: [project.id], scopes: ['tasks:external'] } })
    for (const url of ['/', '/api/health', '/api/projects', '/ws', '/mcp/bash', '/missing']) {
      expect((await app.inject({ url, headers: { authorization } })).statusCode).toBe(403)
    }
  } finally {
    await app?.close()
    await db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
