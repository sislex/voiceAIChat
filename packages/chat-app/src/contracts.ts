import type { RendererApi, SttSegmentWire } from '@shared/ipc'
import type { AgentInfo } from '@shared/agentProtocol'
import type { KbUsageReport, KbProjectUsageReport } from '@shared/kb'
import type { Settings } from '@shared/types'

export const SIDEBAR_PROJECT_KEY = 'vc.sidebar.project'
export const DONE_TASK_CHATS_KEY = 'vc.sidebar.doneTaskChats'
export const MESSAGE_META_UPDATE_KEY = 'vc:message-meta-update'

export interface LiveSegment { speakerId: number; text: string }

export interface ChatTurnPort {
  enabled: boolean
  send?(conversationId: string, segments: SttSegmentWire[], attachments?: string[], verbose?: boolean, execTarget?: string | null, messageId?: string): void
  cancel?(conversationId?: string): void
  editQueued?(conversationId: string, id: string, text: string): void
  deleteQueued?(conversationId: string, id: string): void
  reorderQueued?(conversationId: string, ids: string[]): void
  sendQueuedNow?(conversationId: string, id: string): void
}

export interface ChatKbPort {
  getConversationUsage(conversationId: string): Promise<KbUsageReport>
  markConversationUsageViewed(conversationId: string, throughSeq: number): Promise<{ lastSeq: number; unreadCount: number }>
  getProjectUsage(projectId: string): Promise<KbProjectUsageReport>
}

export type ChatClient = Pick<RendererApi,
  | 'conversations:list' | 'conversations:create' | 'conversations:createDraft'
  | 'conversations:get' | 'conversations:search' | 'conversations:rename'
  | 'conversations:setProject' | 'conversations:setPreviewUrl' | 'conversations:setStatus'
  | 'conversations:setExecTarget' | 'conversations:listMachines' | 'conversations:taskContext'
  | 'conversations:taskChats' | 'conversations:delete' | 'messages:add'
  | 'messages:updateMeta' | 'messages:delete' | 'messages:search' | 'uploads:add'
  | 'prompt:suggest' | 'kb:status'
> & { turn: ChatTurnPort; kb?: ChatKbPort }

export interface PreferencesPort { get(key: string): string | null; set(key: string, value: string): void; remove(key: string): void }
export interface DownloadPort { file(name: string, content: string, mimeType: string): void }

export interface ChatSettingsPort { getSettings(): Settings }
export interface ChatVoicePort {
  state(): string
  dispatch(event: 'submit_text' | 'reset' | 'error' | 'reply_ready' | 'speaking_done'): boolean
  restoreThinking(): boolean
  beginTurn(): void
  speakDelta(delta: string): void
  finishStreamedTurn(): boolean
  speakReply(text: string): void
  autoSpeakActive(): boolean
  cancelSpeech(): void
  cancelTimers(): void
  resetForChatSwitch(): void
}
export interface ChatProjectsPort { listAgents(): AgentInfo[]; onTaskBadgeRuns?(badges: unknown[]): void; openTask?(projectId: string, taskId: string): void }
export interface ChatToolsPort { openTool?(kind: string, payload: unknown): void }
