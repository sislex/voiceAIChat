// Сторона ядра для внутреннего протокола «ядро ↔ канбан» (`kanban/internal.ts`): RPC-диспетчер над
// локальной реализацией `KanbanCore` и снимок машин из реестра для зеркала канбана.
import type { AgentPolicy, AgentTelemetry, WidgetSurfaceSnapshot } from '@voicechat/shared'
import { RpcError, type RpcRequest } from '@voicechat/shared'
import type { KanbanCore } from '../kanban/core.js'
import { KANBAN_CORE_RPC_METHODS, type KanbanCoreRpcMethod, type MachineSnapshot } from '../kanban/internal.js'

export interface KanbanCoreRpcDeps {
  core: KanbanCore
  /** Полный снимок онлайн-машин — первичное заполнение зеркала при старте канбана. */
  machinesSnapshot: () => MachineSnapshot[]
  /** Обратные вызовы тоннеля (авторизация подключения, закрытие) живут у канбана — ядро спрашивает его по RPC. */
  tunnels: { authorize(id: string): Promise<boolean>; closed(id: string): Promise<void> }
}

/** Диспетчер RPC над локальной реализацией `KanbanCore` (у ядра). */
export function createKanbanCoreRpcDispatcher(deps: KanbanCoreRpcDeps): (req: RpcRequest) => Promise<unknown> {
  const { core } = deps
  return async ({ method, args }) => {
    if (!Array.isArray(args) || !(KANBAN_CORE_RPC_METHODS as readonly string[]).includes(method)) throw new RpcError(400, `неизвестный метод ${method}`)
    const a = args as never[]
    switch (method as KanbanCoreRpcMethod) {
      case 'machines.snapshot': return deps.machinesSnapshot()
      case 'machines.fsRead': return core.machines.fsRead(a[0], a[1])
      case 'machines.fsWrite': return core.machines.fsWrite(a[0], a[1], a[2])
      case 'machines.fsMkdir': return core.machines.fsMkdir(a[0], a[1])
      case 'machines.fsDelete': return core.machines.fsDelete(a[0], a[1])
      case 'machines.fsRename': return core.machines.fsRename(a[0], a[1], a[2])
      case 'machines.gitAccess': return core.machines.gitAccess(a[0], a[1])
      case 'machines.createTunnel': {
        const id = a[0] as string
        return core.machines.createTunnel(id, a[1], a[2], a[3], () => deps.tunnels.authorize(id), () => deps.tunnels.closed(id))
      }
      case 'machines.closeTunnel': return await core.machines.closeTunnel(a[0])
      case 'machines.closeTunnelsForTarget': core.machines.closeTunnelsForTarget(a[0]); return null
      case 'kb.status': return core.kb.status()
      case 'kb.topics': return core.kb.topics(a[0])
      case 'kb.document': return core.kb.document(a[0], a[1])
      case 'kb.search': return core.kb.search(a[0], a[1])
      case 'kb.context': return core.kb.context(a[0], a[1], a[2])
      case 'uploads.get': return (await core.uploads.get(a[0])) ?? null
      case 'uploads.read': { const bytes = await core.uploads.read(a[0]); return bytes ? bytes.toString('base64') : null }
      case 'widgets.surface': return (await core.widgets.contexts.surface(a[0])) ?? null
      case 'widgets.updateSurface': core.widgets.contexts.updateSurface(a[0], a[1] as WidgetSurfaceSnapshot); return null
      case 'widgets.uiRequest': return core.widgets.ui.request(a[0], a[1], a[2], a[3], a[4])
      case 'ensureProjectMainCurrent': return core.ensureProjectMainCurrent(a[0])
    }
  }
}

/** Снимок машин из реестра ядра. */
export function machinesSnapshot(registry: {
  onlineIds(): Set<string>
  nameOf(id: string): string | undefined
  platformOf(id: string): string | undefined
  policyOf(id: string): AgentPolicy | undefined
  telemetryOf(id: string): AgentTelemetry | undefined
}): MachineSnapshot[] {
  return [...registry.onlineIds()].map((id) => {
    const snapshot: MachineSnapshot = { id }
    const name = registry.nameOf(id); if (name !== undefined) snapshot.name = name
    const platform = registry.platformOf(id); if (platform !== undefined) snapshot.platform = platform
    const policy = registry.policyOf(id); if (policy !== undefined) snapshot.policy = policy
    const telemetry = registry.telemetryOf(id); if (telemetry !== undefined) snapshot.telemetry = telemetry
    return snapshot
  })
}
