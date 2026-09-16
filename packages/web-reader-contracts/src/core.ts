// Порт данных и эффектов ядра. Приложение Reader не открывает общую БД.
import type { AgentHttpRequest, AgentHttpResponse, PreviewAction, PreviewEnvironment, ReaderProjectRequest, ReaderProjectResponse, ProjectTestUser, ProjectCommandPolicy } from '@voicechat/shared'
import type { PreviewActionOutcome } from './actions.js'
import type { PreviewEnvironmentInfo } from './context.js'
import type { PreviewToolEntry } from './turnToken.js'

export interface ReaderContext {
  machineId: string | null
  testUsers: ProjectTestUser[]
  environments: PreviewEnvironmentInfo[]
  commandPolicy: ProjectCommandPolicy | null
}
export interface ReaderCore {
  context(entry: PreviewToolEntry): Promise<ReaderContext | null>
  canUseMachine(userId: string, agentId: string): Promise<boolean>
  machineOnline(agentId: string): boolean | Promise<boolean>
  machineHttp(userId: string, agentId: string, request: AgentHttpRequest): Promise<AgentHttpResponse>
  projectResource(request: ReaderProjectRequest): Promise<ReaderProjectResponse>
  previewAction(userId: string, conversationId: string, action: PreviewAction, timeoutMs?: number): Promise<PreviewActionOutcome>
  issuePreviewRunKey(userId: string): string | Promise<string>
  listPreviews(): Promise<PreviewEnvironment[]>
  logBrowserEvidence?(entry: PreviewToolEntry, event: import('@voicechat/shared').CiBrowserEvidenceEvent): Promise<void>
  logBrowserShot(userId: string, conversationId: string, pngBase64: string): Promise<void>
}
