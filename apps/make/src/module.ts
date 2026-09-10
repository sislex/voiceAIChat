// Compose Make's workshops, event hub, library, routes, and MCP in one place, exposing only
// MakeService. Core supplies MakeCore for chat, kanban, and machine data, the MCP secret, and the
// Make MCP URL used by the runner. Make owns the rest. The same createMakeModule supports a
// standalone apps/make process with an HTTP implementation of MakeCore.

import type { FastifyInstance } from 'fastify'
import type { MakeCore } from './core.js'
import { MakeHub } from './hub.js'
import { MakeLibrary } from './library.js'
import { formatMakeMetrics } from './metrics.js'
import type { MakeService } from './service.js'
import { buildTaskMakeSources } from './taskScope.js'
import { MakeWorkspaces } from './workspace.js'
import { registerMakeRoutes, type MakeRoutesDeps } from './routes.js'
import { registerMakeMcp } from './mcp.js'

export interface MakeModuleOptions {
  /** Data root: workshops live at <dataDir>/make/<conversationId>, with the library alongside them. */
  dataDir: string
  core: MakeCore
  /** MCP endpoint secret (?k=), also used to sign run-scope tokens. */
  mcpSecret: string
  /** Base /mcp/make URL as seen by the LLM runner; required to issue run-scope sources. */
  mcpBaseUrl?: string
  limiters?: Pick<MakeRoutesDeps, 'importLimiter' | 'importUrlLimiter' | 'passwordLimiter'>
}

export interface MakeModule {
  workspaces: MakeWorkspaces
  hub: MakeHub
  library: MakeLibrary
  service: MakeService
  /** Register REST /api/make/**, previews, publications, and MCP /mcp/make on this app. */
  register(app: FastifyInstance): void
}

export function createMakeModule(opts: MakeModuleOptions): MakeModule {
  const { core } = opts
  const workspaces = new MakeWorkspaces(opts.dataDir)
  // Per-user quota (roadmap-2, item 15): all Make projects owned by the conversation owner.
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
