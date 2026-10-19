import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { parseApplications, type SessionUser } from '@voicechat/shared'
import { loadConfig } from './config.js'
import { effectiveCapabilities, effectiveUser, enabledMcp, registerDeploymentApplications } from './deploymentApplications.js'
import { registerApplicationTickets } from './routes/applicationTickets.js'
import { disabledMake, disabledPlaywrightReader } from './disabledApplications.js'

describe('deployment application matrix', () => {
  it.each([
    ['chat', 'off', 'off', 'off'],
    ['chat,make', 'embedded', 'off', 'off'],
    ['chat,make=https://make.example.org', 'off', 'off', 'off'],
    ['chat,web-reader,projects', 'off', 'embedded', 'remote'],
  ])('%s selects only local modules', (applications, make, reader, projects) => {
    const config = loadConfig({ VC_APPLICATIONS: applications, VC_CORE_ID: 'core-a', VC_KANBAN_MODE: 'remote' })
    expect(config.makeMode).toBe(make)
    expect(config.readerMode).toBe(reader)
    expect(config.kanbanMode).toBe(projects)
    expect(config.imageStudioMode).toBe('off')
    expect(config.playwrightReaderMode).toBe('off')
    expect(config.deployment).toEqual({ coreId: 'core-a', applications: parseApplications(applications) })
  })
  it('preserves legacy defaults and accepts explicit off modes', () => {
    expect(loadConfig({})).toMatchObject({ makeMode: 'embedded', readerMode: 'embedded', kanbanMode: 'off' })
    expect(loadConfig({ VC_MAKE_MODE: 'off', VC_READER_MODE: 'off', VC_IMAGE_STUDIO_MODE: 'off', VC_PLAYWRIGHT_READER_MODE: 'off' }))
      .toMatchObject({ makeMode: 'off', readerMode: 'off', imageStudioMode: 'off', playwrightReaderMode: 'off' })
    expect(() => loadConfig({ VC_CORE_ID: 'bad id' })).toThrow('invalid_core_id')
    expect(() => loadConfig({ VC_APPLICATIONS: 'unknown' })).toThrow('invalid_applications')
  })
  it('intersects capabilities without adding tenant permissions or mutating the account', () => {
    const manifest = { coreId: 'core-a', applications: parseApplications('chat,make=https://make.example.org') }
    const user: SessionUser = { name: 'alice', role: 'admin', account: {
      tenantId: 'tenant', tenantKind: 'personal', membershipRole: 'owner', tariffId: 'test', tariffRevision: 1,
      capabilities: ['chat.use', 'voice.stt', 'make.use', 'projects.use'],
    } }
    expect(effectiveUser(user, manifest).account?.capabilities).toEqual(['chat.use', 'voice.stt', 'make.use'])
    expect(user.account?.capabilities).toContain('projects.use')
    expect(effectiveCapabilities(['voice.stt', 'voice.tts', 'chat.use'], { ...manifest, applications: parseApplications('make') })).toEqual([])
    expect(enabledMcp('make', manifest)).toBe(false)
    expect(enabledMcp('browser', manifest)).toBe(false)
    expect(enabledMcp('history', manifest)).toBe(true)
  })
  it('returns disabled before authentication and preserves external ticket entry', async () => {
    const app = Fastify()
    const manifest = { coreId: 'core-a', applications: parseApplications('chat,make=https://make.example.org') }
    registerDeploymentApplications(app, manifest)
    app.addHook('preHandler', async req => { req.user = { name: 'alice', role: 'admin' } })
    registerApplicationTickets(app, { manifest, credentials: { make: 'service-secret' } })
    app.get('/api/make/files', async () => { throw new Error('must not proxy') })
    try {
      for (const url of ['/api/make/files', '/api/preview/make/test', '/api/projects/test', '/api/browser/status', '/api/image-studio', '/mcp/preview', '/make', '/applications/make/index.js']) {
        const response = await app.inject(url)
        expect(response.statusCode).toBe(404)
        expect(response.json()).toEqual({ error: 'application_disabled' })
      }
      expect((await app.inject('/api/system/applications')).json()).toEqual(manifest)
      const issued = await app.inject({ method: 'POST', url: '/api/applications/make/enter' })
      expect(issued.statusCode).toBe(200)
      expect(new URL(issued.json().url).origin).toBe('https://make.example.org')
    } finally { await app.close() }
  })
  it('keeps local Make preview independent of Web Reader', async () => {
    const app = Fastify()
    registerDeploymentApplications(app, { coreId: 'core-a', applications: parseApplications('chat,make') })
    app.get('/api/preview/make/:id', async () => ({ ok: true }))
    try { expect((await app.inject('/api/preview/make/test')).json()).toEqual({ ok: true }) }
    finally { await app.close() }
  })
  it('disabled adapters never provide MCP sources or execute browser work', async () => {
    const make = disabledMake().service
    expect(await make.promptContext('conversation')).toBe('')
    expect(await make.listFiles('conversation')).toEqual([])
    expect((await make.adminStats()).projects).toBe(0)
    await expect(disabledPlaywrightReader.screenshot('alice', 'conversation', {})).rejects.toThrow('application_disabled')
  })
})
