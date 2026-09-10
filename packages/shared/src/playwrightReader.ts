import type { BrowserSiteDataResetOptions, BrowserSiteDataResetResult } from './browserProfile'
// Граница приложения Playwright Reader: пользовательский REST остаётся /api/browser,
// а ядро и отдельный процесс обмениваются только этими RPC и результатами действий.
import type { BrowserInspectResult, BrowserSelectorResult, BrowserSessionMetadata, BrowserScreenshotMetadata, BrowserScreenshotOptions } from './types'
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
  | ({ type: 'clearSiteData' } & BrowserSiteDataResetOptions)
  | { type: 'newTab'; url?: string }
  | { type: 'selectTab' | 'closeTab'; tabId: string }

export type BrowserModelScreenshotOptions = Pick<BrowserScreenshotOptions, 'selector' | 'rect' | 'fullPage' | 'animations' | 'timeoutMs' | 'frame'>
/** Старый раннер может вернуть только изображение: неизвестные размеры не выдумываем. */
export interface BrowserImageResult extends Partial<BrowserScreenshotMetadata> { dataUrl: string }

export interface BrowserActionOutcome {
  ok: boolean
  result?: PreviewActionResult | BrowserSessionMetadata | BrowserSelectorResult | BrowserInspectResult | BrowserImageResult | BrowserFramesResult | BrowserSiteDataResetResult
  error?: string
}

export const MACHINE_PREVIEW_SUFFIX = '.machine.internal'
export const PREVIEW_RUN_COOKIE = 'vc_preview_run'

/** Chromium открывает loopback машины через авторизованный прокси ядра. */
export function isMachinePreviewUrl(raw: string): boolean {
  try { return new URL(raw).hostname.toLowerCase().endsWith(MACHINE_PREVIEW_SUFFIX) } catch { return false }
}

export function machinePreviewUrl(runnerFacingBase: string, raw: string): string {
  if (!isMachinePreviewUrl(raw)) return raw
  return `${runnerFacingBase.replace(/\/+$/, '')}/api/preview?url=${encodeURIComponent(raw)}`
}
