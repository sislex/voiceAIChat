import { READER_PROJECT_ORIGIN } from './previewProject'
// Граница приложения Playwright Reader: пользовательский REST остаётся /api/browser,
// а ядро и отдельный процесс обмениваются только этими RPC и результатами действий.
import type { BrowserInspectResult, BrowserSelectorResult, BrowserSessionMetadata } from './types'
import type { PreviewActionResult } from './previewActions'

export const INTERNAL_PLAYWRIGHT_READER_CORE_PATH = '/internal/playwright-reader/core'
export const INTERNAL_PLAYWRIGHT_READER_SERVICE_PATH = '/internal/playwright-reader/service'
export const PLAYWRIGHT_READER_CORE_METHODS = ['conversation', 'modelTarget', 'issuePreviewRunKey', 'logBrowserShot'] as const
export const PLAYWRIGHT_READER_SERVICE_METHODS = ['execute', 'screenshot'] as const
export const PLAYWRIGHT_READER_RPC_BODY_LIMIT = 16 * 1024 * 1024

export interface BrowserActionOutcome {
  ok: boolean
  result?: PreviewActionResult | BrowserSessionMetadata | BrowserSelectorResult | BrowserInspectResult
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
