export interface PlaywrightReaderConfig {
  host: string
  port: number
  coreUrl: string
  internalToken: string
  runnerUrl?: string
  runnerToken?: string
  runnerFacingBase: string
  version: string | null
}

export function loadPlaywrightReaderConfig(env: NodeJS.ProcessEnv = process.env): PlaywrightReaderConfig {
  const coreUrl = env.VC_CORE_URL ?? 'http://127.0.0.1:8787'
  return {
    host: env.HOST ?? '127.0.0.1',
    port: Number(env.PORT ?? 8797),
    coreUrl,
    internalToken: env.VC_INTERNAL_TOKEN ?? '',
    runnerUrl: env.VC_BROWSER_RUNNER_URL,
    runnerToken: env.VC_BROWSER_RUNNER_TOKEN,
    runnerFacingBase: env.VC_BROWSER_PREVIEW_BASE ?? env.VC_MCP_PUBLIC_BASE ?? coreUrl,
    version: env.VC_RELEASE_VERSION || null
  }
}
