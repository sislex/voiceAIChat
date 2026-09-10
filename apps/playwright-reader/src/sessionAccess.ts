import { PREVIEW_RUN_COOKIE } from '@voicechat/shared'
import type { BrowserStartInput } from '@voicechat/browser-runner/client'
import type { PlaywrightReaderCore } from './core.js'

/** Ручная панель и модель открывают одну страницу с одинаковым доступом к прокси. */
export async function previewSessionCookies(core: PlaywrightReaderCore, userId: string, runnerFacingBase: string): Promise<NonNullable<BrowserStartInput['cookies']>> {
  return [{
    name: PREVIEW_RUN_COOKIE,
    value: await core.issuePreviewRunKey(userId),
    url: `${runnerFacingBase.replace(/\/+$/, '')}/api/preview`
  }]
}
