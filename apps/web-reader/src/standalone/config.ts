import { fileURLToPath } from 'node:url'

export interface WebReaderConfig {
  host: string
  port: number
  coreUrl: string
  internalToken: string
  mcpSecret: string
  playwrightReaderUrl: string
  webRecorderDir: string
  version: string | null
}
export function loadWebReaderConfig(env: NodeJS.ProcessEnv = process.env): WebReaderConfig {
  const coreUrl = env.VC_CORE_URL || 'http://127.0.0.1:8787'
  if (env.VC_PLAYWRIGHT_READER_MODE === 'remote' && !env.VC_PLAYWRIGHT_READER_URL) throw new Error('VC_PLAYWRIGHT_READER_MODE=remote требует VC_PLAYWRIGHT_READER_URL')
  return {
    host: env.HOST || '127.0.0.1', port: Number(env.PORT || 8795), coreUrl,
    internalToken: env.VC_INTERNAL_TOKEN || '', mcpSecret: env.VC_MCP_SECRET || '',
    playwrightReaderUrl: env.VC_PLAYWRIGHT_READER_MODE === 'embedded' ? coreUrl : env.VC_PLAYWRIGHT_READER_URL || coreUrl,
    webRecorderDir: env.VC_WEB_RECORDER_DIR || fileURLToPath(new URL('../../../web-recorder/dist', import.meta.url)),
    version: env.VC_RELEASE_VERSION || null
  }
}
