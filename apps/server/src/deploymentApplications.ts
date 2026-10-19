import type { ApplicationId, DeploymentManifest, SessionUser } from '@voicechat/shared'
import type { FastifyInstance } from 'fastify'
import { MAKE_PROXY_PREFIXES } from './makeBridge/proxy.js'
import { KANBAN_PROXY_PREFIXES } from './kanbanBridge/proxy.js'

export function localApplication(manifest: DeploymentManifest, id: ApplicationId): boolean {
  return manifest.applications.some(a => a.id === id && a.enabled && a.location === 'local')
}
export function effectiveUser(user: SessionUser, manifest: DeploymentManifest): SessionUser {
  if (!user.account) return user
  return { ...user, account: { ...user.account, capabilities: effectiveCapabilities(user.account.capabilities, manifest) } }
}
export function effectiveCapabilities<T extends string>(capabilities: T[], manifest: DeploymentManifest): T[] {
  return capabilities.filter(capability => {
    const id = capability.startsWith('voice.') ? 'chat' : capability.split('.')[0]
    const application = manifest.applications.find(a => a.id === id)
    return !application || application.enabled
  })
}
const prefixes: Partial<Record<ApplicationId, readonly string[]>> = {
  make: [...MAKE_PROXY_PREFIXES, '/mcp/make', '/make'],
  projects: [...KANBAN_PROXY_PREFIXES, '/projects'],
  'web-reader': ['/api/preview', '/mcp/preview', '/web-recorder'],
  'playwright-reader': ['/api/browser', '/playwright-reader'],
  'image-studio': ['/api/image-studio', '/mcp/image-studio', '/g', '/image-studio'],
}
export function registerDeploymentApplications(app: FastifyInstance, manifest: DeploymentManifest): void {
  // Longest prefix wins: Make previews remain available without Web Reader.
  const routes = Object.entries(prefixes).flatMap(([id, values]) => values.map(prefix => ({ id: id as ApplicationId, prefix })))
    .sort((a, b) => b.prefix.length - a.prefix.length)
  app.addHook('onRequest', async (req, reply) => {
    const path = new URL(req.url, 'http://core').pathname
    const frontend = /^\/applications\/([^/]+)(?:\/|$)/.exec(path)
    if (frontend && manifest.applications.some(a => a.id === frontend[1]) && !localApplication(manifest, frontend[1] as ApplicationId)) {
      return reply.code(404).send({ error: 'application_disabled' })
    }
    const route = routes.find(({ prefix }) => path === prefix || path.startsWith(prefix + '/'))
    if (route && !localApplication(manifest, route.id)) return reply.code(404).send({ error: 'application_disabled' })
  })
  app.get('/api/system/applications', async (_, reply) => {
    reply.header('cache-control', 'no-store')
    return manifest
  })
}
export function enabledMcp(name: string, manifest: DeploymentManifest): boolean {
  const owners: Record<string, ApplicationId> = {
    make: 'make', kanban: 'projects', 'ci-commands': 'projects', browser: 'web-reader',
    preview: 'web-reader', 'image-studio': 'image-studio', 'playwright-reader': 'playwright-reader',
  }
  const id = owners[name]
  return !id || localApplication(manifest, id)
}
