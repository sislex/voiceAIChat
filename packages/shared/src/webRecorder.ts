import { PREVIEW_ACTION_LIMITS, isHttpUrl, isPreviewDomAction, type PreviewDomAction, type PreviewActionResult } from './previewActions'
import { isPreviewElementPayload, type PreviewElementPayload } from './previewInspector'

// Публичный postMessage-контракт между host ChatAI и самостоятельным
// iframe-приложением Web Reader (apps/web-recorder). Версионирован: обе стороны
// проверяют protocolVersion в handshake, а каждое рабочее сообщение несёт
// conversationId и registrationId — поздние сообщения старого iframe, чужой
// вкладки или другого разговора отбрасываются валидатором, а не логикой UI.
//
// Жизненный цикл регистрации: host на каждый валидный `ready` с незнакомым
// registrationId (первый boot, reload, полная перезагрузка HMR) создаёт новую
// регистрацию и отвечает идемпотентным `init`; `ready` с текущим registrationId —
// повтор handshake той же загрузки, host просто повторяет `init`.
export const WEB_RECORDER_MESSAGE_TYPE = 'voicechat.web-recorder.v1' as const
export const WEB_RECORDER_PROTOCOL_VERSION = 2 as const

/** Возможности Reader, объявляемые в ready (host показывает их в диагностике). */
export const WEB_RECORDER_CAPABILITIES = [
  'open', 'read', 'find', 'click', 'type', 'styles', 'inspector', 'recording', 'diagnostics'
] as const

export type WebRecorderPageStatus = 'empty' | 'loading' | 'ready' | 'error'

/** Шаг записанного сценария; у sensitive-шага значение не покидает страницу. */
export interface WebRecorderScenarioStep {
  kind: 'click' | 'type'
  selector: string
  text: string
  sensitive: boolean
  /** Только для type: Enter-отправка формы записывается и воспроизводится сабмитом. */
  submit?: boolean
}

type Envelope = { type: typeof WEB_RECORDER_MESSAGE_TYPE }
type Addressed = Envelope & { conversationId: string; registrationId: string }

export type WebRecorderHostMessage =
  | (Addressed & { kind: 'init'; protocolVersion: number; previewUrl: string | null; capabilities: readonly string[] })
  | (Addressed & { kind: 'set-url'; url: string | null })
  | (Addressed & { kind: 'command'; requestId: string; action: PreviewDomAction })
  | (Addressed & { kind: 'inspector-state'; enabled: boolean })
  | (Addressed & { kind: 'recording-state'; enabled: boolean })
  | (Addressed & { kind: 'diagnostics-start'; active: boolean })
  | (Addressed & { kind: 'dispose' })

export type WebRecorderClientMessage =
  | (Envelope & { kind: 'ready'; protocolVersion: number; conversationId: string | null; registrationId: string | null; capabilities: readonly string[] })
  | (Addressed & { kind: 'page-status'; status: WebRecorderPageStatus; url: string | null; error?: string })
  | (Addressed & { kind: 'result'; requestId: string; ok: boolean; result?: PreviewActionResult; error?: string })
  | (Addressed & { kind: 'save-url'; url: string | null })
  | (Addressed & { kind: 'element-selected'; element: PreviewElementPayload })
  | (Addressed & { kind: 'recording-step'; step: WebRecorderScenarioStep })
  | (Addressed & { kind: 'diagnostics-progress'; requestId: string; action: string; ok: boolean; durationMs: number })
  | (Addressed & { kind: 'diagnostics-complete'; total: number })
  | (Addressed & { kind: 'disposed' })

const ID_LIMIT = 128

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function bounded(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}
function nullableUrl(value: unknown): value is string | null {
  return value === null || (bounded(value, PREVIEW_ACTION_LIMITS.url) && isHttpUrl(value))
}
function capabilities(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length <= 32 && value.every((item) => bounded(item, 64))
}
function addressed(value: Record<string, unknown>): boolean {
  return bounded(value.conversationId, ID_LIMIT) && bounded(value.registrationId, ID_LIMIT)
}
function envelope(value: unknown): value is Record<string, unknown> {
  return record(value) && value.type === WEB_RECORDER_MESSAGE_TYPE
}

/** Валидатор сообщения host → Reader: форма проверяется целиком на приёме. */
export function isWebRecorderHostMessage(value: unknown): value is WebRecorderHostMessage {
  if (!envelope(value) || !addressed(value)) return false
  switch (value.kind) {
    case 'init':
      return value.protocolVersion === WEB_RECORDER_PROTOCOL_VERSION && nullableUrl(value.previewUrl) && capabilities(value.capabilities)
    case 'set-url':
      return nullableUrl(value.url)
    case 'command':
      return bounded(value.requestId, ID_LIMIT) && isPreviewDomAction(value.action)
    case 'inspector-state':
    case 'recording-state':
      return typeof value.enabled === 'boolean'
    case 'diagnostics-start':
      return typeof value.active === 'boolean'
    case 'dispose':
      return true
    default:
      return false
  }
}

/** Валидатор сообщения Reader → host. Только `ready` допускает пустые ID (boot). */
export function isWebRecorderClientMessage(value: unknown): value is WebRecorderClientMessage {
  if (!envelope(value)) return false
  if (value.kind === 'ready') {
    return (
      value.protocolVersion === WEB_RECORDER_PROTOCOL_VERSION &&
      (value.conversationId === null || bounded(value.conversationId, ID_LIMIT)) &&
      (value.registrationId === null || bounded(value.registrationId, ID_LIMIT)) &&
      capabilities(value.capabilities)
    )
  }
  if (!addressed(value)) return false
  switch (value.kind) {
    case 'page-status':
      return (
        (value.status === 'empty' || value.status === 'loading' || value.status === 'ready' || value.status === 'error') &&
        nullableUrl(value.url) &&
        (value.error === undefined || bounded(value.error, 2_000))
      )
    case 'result': {
      if (!bounded(value.requestId, ID_LIMIT) || typeof value.ok !== 'boolean') return false
      if (value.error !== undefined && !bounded(value.error, 2_000)) return false
      if (value.result === undefined) return true
      if (!record(value.result)) return false
      try {
        return JSON.stringify(value.result).length <= PREVIEW_ACTION_LIMITS.resultJson
      } catch {
        return false
      }
    }
    case 'save-url':
      return nullableUrl(value.url)
    case 'element-selected':
      return isPreviewElementPayload(value.element)
    case 'recording-step': {
      if (!record(value.step)) return false
      const step = value.step
      if (step.kind !== 'click' && step.kind !== 'type') return false
      if (!bounded(step.selector, PREVIEW_ACTION_LIMITS.selector) || typeof step.sensitive !== 'boolean') return false
      // Сабмит — свойство ввода: click с submit невалиден.
      if (step.submit !== undefined && (typeof step.submit !== 'boolean' || step.kind !== 'type')) return false
      // Значение секретного поля не должно покидать Reader ни в каком сообщении.
      if (step.sensitive) return step.text === ''
      return typeof step.text === 'string' && step.text.length <= PREVIEW_ACTION_LIMITS.text
    }
    case 'diagnostics-progress':
      return bounded(value.requestId, ID_LIMIT) && bounded(value.action, 64) && typeof value.ok === 'boolean' &&
        typeof value.durationMs === 'number' && Number.isFinite(value.durationMs)
    case 'diagnostics-complete':
      return typeof value.total === 'number' && Number.isInteger(value.total) && value.total >= 0
    case 'disposed':
      return true
    default:
      return false
  }
}
