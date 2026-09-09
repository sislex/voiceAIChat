export interface ImageStudioStandaloneConfig {
  host: string
  port: number
  dataDir: string
  coreUrl: string
  internalToken: string
  version: string | null
}

export function loadImageStudioStandaloneConfig(env: NodeJS.ProcessEnv = process.env): ImageStudioStandaloneConfig {
  return {
    host: env.HOST ?? '127.0.0.1',
    port: Number(env.PORT ?? 8796),
    dataDir: env.VC_IMAGE_STUDIO_DATA_DIR ?? env.VC_DATA_DIR ?? 'data',
    coreUrl: env.VC_CORE_URL ?? 'http://127.0.0.1:8787',
    internalToken: env.VC_INTERNAL_TOKEN ?? '',
    version: env.VC_RELEASE_VERSION || null
  }
}
