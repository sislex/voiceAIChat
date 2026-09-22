import type { FastifyInstance } from 'fastify'
import { VPN_ERRORS, VPN_REST, parseVpnChange } from '@voicechat/shared'
import { uid } from "@sislexa/identity/server/users/auth"
import { VpnError } from './tailscale.js'
import type { VpnService } from './service.js'

export function registerVpnRoutes(app: FastifyInstance, service: VpnService): void {
  const safe = async <T>(run: () => Promise<T>, reply: import('fastify').FastifyReply): Promise<T | import('fastify').FastifyReply> => {
    try { return await run() }
    catch (error) {
      const code = error instanceof VpnError ? error.code : 'apply'
      return reply.code(code === 'invalid' ? 404 : 409).send({ code, error: VPN_ERRORS[code] })
    }
  }
  app.post(VPN_REST.network, { bodyLimit: 8192 }, async (req, reply) => safe(async () => {
    const body = req.body as { tailnet?: unknown; secret?: unknown } | null
    if (typeof body?.tailnet !== 'string' || typeof body.secret !== 'string') throw new VpnError('invalid')
    await service.connect(uid(req), body.tailnet, body.secret)
    return { ok: true }
  }, reply))
  app.get('/api/agents/:id/vpn', async (req, reply) => safe(() =>
    service.read(uid(req), (req.params as { id: string }).id), reply))
  app.put('/api/agents/:id/vpn', { bodyLimit: 2048 }, async (req, reply) => safe(async () => {
    const change = parseVpnChange(req.body)
    if (!change) throw new VpnError('invalid')
    return service.change(uid(req), (req.params as { id: string }).id, change)
  }, reply))
}
