import type { RendererApi, RendererMakeBridge } from '@shared/ipc'
import type { EditorContextPayload } from '@shared/types'
import type { ConversationUsage } from '@shared/usageSummary'


export interface MakePaneProps {
  conversationId: string
  api: Pick<RendererApi, 'make:state' | 'make:read' | 'make:write' | 'make:delete' | 'make:rename' | 'make:snapshot' | 'make:restore' | 'make:reset' | 'make:publish' | 'make:unpublish' | 'make:check' | 'make:template' | 'make:upload' | 'make:search' | 'make:stories' | 'make:snapshotDiff' | 'make:restoreFile' | 'make:import' | 'make:importUrl' | 'make:snapshotFile' | 'make:replace' | 'make:shots' | 'make:shot' | 'make:library' | 'make:libraryExport' | 'make:libraryInsert' | 'make:libraryRemove' | 'make:usage' | 'make:cleanup' | 'make:comments' | 'make:commentAdd' | 'make:commentUpdate' | 'make:commentRemove' | 'make:share' | 'make:unshare' | 'make:shareGrant' | 'make:presence' | 'make:tests' | 'make:notes' | 'make:setNotes' | 'make:taskLinks' | 'make:linkTask' | 'make:linkableTasks' | 'make:projectFiles' | 'make:projectLinks' | 'make:projectPull'
  | 'projects:gitWorkspaces' | 'projects:components' | 'projects:componentStories'
  | 'projects:storybookSession' | 'projects:storybookAction'
  | 'projects:gitFile' | 'projects:gitSaveFile' | 'projects:componentTicket'
  | 'projects:storybookOpen' | 'projects:storybookCloseTunnel'>
  make?: RendererMakeBridge
  /** Insert a request about the selected element into the chat composer. */
  onInsertToChat?: (text: string) => void
  /** Send a message to the assistant immediately from the error banner's fix action. */
  onAskAssistant?: (text: string) => void
  /** Attach a file, such as a preview screenshot, to a chat message. */
  onAttachImage?: (file: File) => void
  /** Open file and selection, included by the host in the next chat message (item 21). */
  onEditorContext?: (ctx: EditorContextPayload | null) => void
  /** Total project conversation cost shown in the header (item 24). */
  usage?: ConversationUsage | null
  /** Assistant turn state: capture before at turn start and after once edits finish (roadmap-2, item 8). */
  turnActive?: boolean
  /** Latest user request for checking the result against the original instruction (roadmap-4, item 5). */
  lastRequest?: string | null
  /** Question mode (roadmap-4, item 4): send the next turn in Plan mode for an answer without edits. */
  askOnly?: boolean
  onAskOnlyChange?: (on: boolean) => void
  /** Preview base URL; defaults to REST.makePreview and can be replaced in tests. */
  previewBase?: string
  /**
   * Preview cookie gate: iframes cannot send Bearer headers, so the server issues preview-cookie
   * before the first load via session:ensurePreview, as with Web Reader.
   */
  localAgentId?: string | null
  ensurePreview?: () => Promise<boolean>
  /** Open the linked task card from the project-task dialog. */
  onOpenTask?: (projectId: string, taskId: string) => void
  /**
   * Conversation project: enables the Project tab with repository components from a machine working
   * copy and the project's Storybook.
   */
  projectId?: string | null
  /** Autosave delay, shortened in tests. */
  autosaveDelayMs?: number
}

export interface MakeSharedViewProps {
  token: string
  api: Pick<RendererApi, 'make:shared' | 'make:sharedFile' | 'make:write'>
  ensurePreview?: () => Promise<boolean>
  onBack: () => void
}
