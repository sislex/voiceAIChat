// Internal core-to-Make protocol for separate processes. Both Fastify endpoints use the shared
// VC_INTERNAL_TOKEN Bearer secret, and Caddy does not expose these paths. RPC uses { method, args }
// over the narrow MakeCore and MakeService interfaces; separate REST resources would duplicate the
// contract. Dispatchers stay beside the ports so allowlists evolve with their interfaces.

import { RpcError, type RpcRequest } from '@voicechat/shared'
import type { MakeCore } from './core.js'
import type { MakeHubEvent } from './hub.js'
import type { MakeService } from './service.js'

/** Core endpoints for MakeCore RPC data and Make hub events. */
export const INTERNAL_MAKE_CORE_PATH = '/internal/make/core'
export const INTERNAL_MAKE_EVENTS_PATH = '/internal/make/events'
// RPC transport and whoami are shared by core's neighboring services in @voicechat/shared; retain
// compatibility exports here.
export { INTERNAL_WHOAMI_PATH, RpcError, createRpcClient, type RpcRequest, type RpcResponse, type WhoamiRequest, type WhoamiResponse } from '@voicechat/shared'
/** Make endpoints for MakeService RPC and process health. */
export const INTERNAL_MAKE_SERVICE_PATH = '/internal/service'
export const MAKE_HEALTH_PATH = '/v1/health'


export type MakeEventsRequest = { events: MakeHubEvent[] }

/** MakeCore RPC methods: machineFs operations have distinct names; boardChanged expects no response. */
export const CORE_RPC_METHODS = [
  'conversation', 'conversationOwner', 'conversationProject', 'isProjectViewer', 'makeConversationIdsOf',
  'taskLinks', 'linkableTasks', 'linkTaskDesign', 'unlinkTaskDesign', 'taskDesigns', 'project', 'userExists',
  'boardChanged', 'machineFs.available', 'machineFs.list', 'machineFs.read', 'machineFs.isOnline'
] as const
export type CoreRpcMethod = (typeof CORE_RPC_METHODS)[number]

/** RPC dispatcher around a port implementation, such as LocalMakeCore in core. */
export function createCoreRpcDispatcher(core: MakeCore): (req: RpcRequest) => Promise<unknown> {
  return async ({ method, args }) => {
    if (!Array.isArray(args) || !(CORE_RPC_METHODS as readonly string[]).includes(method)) throw new RpcError(400, `неизвестный метод ${method}`)
    const a = args as never[]
    switch (method as CoreRpcMethod) {
      case 'machineFs.available': return core.machineFs !== null
      case 'machineFs.list': if (!core.machineFs) throw new RpcError(409, 'файловый мост машин недоступен'); return core.machineFs.list(a[0], a[1])
      case 'machineFs.read': if (!core.machineFs) throw new RpcError(409, 'файловый мост машин недоступен'); return core.machineFs.read(a[0], a[1])
      case 'machineFs.isOnline': return core.machineFs?.isOnline(a[0]) ?? false
      case 'boardChanged': core.boardChanged(a[0]); return null
      default: {
        const fn = core[method as Exclude<CoreRpcMethod, `machineFs.${string}` | 'boardChanged'>] as (...x: never[]) => unknown
        return (await fn.apply(core, a)) ?? null
      }
    }
  }
}

/** MakeService methods core invokes on standalone Make; remaining methods are computed by core. */
export const SERVICE_RPC_METHODS = ['promptContext', 'listFiles', 'adminStats', 'metrics', 'sweep'] as const
export type ServiceRpcMethod = (typeof SERVICE_RPC_METHODS)[number]

export function createServiceRpcDispatcher(service: Pick<MakeService, ServiceRpcMethod>): (req: RpcRequest) => Promise<unknown> {
  return async ({ method, args }) => {
    if (!Array.isArray(args) || !(SERVICE_RPC_METHODS as readonly string[]).includes(method)) throw new RpcError(400, `неизвестный метод ${method}`)
    const fn = service[method as ServiceRpcMethod] as (...x: never[]) => unknown
    return (await fn.apply(service, args as never[])) ?? null
  }
}
