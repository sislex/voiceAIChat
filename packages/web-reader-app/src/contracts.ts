import type { Conversation } from '@shared/types'
import type { PreviewAction, PreviewActionResult } from '@shared/previewActions'

export interface ReaderChatPort {
  list(): Promise<readonly Conversation[]>
  get(id: string): Promise<Conversation | null>
  create(kind: 'web-recorder'): Promise<Conversation>
  remove(id: string): Promise<void>
  setPreviewUrl(id: string, url: string | null): Promise<Conversation | null>
  render(conversationId: string | null): import('react').ReactNode
  subscribe(listener: () => void): () => void
}
export interface RecorderState { ready: boolean; page: 'empty'|'loading'|'ready'|'error'; error?: string }
export interface WebRecorderPort {
  state(): RecorderState
  setUrl(url: string | null): void
  run(requestId: string, action: PreviewAction): Promise<PreviewActionResult>
  subscribe(listener: (state: RecorderState) => void): () => void
  dispose(): void
}
export interface PreviewRelayPort {
  subscribe(listener: (request: { conversationId: string; requestId: string; action: PreviewAction }) => void): () => void
  result(conversationId: string, requestId: string, result: PreviewActionResult): void
}
export interface WebReaderHostPort { projectPreviewUrl(projectId: string): Promise<string | null>; recorder(conversationId: string): WebRecorderPort; relay: PreviewRelayPort }
