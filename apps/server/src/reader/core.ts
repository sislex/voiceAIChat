// Порт «что Web Reader берёт у процесса ядра» (docs/plans/web-reader-service.md). Всё остальное ридер
// читает из базы сам; здесь — только состояние, которое живёт в памяти ядра: сокеты пользователей
// (действие в панели), реестр ключей Chromium (его проверяет авторизация ядра), список живых
// feature-preview (канбан ядра или его порт) и кадры браузерной проверки (файл на диске ядра, строка в
// ленту рана). Локальная реализация — `readerBridge/localCore.ts`, по HTTP — `reader/standalone/httpCore.ts`.
import type { PreviewAction, PreviewEnvironment } from '@voicechat/shared'
import type { PreviewActionOutcome } from '../mcp/previewMcp.js'

export interface ReaderCore {
  /** Действие в панели браузера пользователя: уходит WS-клиентам ядра, ответ — первый успех либо все отказы/таймаут. */
  previewAction(userId: string, conversationId: string, action: PreviewAction, timeoutMs?: number): Promise<PreviewActionOutcome>
  /** Ключ, которым изолированный Chromium авторизуется на прокси превью от лица пользователя. */
  issuePreviewRunKey(userId: string): string | Promise<string>
  /** Живые feature-preview окружения всех проектов (фильтрует вызывающий). */
  listPreviews(): Promise<PreviewEnvironment[]>
  /** Кадр браузерной проверки: файл у ядра и строка в ленту активного рана задачи разговора; нет рана — ничего. */
  logBrowserShot(userId: string, conversationId: string, pngBase64: string): Promise<void>
}
