import { createRpcClient, INTERNAL_PLAYWRIGHT_READER_SERVICE_PATH } from '@voicechat/shared'
import type { PlaywrightReaderService } from './service.js'

/** Один клиент для ядра и отдельного Web Reader: результат Chromium никогда не уходит в iframe relay. */
export function createRemotePlaywrightReader(opts: { baseUrl: string; token: string; fetchImpl?: typeof fetch }): PlaywrightReaderService {
  const rpc = createRpcClient({ ...opts, path: INTERNAL_PLAYWRIGHT_READER_SERVICE_PATH, timeoutMs: 120_000 })
  return {
    execute: (...args) => rpc('execute', ...args),
    screenshot: (...args) => rpc('screenshot', ...args)
  }
}
