import type { VoiceChatDb } from '../db/database.js'
import type { EnvironmentLink, EnvironmentLinkInput } from '../db/repos/environments.js'
import type { AgentRegistry } from './registry.js'

const LINK_AUTHORIZATION_TTL_MS = 5_000

/** Persistent server-owned links. The database, never an RPC client, authorizes traffic. */
export class LinkManager {
  private tail: Promise<unknown> = Promise.resolve()
  private unsubscribe?: () => void
  private stopped = false
  private readonly owned = new Set<string>()

  constructor(private readonly repo: VoiceChatDb['environments'], private readonly agents: AgentRegistry, private readonly report: (error: unknown) => void = () => {}, private readonly now: () => number = Date.now) {}

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work)
    this.tail = result.catch(this.report)
    return result
  }

  async start(): Promise<void> {
    this.stopped = false
    this.unsubscribe = this.agents.onChange(() => { void this.reconcile().catch(this.report) })
    await this.reconcile()
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.unsubscribe?.()
    for (const id of this.owned) this.agents.closeTunnel(id)
    await this.tail
    for (const id of this.owned) await this.repo.setLinkState(id, 'down')
    this.owned.clear()
  }

  private checkVersions(input: EnvironmentLinkInput): void {
    for (const machine of [input.clientMachineId, input.serverMachineId]) {
      const version = this.agents.versionOf(machine)
      const match = version?.match(/^(\d+)\.(\d+)\.(\d+)(?:\+.*)?$/)
      if (!match || !(Number(match[1]) > 0 || Number(match[2]) >= 21)) throw new Error('Agent 0.21.0 or newer is required')
    }
  }

  ensureLink(input: EnvironmentLinkInput): Promise<EnvironmentLink> {
    return this.serialize(async () => {
      if (this.stopped) throw new Error('Link manager stopped')
      if (!input) throw new Error('Invalid environment link')
      this.checkVersions(input)
      const link = await this.repo.ensureLink(input)
      await this.open(link)
      return (await this.repo.listLinks(input.projectId, input.environmentId)).find(row => row.id === link.id)!
    })
  }

  deleteLink(projectId: string, environmentId: string, id: string): Promise<void> {
    this.requireScope(projectId, environmentId)
    return this.serialize(async () => {
      const link = (await this.repo.listLinks(projectId, environmentId)).find(row => row.id === id)
      if (!link) return
      await this.repo.deleteLink(projectId, environmentId, id)
      this.agents.closeTunnel(id)
      this.owned.delete(id)
      this.authorized.delete(id)
    })
  }

  listLinks(projectId: string, environmentId: string): Promise<EnvironmentLink[]> {
    this.requireScope(projectId, environmentId)
    return this.repo.listLinks(projectId, environmentId)
  }

  private requireScope(projectId: string, environmentId: string): void {
    if ([projectId, environmentId].some(value => typeof value !== 'string' || !value.trim())) throw new Error('Invalid environment link scope')
  }

  reconcile(): Promise<void> {
    return this.serialize(async () => {
      if (this.stopped) return
      const links = await this.repo.listLinks()
      const ids = new Set(links.map(link => link.id))
      for (const id of this.owned) if (!ids.has(id)) { this.agents.closeTunnel(id); this.owned.delete(id) }
      for (const link of links) {
        if (this.stopped) break
        try { await this.open(link) } catch (error) { this.report(error) }
      }
    })
  }

  private readonly authorized = new Map<string, { ok: boolean; at: number }>()
  /**
   * Tunnels authorize every frame; a database read per data frame would throttle Postgres links.
   * New connections and control frames always read the database; data frames of open
   * connections reuse a decision for a few seconds (deletion closes the tunnel at once).
   */
  private async authorizeFrame(id: string, frame: string): Promise<boolean> {
    const hit = this.authorized.get(id)
    if (frame === 'tunnel.data' && hit && this.now() - hit.at < LINK_AUTHORIZATION_TTL_MS) return hit.ok
    const ok = await this.repo.authorizeLink(id)
    this.authorized.set(id, { ok, at: this.now() })
    return ok
  }

  private async open(link: EnvironmentLink): Promise<void> {
    const authorized = await this.repo.authorizeLink(link.id)
    if (this.stopped) return
    if (!authorized || !this.agents.isOnline(link.clientMachineId) || !this.agents.isOnline(link.serverMachineId)) {
      this.agents.closeTunnel(link.id)
      await this.repo.setLinkState(link.id, 'down')
      return
    }
    const owner = await this.repo.linkOwner(link.projectId)
    const address = owner ? await this.agents.vpnService?.linkAddress(owner, link, link.clientMachineId, link.serverMachineId, link.servicePort).catch(error => {
      this.report(error)
      return null
    }) : null
    if (this.stopped) return
    if (address) {
      this.agents.closeTunnel(link.id)
      this.owned.add(link.id)
      await this.repo.setLinkTransport(link.id, 'vpn', address)
      await this.repo.setLinkState(link.id, 'open')
      return
    }
    await this.repo.setLinkTransport(link.id, 'tunnel', `host.docker.internal:${link.listenerPort}`)
    if (this.agents.tunnelPort(link.id) !== null) { await this.repo.setLinkState(link.id, 'open'); return }
    await this.repo.setLinkState(link.id, 'down')
    if (this.stopped) return
    this.checkVersions(link)
    this.owned.add(link.id)
    try {
      const port = await this.agents.createTunnel(link.id, link.clientMachineId, link.serverMachineId, link.servicePort,
        frame => this.authorizeFrame(link.id, frame),
        async () => {
          await this.serialize(async () => {
            // A delayed close callback must not overwrite a reopened link.
            if (this.agents.tunnelPort(link.id) === null && (await this.repo.listLinks(link.projectId, link.environmentId)).find(row => row.id === link.id)?.transport === 'tunnel') await this.repo.setLinkState(link.id, 'down')
          }).catch(this.report)
        },
        { host: 'docker-host', port: link.listenerPort })
      if (port !== link.listenerPort) throw new Error('Environment link listener port mismatch')
      if (this.stopped || !await this.repo.authorizeLink(link.id) || this.agents.tunnelPort(link.id) === null) {
        this.agents.closeTunnel(link.id)
        return
      }
      await this.repo.setLinkState(link.id, 'open')
    } catch (error) {
      this.agents.closeTunnel(link.id)
      await this.repo.setLinkState(link.id, 'down')
      throw error
    }
  }
}
