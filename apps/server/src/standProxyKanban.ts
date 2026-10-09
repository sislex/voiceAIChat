import { z } from 'zod'
import { REST } from '@voicechat/shared'
import type { MakeRequestAuthority } from './makeBridge/requestAuthority.js'

const detail = z.object({ standId: z.string().min(1), machineId: z.string().min(1), gateway: z.object({ port: z.number().int().min(1).max(65535) }) })
const error = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode })

/** Kanban receives a capability for this user's exact GET, not a service identity. */
export function standProxyKanban(baseUrl: string | undefined, authority: MakeRequestAuthority, fetchImpl = fetch) {
  return async (user: string, project: string, stand: string) => {
    if (!baseUrl) throw error(503, 'stand_proxy_unavailable')
    const path = REST.projectDevStand(project, stand)
    return authority.run(user, 'GET', path, async authorization => {
      let response: Response
      try {
        response = await fetchImpl(baseUrl.replace(/\/$/, '') + path, {
          headers: { authorization }, redirect: 'error', signal: AbortSignal.timeout(15_000)
        })
      } catch { throw error(503, 'stand_proxy_unavailable') }
      if (!response.ok) throw error(response.status === 404 ? 404 : 503, response.status === 404 ? 'stand_not_found' : 'stand_proxy_unavailable')
      const value = detail.safeParse(await response.json().catch(() => null))
      if (!value.success || value.data.standId !== stand) throw error(502, 'invalid_stand_response')
      return { machineId: value.data.machineId, gatewayPort: value.data.gateway.port }
    })
  }
}
