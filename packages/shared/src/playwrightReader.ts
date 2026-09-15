import type { BrowserDownloadCommand, BrowserDownloadResult } from './browserDownloads'
import type { BrowserDialogAnswer, BrowserDialogListResult } from './browserDialogs'
import type { BrowserSiteDataResetOptions, BrowserSiteDataResetResult } from './browserProfile'
import { READER_PROJECT_ORIGIN } from './previewProject'
// Граница приложения Playwright Reader: пользовательский REST остаётся /api/browser,
// а ядро и отдельный процесс обмениваются только этими RPC и результатами действий.
import type { BrowserCookieInfo, BrowserCookieRequest, BrowserDeviceOptions, BrowserDeviceState, BrowserEnvironmentOptions, BrowserEnvironmentState, BrowserHistoryEntry, BrowserTouchAction, BrowserInspectResult, BrowserSelectorResult, BrowserSessionMetadata, BrowserScreenshotMetadata, BrowserScreenshotOptions } from './types'
import type { BrowserFramesResult } from './browserFrames'
import type { PreviewActionResult } from './previewActions'
import { BROWSER_COMMAND_BODY_LIMIT } from './browserLimits'

export const INTERNAL_PLAYWRIGHT_READER_CORE_PATH = '/internal/playwright-reader/core'
export const INTERNAL_PLAYWRIGHT_READER_SERVICE_PATH = '/internal/playwright-reader/service'
export const PLAYWRIGHT_READER_CORE_METHODS = ['conversation', 'modelTarget', 'issuePreviewRunKey', 'logBrowserShot'] as const
export const PLAYWRIGHT_READER_SERVICE_METHODS = ['execute', 'screenshot', 'control'] as const
export const PLAYWRIGHT_READER_RPC_BODY_LIMIT = BROWSER_COMMAND_BODY_LIMIT

/** Управление Chromium отдельно от действий iframe: вкладки и живое дерево документов существуют у раннера. */
export type BrowserControlCommand =
  | { type: 'status' | 'reload' | 'stop' | 'frames' }
  | BrowserDownloadCommand
  | { type: 'dialogs'; tabId?: string }
  | ({ type: 'handleDialog' } & BrowserDialogAnswer)
  | ({ type: 'clearSiteData' } & BrowserSiteDataResetOptions)
  | { type: 'newTab'; url?: string }
  | { type: 'selectTab' | 'closeTab'; tabId: string }
  | ({ type: 'environment' } & BrowserEnvironmentOptions)
  | ({ type: 'cookies' } & BrowserCookieRequest)
  | { type: 'history'; actor?: 'user' | 'assistant'; limit?: number; clear?: boolean }
  | { type: 'note'; text: string }
  | { type: 'ask'; text: string; timeoutMs?: number }
  | ({ type: 'device' } & BrowserDeviceOptions)
  | ({ type: 'touch' } & BrowserTouchAction)

export type BrowserModelScreenshotOptions = Pick<BrowserScreenshotOptions, 'selector' | 'rect' | 'fullPage' | 'animations' | 'timeoutMs' | 'frame'>
/** Старый раннер может вернуть только изображение: неизвестные размеры не выдумываем. */
export interface BrowserImageResult extends Partial<BrowserScreenshotMetadata> { dataUrl: string }

/** Эмуляция среды и cookies: ответ показывает, что теперь в силе. */
export interface BrowserEnvironmentResult { environment: BrowserEnvironmentState }
export interface BrowserCookiesResult { cookies: BrowserCookieInfo[]; total: number }
/** Итог просьбы к человеку: сделал, отказался или не ответил вовремя. */
export interface BrowserAskResult { ask: { id: string; done: boolean; text?: string; timedOut?: boolean; waitedMs: number } }

/** Эмулированное устройство: что теперь считает страница о посетителе. */
export interface BrowserDeviceResult { device: BrowserDeviceState }

/** Журнал сессии: что делали человек и модель, в порядке событий. */
export interface BrowserHistoryResult { history: { total: number; entries: BrowserHistoryEntry[] } }

export interface BrowserActionOutcome {
  ok: boolean
  result?: PreviewActionResult | BrowserSessionMetadata | BrowserSelectorResult | BrowserInspectResult | BrowserImageResult | BrowserFramesResult | BrowserSiteDataResetResult | BrowserDialogListResult | BrowserDownloadResult | BrowserEnvironmentResult | BrowserCookiesResult | BrowserHistoryResult | BrowserDeviceResult | BrowserAskResult
  error?: string
}

export const MACHINE_PREVIEW_SUFFIX = '.machine.internal'
export const PREVIEW_RUN_COOKIE = 'vc_preview_run'

/** Chromium открывает loopback машины через авторизованный прокси ядра. */
export function isMachinePreviewUrl(raw: string): boolean {
  try { return new URL(raw).hostname.toLowerCase().endsWith(MACHINE_PREVIEW_SUFFIX) } catch { return false }
}

export function machinePreviewUrl(runnerFacingBase: string, raw: string): string {
  let project = false
  try { project = new URL(raw).origin === READER_PROJECT_ORIGIN } catch { /* не URL */ }
  if (!project && !isMachinePreviewUrl(raw)) return raw
  return `${runnerFacingBase.replace(/\/+$/, '')}/api/preview?url=${encodeURIComponent(raw)}`
}
