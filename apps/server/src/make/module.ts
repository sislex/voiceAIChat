// Сборка Make как модуля: мастерские, шина событий, библиотека, роуты и MCP — из одного места,
// снаружи виден только порт `MakeService`. Ядро даёт `MakeCore` (данные чата/канбана/машин),
// секрет MCP и адрес MCP Make для исполнителя; всё остальное Make делает сам. Тот же
// `createMakeModule` завтра поднимет отдельный процесс `apps/make` — с HTTP-реализацией `MakeCore`.

import type { FastifyInstance } from 'fastify'
import type { MakeCore } from './core.js'
import { MakeHub } from './hub.js'
import { MakeLibrary } from './library.js'
import { formatMakeMetrics } from './metrics.js'
import type { MakeService } from './service.js'
import { buildTaskMakeSources } from './taskScope.js'
import { MakeWorkspaces } from './workspace.js'
import { registerMakeRoutes, type MakeRoutesDeps } from '../routes/make.js'
import { registerMakeMcp } from '../mcp/makeMcp.js'

export interface MakeModuleOptions {
  /** Корень данных: мастерские лежат в `<dataDir>/make/<conversationId>`, библиотека — рядом. */
  dataDir: string
  core: MakeCore
  /** Секрет MCP-эндпоинта (`?k=`); им же подписываются scope-токены рана. */
  mcpSecret: string
  /** База URL `/mcp/make` глазами исполнителя LLM; без неё scope-источники рана не выдаются. */
  mcpBaseUrl?: string
  limiters?: Pick<MakeRoutesDeps, 'importLimiter' | 'importUrlLimiter' | 'passwordLimiter'>
}

export interface MakeModule {
  workspaces: MakeWorkspaces
  hub: MakeHub
  library: MakeLibrary
  service: MakeService
  /** REST `/api/make/**`, превью, публикация и MCP `/mcp/make` на данном приложении. */
  register(app: FastifyInstance): void
}

export function createMakeModule(opts: MakeModuleOptions): MakeModule {
  const { core } = opts
  const workspaces = new MakeWorkspaces(opts.dataDir)
  // Квота на пользователя (roadmap-2 п.15): все проекты Make владельца разговора.
  workspaces.setProjectsOfOwner(async (id) => {
    const owner = await core.conversationOwner(id)
    return owner ? await core.makeConversationIdsOf(owner) : null
  })
  const hub = new MakeHub()
  const library = new MakeLibrary(opts.dataDir)
  const adminStats = () => workspaces.adminStats((id) => core.conversationOwner(id))
  const service: MakeService = {
    promptContext: (conversationId) => workspaces.promptContext(conversationId),
    turnSnapshot: (turn) => hub.turnSnapshot(turn),
    listFiles: (conversationId) => workspaces.list(conversationId),
    taskSources: (args) => buildTaskMakeSources({ ...args, baseUrl: opts.mcpBaseUrl, secret: opts.mcpSecret }),
    adminStats,
    metrics: async () => formatMakeMetrics(await adminStats()),
    sweep: () => workspaces.sweep(),
    subscribe: (userId, sink) => hub.subscribe(userId, sink)
  }
  return {
    workspaces, hub, library, service,
    register(app) {
      registerMakeMcp(app, { workspaces, hub, core }, opts.mcpSecret)
      registerMakeRoutes(app, { core, workspaces, hub, library, ...opts.limiters })
    }
  }
}
