import { createRpcClient, INTERNAL_PLAYWRIGHT_READER_CORE_PATH } from '@voicechat/shared'
import type { PlaywrightReaderCore } from './core.js'

export function createHttpPlaywrightReaderCore(opts: { coreUrl: string; token: string; fetchImpl?: typeof fetch }): PlaywrightReaderCore {
  const rpc = createRpcClient({ ...opts, baseUrl: opts.coreUrl, path: INTERNAL_PLAYWRIGHT_READER_CORE_PATH, timeoutMs: 30_000 })
  return {
    conversation: (...args) => rpc('conversation', ...args),
    modelTarget: (...args) => rpc('modelTarget', ...args),
    issuePreviewRunKey: (...args) => rpc('issuePreviewRunKey', ...args),
    logBrowserShot: async (...args) => { await rpc('logBrowserShot', ...args) }
  }
}
