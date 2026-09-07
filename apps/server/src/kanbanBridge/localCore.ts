// Локальная реализация порта `KanbanCore` (docs/plans/kanban-service.md): канбан живёт в процессе
// ядра, поэтому ядро отдаёт свои объекты как есть — реестр машин структурно совпадает с узким
// фасадом `KanbanMachines`, остальное передаётся без обёрток. Смысл файла — единственная точка,
// где кластер получает доступ к состоянию ядра; в отдельном процессе её заменит HTTP-клиент.
import type { AgentRegistry } from '../agents/registry.js'
import type { KnowledgeBaseService } from '../kb/types.js'
import type { UploadStore } from '../uploads.js'
import type { WidgetContextStore } from '../mcp/widgetContext.js'
import type { WidgetUiRelay } from '../mcp/widgetUiRelay.js'
import type { EnsureProjectMainCurrent, KanbanCore } from '../kanban/core.js'

export interface LocalKanbanCoreDeps {
  registry: AgentRegistry
  kb: KnowledgeBaseService
  uploads: UploadStore
  widgets: { contexts: WidgetContextStore; ui: WidgetUiRelay }
  ensureProjectMainCurrent: EnsureProjectMainCurrent
}

export function createLocalKanbanCore(deps: LocalKanbanCoreDeps): KanbanCore {
  return {
    machines: deps.registry,
    kb: deps.kb,
    uploads: deps.uploads,
    widgets: deps.widgets,
    ensureProjectMainCurrent: deps.ensureProjectMainCurrent
  }
}
