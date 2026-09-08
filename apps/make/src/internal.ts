// Внутренний протокол «ядро ↔ Make» для режима двух процессов. Оба конца — Fastify, оба
// закрыты одним Bearer (`VC_INTERNAL_TOKEN`), наружу Caddy эти пути не проксирует.
//
// Формат намеренно один: RPC `{ method, args }` поверх порта. Порты `MakeCore` и `MakeService`
// узкие и уже описаны интерфейсами, поэтому отдельный REST-ресурс на каждый метод не добавил бы
// ничего, кроме второй копии контракта. Диспетчеры живут здесь же — рядом с портами, которые они
// обслуживают: список разрешённых методов растёт вместе с интерфейсом, а не в чужом файле.

import { RpcError, type RpcRequest } from '@voicechat/shared'
import type { MakeCore } from './core.js'
import type { MakeHubEvent } from './hub.js'
import type { MakeService } from './service.js'

/** У ядра: данные для Make (`MakeCore` по RPC) и приём событий шины Make. */
export const INTERNAL_MAKE_CORE_PATH = '/internal/make/core'
export const INTERNAL_MAKE_EVENTS_PATH = '/internal/make/events'
// Транспорт RPC и whoami общие для всех соседей ядра — живут в @voicechat/shared, здесь реэкспорт для совместимости.
export { INTERNAL_WHOAMI_PATH, RpcError, createRpcClient, type RpcRequest, type RpcResponse, type WhoamiRequest, type WhoamiResponse } from '@voicechat/shared'
/** У Make: `MakeService` по RPC для ядра и здоровье процесса. */
export const INTERNAL_MAKE_SERVICE_PATH = '/internal/service'
export const MAKE_HEALTH_PATH = '/v1/health'


export type MakeEventsRequest = { events: MakeHubEvent[] }

/** Методы `MakeCore`, доступные по RPC; `machineFs.*` — отдельными именами, `boardChanged` — без ответа. */
export const CORE_RPC_METHODS = [
  'conversation', 'conversationOwner', 'conversationProject', 'isProjectViewer', 'makeConversationIdsOf',
  'taskLinks', 'linkableTasks', 'linkTaskDesign', 'unlinkTaskDesign', 'taskDesigns', 'project', 'userExists',
  'boardChanged', 'machineFs.available', 'machineFs.list', 'machineFs.read', 'machineFs.isOnline'
] as const
export type CoreRpcMethod = (typeof CORE_RPC_METHODS)[number]

/** Диспетчер RPC над реализацией порта (у ядра — `LocalMakeCore`). */
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

/** Методы `MakeService`, которые ядро зовёт у отдельного процесса Make (остальные считаются у ядра). */
export const SERVICE_RPC_METHODS = ['promptContext', 'listFiles', 'adminStats', 'metrics', 'sweep'] as const
export type ServiceRpcMethod = (typeof SERVICE_RPC_METHODS)[number]

export function createServiceRpcDispatcher(service: Pick<MakeService, ServiceRpcMethod>): (req: RpcRequest) => Promise<unknown> {
  return async ({ method, args }) => {
    if (!Array.isArray(args) || !(SERVICE_RPC_METHODS as readonly string[]).includes(method)) throw new RpcError(400, `неизвестный метод ${method}`)
    const fn = service[method as ServiceRpcMethod] as (...x: never[]) => unknown
    return (await fn.apply(service, args as never[])) ?? null
  }
}
