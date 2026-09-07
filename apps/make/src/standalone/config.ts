// Конфигурация отдельного процесса Make — только из окружения, как у раннеров.
export interface MakeStandaloneConfig {
  host: string
  port: number
  /** Корень данных: мастерские в `<dataDir>/make/<conv>` — тот же том, что у ядра (миграции файлов нет). */
  dataDir: string
  /** Адрес ядра внутри сети compose (`http://voicechat:8787`). */
  coreUrl: string
  /** Bearer внутреннего API — общий с ядром. */
  internalToken: string
  /** Секрет `/mcp/make?k=` — общий с ядром: им ядро подписывает scope-токены рана. */
  mcpSecret: string
  /** Версия для `/v1/health` и админки. */
  version: string | null
}

export function loadMakeStandaloneConfig(env: NodeJS.ProcessEnv = process.env): MakeStandaloneConfig {
  return {
    host: env.HOST ?? '127.0.0.1',
    port: Number(env.PORT ?? 8788),
    dataDir: env.VC_MAKE_DATA_DIR ?? env.VC_DATA_DIR ?? 'data',
    coreUrl: env.VC_CORE_URL ?? 'http://127.0.0.1:8787',
    internalToken: env.VC_INTERNAL_TOKEN ?? '',
    mcpSecret: env.VC_MCP_SECRET ?? '',
    version: env.VC_RELEASE_VERSION || null
  }
}
