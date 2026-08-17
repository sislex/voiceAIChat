import type { AgentExecResult, FsResult } from '@shared/agentProtocol'
import type { CcItem, CcProject, CcSession } from '@shared/cc'
import type { CxItem, CxProject, CxSession } from '@shared/codexSessions'
import type { SessionUsage } from '@shared/types'
import type { KbDocument, KbSearchResult, KbStatus } from '@shared/kb'
import type { CiRunSummary } from '@shared/ci'

export interface MachinePolicySummary {
  readOnly: boolean
  network: boolean
  allowedDirs: readonly string[]
}
export interface MachineCatalogEntry {
  id: string
  name: string
  platform: string
  online: boolean
  version: string | null
  capabilities: readonly string[]
  policy: MachinePolicySummary
}
export interface MachineCatalog {
  get(): readonly MachineCatalogEntry[]
  subscribe(listener: () => void): () => void
}
export type MachineUtilityKind = 'console' | 'terminal' | 'explorer'
export interface MachineUtilityRequest { kind: MachineUtilityKind; agentId?: string; path?: string; revealFile?: boolean }
export interface MachineUtilityPort { open(request: MachineUtilityRequest): void; close(): void }
export interface KnowledgeNavigationPort { openDocument(documentId: string): void }
export interface OperationsChatPort { resume(engine: 'claude' | 'codex', project: string | null, sessionId: string): Promise<string | null> }
export interface OperationsProjectsPort { openTask(projectId: string, taskId: string): void }
export interface OperationsHostContext { authenticated: boolean; role?: string; pathname?: string }

export interface MachinesClient { list(): Promise<readonly MachineCatalogEntry[]>; subscribe?(listener: (machines: readonly MachineCatalogEntry[]) => void): () => void }
export interface TerminalSession { id: string; input(data: string): void; resize(cols: number, rows: number): void; close(): void; onOutput(listener: (data: string) => void): () => void; onExit(listener: (code: number | null) => void): () => void }
export interface TerminalClient { open(agentId: string, cwd?: string): Promise<TerminalSession> }
export interface FilesClient {
  list(agentId: string, path: string, projectId?: string): Promise<FsResult>
  read(agentId: string, path: string, projectId?: string): Promise<FsResult>
  write(agentId: string, path: string, dataBase64: string, projectId?: string): Promise<FsResult>
  remove(agentId: string, path: string, projectId?: string): Promise<FsResult>
  rename(agentId: string, from: string, to: string, projectId?: string): Promise<FsResult>
  mkdir(agentId: string, path: string, projectId?: string): Promise<FsResult>
  exec(agentId: string, command: string, signal?: AbortSignal, projectId?: string): Promise<AgentExecResult>
}
export interface ObserverTranscript<T> { items: T[]; usage: SessionUsage | null }
export interface LlmObserverClient {
  claudeProjects(): Promise<CcProject[]>; claudeSessions(project: string): Promise<CcSession[]>; claudeTranscript(project: string, id: string): Promise<ObserverTranscript<CcItem>>
  codexProjects(): Promise<CxProject[]>; codexSessions(cwd: string): Promise<CxSession[]>; codexTranscript(id: string): Promise<ObserverTranscript<CxItem>>
  subscribeClaude(project: string, id: string, listener: (items: CcItem[]) => void): () => void
  subscribeCodex(id: string, listener: (items: CxItem[]) => void): () => void
}
export interface KnowledgeClient { status(): Promise<KbStatus>; search(query: string): Promise<KbSearchResult[]>; document(id: string): Promise<KbDocument | null> }
export interface CiMonitorClient { list(): Promise<CiRunSummary[]>; subscribe?(listener: (runs: CiRunSummary[]) => void): () => void }
export interface DiagnosticRecord { category: 'backend'|'session'|'capabilities'|'cli'|'runners'|'machines'|'realtime'|'pty'|'files'|'kb'; label: string; value: unknown }
export interface DiagnosticsClient { collect(): Promise<DiagnosticRecord[]> }
export interface ConsoleClient { exec(agentId: string, command: string, signal?: AbortSignal): Promise<AgentExecResult> }

export interface OperationsDependencies {
  machines: MachinesClient; terminal: TerminalClient; files: FilesClient; observer: LlmObserverClient
  knowledge: KnowledgeClient; ci: CiMonitorClient; diagnostics: DiagnosticsClient; console: ConsoleClient
  chat: OperationsChatPort; projects: OperationsProjectsPort
}
