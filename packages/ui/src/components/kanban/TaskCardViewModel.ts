import type { KanbanColumnSemanticType, ProjectDesignSource, TaskRunResultOutcome } from '@shared/projects'

export type TaskCardVersion = 'new' | 'legacy'
/**
 * Вкладки повторяют старую карточку: содержимое у них общее, различается только
 * оболочка. «Обзор» и «Доработки» новая карточка рисует сама, остальные отдают
 * готовые панели (`renderPanel`) — иначе пришлось бы дублировать их логику.
 */
export type TaskCardTab =
  | 'overview' | 'reworks' | 'preparation' | 'settings' | 'progress'
  | 'component_qa' | 'integration_tests' | 'automated_qa' | 'manual_qa'
  | 'merge' | 'feed' | 'chat'
export type TaskCardRunStatus = 'queued' | 'running' | 'waiting_for_answer' | 'success' | 'failed' | 'cancelled'
export type TaskCardLoadState = 'loading' | 'ready' | 'empty' | 'error'
export type TaskCardMakeMode = 'whole_project' | 'files'

export interface TaskCardFileViewModel {
  id: string
  name: string
  size?: number
  mimeType?: string
  status: 'ready' | 'uploading' | 'error' | 'missing'
  error?: string
}

export interface TaskCardMakeSourceViewModel {
  id: string
  title: string
  conversationId: string
  mode: TaskCardMakeMode
  paths: Array<{ path: string; available: boolean; error?: string }>
  /** Когда макет обновляли последний раз; null — сервер не отдал время. */
  updatedAt?: number | null
}

export interface TaskCardRunViewModel {
  id: string
  title: string
  status: TaskCardRunStatus
  outcome: TaskRunResultOutcome
  createdAt: number
  finishedAt: number | null
  canOpen: boolean
  canCancel: boolean
  canAnswer: boolean
}

export interface TaskCardWorkflowStepViewModel {
  id: string
  semanticType: KanbanColumnSemanticType
  label: string
  state: 'passed' | 'current' | 'upcoming' | 'failed'
  /**
   * Фактическая длительность пройденного этапа. Прогнозов для будущих этапов
   * нет намеренно: оценка «≈ 15 мин» ничем не подкреплена и вводит в заблуждение.
   */
  durationMs?: number
}

export interface TaskReworkCycleViewModel {
  id: string
  sequence: number
  description: string
  criteria: string[]
  makeSources: TaskCardMakeSourceViewModel[]
  attachments: TaskCardFileViewModel[]
  implementedResult?: string
  createdBy: string
  createdAt: number
  preparationRunId: string | null
  /** Черновик правится и отправляется, отправленный цикл неизменяем. */
  status: 'draft' | 'submitted'
  /** Отправленный цикл уже вошёл в main — его историю трогать нельзя. */
  merged?: boolean
}

/** Один пункт вкладки: подпись, счётчик и точка «здесь сейчас что-то идёт». */
export interface TaskCardTabViewModel {
  id: TaskCardTab
  label: string
  count?: number
  live?: boolean
}

export interface TaskCardViewModel {
  taskId: string
  taskKey: string
  projectName: string
  title: string
  stage: {
    semanticType: KanbanColumnSemanticType
    label: string
    fallback: boolean
    /** «Выполняется», «Пауза», «Ожидает» — состояние задачи внутри этапа. */
    statusLabel?: string
    /** Строка под заголовком: что происходит с задачей прямо сейчас. */
    note?: string
  }
  priority: string
  assignee: string | null
  description: string
  acceptanceCriteria: string
  labels: string[]
  /** Номер идущего цикла и номер следующего — для подписи кнопки доработки. */
  cycleNumber: number
  nextCycleNumber: number
  branch: string | null
  commit: string | null
  workflow: TaskCardWorkflowStepViewModel[]
  tabs: TaskCardTabViewModel[]
  runs: TaskCardRunViewModel[]
  source: { description: string; acceptanceCriteria: string; attachments: TaskCardFileViewModel[] }
  makeSources: TaskCardMakeSourceViewModel[]
  cycles: TaskReworkCycleViewModel[]
  /** Черновики доработок: собираются заранее и отправляются по одному. */
  drafts: TaskReworkCycleViewModel[]
  loadState: TaskCardLoadState
  error?: string
  actions: {
    canRework: boolean
    reworkBlockedReason?: string
    hasActiveRun: boolean
    /** Активный ран можно остановить прямо из шапки карточки. */
    canStopRun: boolean
    safeActiveRunActions: Array<'keep_running' | 'open_run' | 'cancel_explicitly'>
  }
}

export interface TaskReworkDraft {
  description: string
  criteria: string[]
  makeMode: TaskCardMakeMode
  makePaths: string[]
  makeSources?: Array<{ conversationId: string; mode: TaskCardMakeMode; paths: string[] }>
  attachments: TaskCardFileViewModel[]
  /** Правим существующий черновик, а не создаём новый. */
  editingId?: string | null
}

export interface TaskCardCallbacks {
  onClose(): void
  onChangeTab(tab: TaskCardTab): void
  onOpenRun(runId: string): void
  onOpenMake(conversationId: string): void
  onStartRework(): void
  onChangeReworkDraft(draft: TaskReworkDraft): void
  onAddReworkFiles?(files: FileList | null): void
  onRemoveReworkFile?(fileId: string): void
  onRetryReworkFile?(fileId: string): void
  onRetryHistory?(): void
  onSubmitRework(draft: TaskReworkDraft, idempotencyKey: string): void | Promise<void>
  onCancelRework(): void
  onRetryMakeSources?(): void
  onLoadMakeFiles?(conversationId: string): Promise<string[]>
  onUploadAttachment?(scope: 'source' | 'rework_draft', file: File): Promise<void>
  onDeleteAttachment?(attachmentId: string): Promise<void>
  /** Открыть связанный чат задачи. */
  onOpenChat?(): void
  /** Остановить активный ран, не закрывая карточку. */
  onStopRun?(): void | Promise<void>
  /** Байты вложения для превью: прямой src не подойдёт — у /api нужен токен. */
  loadAttachment?(attachmentId: string): Promise<string>
  /** Снять связь карточки с Make-макетом. */
  onUnlinkMake?(linkId: string): void | Promise<void>
  /** Перевести связь на другой Make-проект. */
  onReplaceMake?(linkId: string, conversationId: string): void | Promise<void>
  /** Черновики доработок: правка, удаление и отправка выбранного набора. */
  onEditDraft?(cycleId: string): void
  onDeleteDraft?(cycleId: string): void | Promise<void>
  onSubmitDraft?(cycleId: string): void | Promise<void>
}

export interface TaskReworkSourcesState {
  state: TaskCardLoadState
  items: ProjectDesignSource[]
  error?: string
}
