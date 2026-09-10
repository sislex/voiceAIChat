import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { INTERNAL_IMAGE_STUDIO_SERVICE_PATH } from '@voicechat/shared'
import { buildImageStudioServer } from './server.js'
import { loadImageStudioStandaloneConfig } from './config.js'
import { fakeCore } from '../test/fakeCore.js'

let app: FastifyInstance | undefined
let dir: string | undefined
afterEach(async () => { await app?.close(); if (dir) rmSync(dir, { recursive: true, force: true }) })

it('не запускает standalone без секрета внутреннего API', async () => {
  await expect(buildImageStudioServer({ config: loadImageStudioStandaloneConfig({}) })).rejects.toThrow('VC_INTERNAL_TOKEN')
})

it('без ядра закрывает приватный API, но оставляет здоровье и публичную маршрутизацию', async () => {
  dir = mkdtempSync(join(tmpdir(), 'studio-auth-'))
  app = (await buildImageStudioServer({ config: loadImageStudioStandaloneConfig({ VC_DATA_DIR: dir, VC_INTERNAL_TOKEN: 'internal' }),
    core: fakeCore().core, fetchImpl: async () => { throw new Error('core offline') } })).app
  const response = await app.inject({ url: '/api/image-studio/x/files' })
  expect(response.statusCode).toBe(503)
  expect(response.json()).toEqual({ error: 'core_unavailable' })
  expect((await app.inject('/v1/health')).json()).toMatchObject({ ok: true, service: 'image-studio', version: null, application: { applicationId: 'image-studio', version: null } })
  expect((await app.inject('/g/missing/')).statusCode).toBe(404)
  const badMethod = await app.inject({ method: 'POST', url: INTERNAL_IMAGE_STUDIO_SERVICE_PATH,
    headers: { authorization: 'Bearer internal' }, payload: { method: 'constructor', args: [] } })
  expect(badMethod.statusCode).toBe(400)
})
