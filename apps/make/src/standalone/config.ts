// Standalone Make configuration comes only from environment variables, as with runners.
export interface MakeStandaloneConfig {
  host: string
  port: number
  /** Data root: workshops at <dataDir>/make/<conv> use the existing core data volume, without a file migration. */
  dataDir: string
  /** Core URL inside the Compose network, such as http://voicechat:8787. */
  coreUrl: string
  /** Internal API Bearer token shared with core. */
  internalToken: string
  /** Shared /mcp/make?k= secret used by core to sign run-scope tokens. */
  mcpSecret: string
  /** Version reported by /v1/health and the admin UI. */
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
