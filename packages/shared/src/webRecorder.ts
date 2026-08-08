import type { PreviewDomAction, PreviewActionResult } from './previewActions'
import type { PreviewElementPayload } from './previewInspector'

/** Public postMessage contract between ChatAI host and the standalone web recorder. */
export const WEB_RECORDER_MESSAGE_TYPE = 'voicechat.web-recorder.v1' as const
export type WebRecorderHostMessage =
  | { type: typeof WEB_RECORDER_MESSAGE_TYPE; kind: 'set-url'; url: string | null }
  | { type: typeof WEB_RECORDER_MESSAGE_TYPE; kind: 'run-action'; requestId: string; action: PreviewDomAction }
export type WebRecorderClientMessage =
  | { type: typeof WEB_RECORDER_MESSAGE_TYPE; kind: 'ready' }
  | { type: typeof WEB_RECORDER_MESSAGE_TYPE; kind: 'save-url'; url: string | null }
  | { type: typeof WEB_RECORDER_MESSAGE_TYPE; kind: 'element'; element: PreviewElementPayload }
  | { type: typeof WEB_RECORDER_MESSAGE_TYPE; kind: 'action-result'; requestId: string; ok: boolean; result?: PreviewActionResult; error?: string }
