import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { FastifyInstance } from 'fastify'
import { applicationVersionMatches, parseComponentContract, parseComponentConfig,
  COMPONENT_METADATA_PATH, COMPONENT_AUTHORIZE_PATH, COMPONENT_READY_PATH,
  type ApplicationRuntimeMetadata, type ComponentContract, type ComponentConfig } from '@voicechat/shared'
import { readSecret } from './files.js'
import type { ComponentTokenRegistry } from './registry.js'
export type { ComponentTokenRegistry, Authorization } from './registry.js'

export function loadComponentConfiguration(contractFile: string, configFile: string): { contract: ComponentContract; config: ComponentConfig } {
  const contract = parseComponentContract(JSON.parse(readFileSync(contractFile, 'utf8')))
  return { contract, config: parseComponentConfig(JSON.parse(readFileSync(configFile, 'utf8')), contract) }
}
export class DependencyUnavailable extends Error {
  readonly statusCode = 503
  constructor(readonly applicationId: string) { super(`Component dependency unavailable: ${applicationId}`) }
}
export interface ComponentRuntimeOptions {
  contractFile: string
  configFile: string
  metadata: ApplicationRuntimeMetadata
  fetchImpl?: typeof fetch
  now?: () => number
}
export async function createComponentRuntime(options: ComponentRuntimeOptions): Promise<ComponentRuntime> {
  const { contract, config } = loadComponentConfiguration(options.contractFile, options.configFile)
  if (options.metadata.applicationId !== contract.applicationId) throw Error('Component identity does not match its release contract')
  // Legacy desktop imports remain usable on Node 20; only managed providers need Node 22 SQLite.
  const registry = config.registryDirectory ? new (await import('./registry.js')).ComponentTokenRegistry(contract, config, options.now) : undefined
  return new ComponentRuntime(contract, config, options.metadata, registry, options.fetchImpl ?? fetch, options.now ?? Date.now)
}
export class ComponentRuntime {
  private readonly verified = new Map<string, number>()
  constructor(readonly contract: ComponentContract, readonly config: ComponentConfig, readonly metadata: ApplicationRuntimeMetadata,
    readonly registry: ComponentTokenRegistry | undefined, private readonly transport: typeof fetch, private readonly now: () => number) {}
  dependency(id: string, options: { timeoutMs?: number } = {}): { url: string; fetchImpl: typeof fetch; publicFetchImpl: typeof fetch; token: string } {
    const target = this.config.dependencies.find(d => d.applicationId === id)
    if (!target) throw new DependencyUnavailable(id)
    const transport = (serviceCredential: boolean): typeof fetch => async (input, init) => {
      try {
        const request = new Request(input, init)
        const url = new URL(request.url)
        if (url.origin !== target.url || url.username || url.password) throw Error('Dependency origin mismatch')
        const token = readSecret(target.tokenFile)
        await this.verify(id, token)
        const headers = new Headers(request.headers)
        // Public proxies must preserve the user's credential; component grants never replace it.
        if (serviceCredential) headers.set('authorization', `Bearer ${token}`)
        return await this.transport(new Request(request, { headers, redirect: serviceCredential ? 'error' : 'manual', signal: AbortSignal.any([request.signal, AbortSignal.timeout(options.timeoutMs ?? 60000)]) }))
      } catch { throw new DependencyUnavailable(id) }
    }
    return { url: target.url, token: 'managed-by-component-runtime', fetchImpl: transport(true), publicFetchImpl: transport(false) }
  }
  /** Verify the exact grant before a non-fetch transport opens its connection. */
  async connection(id: string): Promise<{ url: string; token: string }> {
    const target = this.config.dependencies.find(d => d.applicationId === id)
    if (!target) throw new DependencyUnavailable(id)
    try {
      const token = readSecret(target.tokenFile)
      await this.verify(id, token)
      return { url: target.url, token }
    } catch { throw new DependencyUnavailable(id) }
  }
  private async verify(id: string, token: string): Promise<void> {
    const target = this.config.dependencies.find(d => d.applicationId === id)!
    const required = this.contract.dependencies.find(d => d.applicationId === id)!
    const key = id + ':' + createHash('sha256').update(token).digest('hex')
    if ((this.verified.get(key) ?? 0) > this.now()) return
    const metadataResponse = await this.transport(target.url + COMPONENT_METADATA_PATH, { redirect: 'error', signal: AbortSignal.timeout(5000) })
    if (!metadataResponse.ok) throw Error('Dependency metadata unavailable')
    const status = await metadataResponse.json() as { application?: ApplicationRuntimeMetadata; environmentId?: string }
    const m = status.application
    if (!m || status.environmentId !== this.config.environmentId || m.applicationId !== id || !m.version || !m.apiVersion || !/^[a-f0-9]{40}$/.test(m.commit ?? '') ||
        !applicationVersionMatches(m.version, required.minVersion, required.maxVersionExclusive) || !applicationVersionMatches(m.apiVersion, required.minApiVersion, required.maxApiVersionExclusive)) throw Error('Incompatible dependency')
    const response = await this.transport(target.url + COMPONENT_AUTHORIZE_PATH, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ scopes: required.scopes }), redirect: 'error', signal: AbortSignal.timeout(5000) })
    if (!response.ok) throw Error('Dependency access denied')
    const authorization = await response.json() as { consumerId?: string; providerId?: string; environmentId?: string; expiresAt?: number }
    if (authorization.consumerId !== this.contract.applicationId || authorization.providerId !== id || authorization.environmentId !== this.config.environmentId || typeof authorization.expiresAt !== 'number' || authorization.expiresAt <= this.now()) throw Error('Wrong dependency grant')
    this.verified.clear()
    this.verified.set(key, Math.min(this.now() + 5000, authorization.expiresAt))
  }
  async readiness(): Promise<{ ok: boolean; dependencies: { applicationId: string; ok: boolean }[] }> {
    const dependencies = await Promise.all(this.config.dependencies.map(async d => {
      try { await this.verify(d.applicationId, readSecret(d.tokenFile)); return { applicationId: d.applicationId, ok: true } }
      catch { return { applicationId: d.applicationId, ok: false } }
    }))
    return { ok: dependencies.every(d => d.ok), dependencies }
  }
  register(app: FastifyInstance): void {
    app.get(COMPONENT_METADATA_PATH, async () => ({ application: this.metadata, environmentId: this.config.environmentId }))
    app.post<{ Body: { scopes?: unknown } }>(COMPONENT_AUTHORIZE_PATH, { bodyLimit: 16384 }, async (req, reply) => {
      const scopes = req.body?.scopes
      if (!Array.isArray(scopes) || scopes.length > 128 || !scopes.every(s => typeof s === 'string' && this.contract.provides.includes(s))) return reply.code(400).send({ error: 'invalid_scopes' })
      const result = this.registry?.authorize(req.headers.authorization, scopes)
      if (!result?.ok) return reply.code(result?.status ?? 401).send({ error: 'component_access_denied' })
      return result.principal
    })
    app.get(COMPONENT_READY_PATH, async (_req, reply) => { const status = await this.readiness(); return reply.code(status.ok ? 200 : 503).send(status) })
    app.addHook('onClose', async () => this.close())
  }
  authorize(header: string | undefined, scope: string): { ok: true } | { ok: false; status: 401 | 403 } {
    return this.registry?.authorize(header, [scope]) ?? { ok: false, status: 401 }
  }
  close(): void { this.registry?.close() }
}
