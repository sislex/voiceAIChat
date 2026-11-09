import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { registerAuth } from '@sislexa/identity/server/users/auth'
import { signToken } from '@sislexa/identity/server/users/accounts'
import { VoiceChatDb } from '../db/database.js'
import { ProjectPreviews } from '../makeBridge/projectPreview.js'
import { registerProjectStandPreviewRoutes } from './projectStandPreview.js'
import * as dbSeed from '../test/seed.js'

describe('project stand preview routes', () => {
  let db: VoiceChatDb, app: FastifyInstance, dir: string, projectId: string, secret: string
  const headers = (user: string) => ({ authorization: 'Bearer ' + signToken({ name: user, role: 'developer' }, secret) })
  beforeEach(async () => {
    secret = randomUUID()
    dir = mkdtempSync(join(tmpdir(), 'stand-preview-'))
    db = new VoiceChatDb(join(dir, 'db.sqlite'))
    await db.ready
    for (const name of ['owner', 'member']) await db.identity.createUser(name, '', 'developer')
    projectId = (await db.projects.createProject('owner', { name: 'Piara' })).id
    await dbSeed.addMember(db, 'owner', projectId, 'member')
    app = Fastify()
    await registerAuth(app, db, secret)
    registerProjectStandPreviewRoutes(app, db, new ProjectPreviews({ db, machines: {} as never, gate: async () => ({ allowed: true }), reservedPorts: [28810] }))
  })
  afterEach(async () => { await app?.close(); await db?.close(); rmSync(dir, { recursive: true, force: true }) })

  it('lets only the owner configure a valid preview and members read it', async () => {
    const url = `/api/projects/${projectId}/stand-preview`
    const config = { command: 'npx ng serve --port 4200', port: 4200 }
    expect((await app.inject({ method: 'PUT', url, headers: headers('member'), payload: config })).statusCode).toBe(403)
    expect((await app.inject({ method: 'PUT', url, headers: headers('owner'), payload: { ...config, port: 28810 } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'PUT', url, headers: headers('owner'), payload: config })).json()).toEqual({ config })
    expect((await app.inject({ method: 'GET', url, headers: headers('member') })).json()).toEqual({ config })
    expect((await app.inject({ method: 'PUT', url, headers: { ...headers('owner'), 'content-type': 'application/json' }, payload: 'null' })).json()).toEqual({ config: null })
    expect((await app.inject({ method: 'GET', url, headers: headers('member') })).json()).toEqual({ config: null })
  })
})
