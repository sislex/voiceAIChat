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
  CiRun,
  CiRunDetail,
  CiRunStep,
  CiFixAttempt,
  CiRunSummary,
  CiRunConclusion,
  CiLogLine,
  CiCommandMetric,
  CiModelWorkMetric
} from '@shared/ci'

/** Ответ GET usage: где команда используется (проекты/задачи). */
export interface CiCommandUsage {
  projects: Array<{ id: string; name: string }>
  tasks: Array<{ id: string; title: string }>
}

/** Ответ GET конфига задачи: разрешённый конфиг + флаги наследования. */
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
  getTaskCi(projectId: string, taskId: string): Promise<CiTaskConfig>
  putTaskCi(projectId: string, taskId: string, config: CiSlotConfig): Promise<CiSlotConfig>
  startRun(projectId: string, taskId: string): Promise<CiRun>
  getRun(runId: string): Promise<CiRunDetail>
  getRunLog(runId: string): Promise<CiLogLine[]>
  cancelRun(runId: string): Promise<{ ok: boolean }>
  retryRun(runId: string): Promise<CiRun>
  getMetrics(projectId: string): Promise<CiMetrics>
  consoleExec(runId: string, command: string, editMode: boolean): Promise<CiConsoleExecResult>
}

/** Полный мост: REST + realtime WS (подписка на ран + слушатели событий). */
export interface RendererCiBridge extends RendererCiRest {
  subscribe(runId: string): void
  unsubscribe(runId: string): void
  onSnapshot(cb: (m: { runId: string; detail: CiRunDetail; log: CiLogLine[] }) => void): () => void
  onRun(cb: (m: { runId: string; run: CiRun }) => void): () => void
  onStep(cb: (m: { runId: string; step: CiRunStep }) => void): () => void
  onLog(cb: (m: { runId: string; line: CiLogLine }) => void): () => void
  onFix(cb: (m: { runId: string; attempt: CiFixAttempt }) => void): () => void
  onDone(cb: (m: { runId: string; run: CiRun; conclusion?: CiRunConclusion }) => void): () => void
  onSummary(cb: (m: { projectId: string; summary: CiRunSummary }) => void): () => void
}
