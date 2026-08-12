// Типизированный мост window.ci (REST + WS) для фичи «CI-раннер».
// Контракт домена — в @shared/ci; пути REST/WS — в @shared/protocol. Мост
// ставится в remote/index.ts (web); формы совпадают с ожиданиями стора/компонентов.

import type {
  CiConsoleExecResult,
  CiCommand,
  CiCommandInput,
  CiGlobalSettings,
  CiCommandSuggestion,
  CiWorkspaceReportItem,
  CiSlotConfig,
  CiLlmConfig,
  CiRunMode,
  CiInteraction,
  CiInteractionAnswer,
  CiRun,
  CiRunDetail,
  CiRunStep,
  CiFixAttempt,
  CiRunSummary,
  CiRunConclusion,
  CiQueueRemovalResult,
  CiLogLine,
  CiCommandMetric,
  CiModelWorkMetric,
  CiRunReport,
  CiTaskReport
} from '@shared/ci'
import type { Message } from '@shared/types'
import type { MergeRun, TaskRepository } from '@shared/merge'
import type { KbRunUsageReport, KbTaskUsageReport } from '@shared/kb'

/** Ответ GET usage: где команда используется (проекты/задачи). */
export interface CiCommandUsage {
  projects: Array<{ id: string; name: string }>
  tasks: Array<{ id: string; title: string }>
}

/** Ответ GET конфига задачи: разрешённый конфиг + флаги наследования. */
export interface CiTaskLlmConfig {
  config: CiLlmConfig
  overridden: boolean
  projectDefault: CiLlmConfig
}

export interface CiProjectLlmConfig {
  config: CiLlmConfig
  inherited: CiLlmConfig
  overridden: boolean
}

export interface CiTaskConfig {
  config: CiSlotConfig
  overridden: boolean
  projectDefault: CiSlotConfig
}

/** Ответ GET метрик проекта. */
export interface CiMetrics {
  commands: CiCommandMetric[]
  modelWork: CiModelWorkMetric
}

/** REST-часть моста (реализация — createCiRest в httpApi.ts). */
export interface RendererCiRest {
  listCommands(projectId?: string): Promise<CiCommand[]>
  getCommand(id: string): Promise<CiCommand>
  createCommand(input: CiCommandInput): Promise<CiCommand>
  updateCommand(id: string, input: CiCommandInput): Promise<CiCommand>
  deleteCommand(id: string): Promise<{ ok: boolean }>
  commandUsage(id: string): Promise<CiCommandUsage>
  getSettings(): Promise<CiGlobalSettings>
  putSettings(settings: Partial<CiGlobalSettings>): Promise<CiGlobalSettings>
  listSuggestions(projectId?: string): Promise<CiCommandSuggestion[]>
  resolveSuggestion(id: string, accept: boolean): Promise<CiCommandSuggestion>
  listWorkspaces(projectId?: string): Promise<CiWorkspaceReportItem[]>
  getProjectCi(projectId: string): Promise<CiSlotConfig>
  putProjectCi(projectId: string, config: CiSlotConfig): Promise<CiSlotConfig>
  getProjectCiLlm(projectId: string): Promise<CiProjectLlmConfig>
  putProjectCiLlm(projectId: string, config: CiLlmConfig): Promise<CiProjectLlmConfig>
  resetProjectCiLlm(projectId: string): Promise<CiProjectLlmConfig>
  getTaskCiLlm(projectId: string, taskId: string): Promise<CiTaskLlmConfig>
  putTaskCiLlm(projectId: string, taskId: string, config: CiLlmConfig): Promise<CiLlmConfig>
  /** Снять переопределение задачи — вернуться к движку/модели проекта. */
  resetTaskCiLlm(projectId: string, taskId: string): Promise<CiTaskLlmConfig>
  getTaskCi(projectId: string, taskId: string): Promise<CiTaskConfig>
  putTaskCi(projectId: string, taskId: string, config: CiSlotConfig): Promise<CiSlotConfig>
  startRun(projectId: string, taskId: string, options?: { mode?: CiRunMode; provider?: 'claude' | 'codex'; model?: string; launch?: 'queue' | 'parallel' }): Promise<CiRun>
  /** agentId выбирает машину проекта для рана; без него — машина workspace. */
  startMerge(projectId: string, taskId: string, agentId?: string | null): Promise<MergeRun>
  getMerge(runId: string): Promise<MergeRun>
  cancelMerge(runId: string): Promise<MergeRun>
  /** unpin=true — «мержить текущий head»: новая попытка без закреплённого SHA. */
  retryMerge(runId: string, unpin?: boolean): Promise<MergeRun>
  /** История merge-попыток задачи, свежие первыми. */
  listMergeRuns(projectId: string, taskId: string): Promise<MergeRun[]>
  /** Штатный production-деплой из успешного merge-рана. */
  deployMergeRun(runId: string): Promise<MergeRun>
  /** Копии репозиториев задачи по машинам (dev-workspace и merge-клоны). */
  getTaskRepositories(projectId: string, taskId: string): Promise<TaskRepository[]>
  /** Немедленный запуск на явно указанной машине; ран из очереди продвигается, а не отменяется. */
  forceStartRun(projectId: string, taskId: string, agentId: string): Promise<CiRun>
  getRun(runId: string): Promise<CiRunDetail>
  getRunLog(runId: string): Promise<CiLogLine[]>
  /** Обращения модели к БЗ внутри рана (блок в ленте рана). */
  getRunKbUsage(runId: string): Promise<KbRunUsageReport>
  /** Агрегат по всем ранам задачи (блок в модалке задачи). */
  getTaskKbUsage(projectId: string, taskId: string): Promise<KbTaskUsageReport>
  /** Отчёт по расходу модели и шагам одного рана. */
  getRunReport(runId: string): Promise<CiRunReport>
  /** Отчёт по всем ранам задачи с итогом (раздел «Отчёт» карточки). */
  getTaskReport(projectId: string, taskId: string): Promise<CiTaskReport>
  cancelRun(runId: string): Promise<{ ok: boolean }>
  /** Убрать только ожидающий ран; результат сообщает о гонке с его стартом. */
  dequeueRun(runId: string): Promise<CiQueueRemovalResult>
  retryRun(runId: string): Promise<CiRun>
  retryRunFromStep(runId: string, selection?: { provider: 'claude' | 'codex'; model: string; llmEngineId?: string | null }): Promise<CiRun>
  discardChangesAndRetry(runId: string): Promise<CiRun>
  getMetrics(projectId: string): Promise<CiMetrics>
  consoleExec(runId: string, command: string, editMode: boolean): Promise<CiConsoleExecResult>
  /** Ответить на паузу рана: текст уточнения или решение по плану. */
  answerInteraction(runId: string, interactionId: string, answer: CiInteractionAnswer): Promise<CiInteraction>
}

/** Полный мост: REST + realtime WS (подписка на ран + слушатели событий). */
export interface RendererCiBridge extends RendererCiRest {
  subscribe(runId: string): void
  unsubscribe(runId: string): void
  onMerge(cb: (m: { runId: string; run: MergeRun }) => void): () => void
  onSnapshot(cb: (m: { runId: string; detail: CiRunDetail; log: CiLogLine[] }) => void): () => void
  onRun(cb: (m: { runId: string; run: CiRun }) => void): () => void
  onStep(cb: (m: { runId: string; step: CiRunStep }) => void): () => void
  onLog(cb: (m: { runId: string; line: CiLogLine }) => void): () => void
  onFix(cb: (m: { runId: string; attempt: CiFixAttempt }) => void): () => void
  onDone(cb: (m: { runId: string; run: CiRun; conclusion?: CiRunConclusion }) => void): () => void
  onSummary(cb: (m: { projectId: string; summary: CiRunSummary }) => void): () => void
  onInteraction(cb: (m: { runId: string; interaction: CiInteraction }) => void): () => void
  /**
   * Сообщение, дописанное сервером в чат задачи (резюме рана). Живёт в мосте CI,
   * потому что автор этих сообщений — раннер; мост ходов (`window.claude`) шлёт
   * только события собственного хода.
   */
  onChatMessage(cb: (m: { conversationId: string; message: Message }) => void): () => void
}
