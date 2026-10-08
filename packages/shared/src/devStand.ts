/** Defaults describe local development; stand allocation supplies actual ports. */
export const DEV_COMPONENT_REGISTRY = {
  core: { repository: 'sislex/voiceAIChat', defaultPort: 8787, routePrefixes: ['/api', '/ws'], readinessPath: '/api/health' },
  'core-ui': { repository: 'sislex/sislexa-core-ui', defaultPort: 5273, routePrefixes: ['/'], readinessPath: '/' },
  make: { repository: 'sislex/make', defaultPort: 8788, routePrefixes: ['/api/make', '/api/preview/make', '/api/preview/make-shared', '/p/', '/s/'], readinessPath: '/api/health' },
  kanban: { repository: 'sislex/sislexa-kanban', defaultPort: 8789, routePrefixes: [], readinessPath: '/api/health' },
  'playwright-reader': { repository: 'sislex/playwrightreader', defaultPort: 8797, routePrefixes: ['/api/browser'], readinessPath: '/api/health' },
  'image-studio': { repository: 'sislex/image-studio', defaultPort: 8796, routePrefixes: ['/api/image-studio', '/g/'], readinessPath: '/api/health' }
} as const
export type DevComponentId = keyof typeof DEV_COMPONENT_REGISTRY
export const DEV_COMPONENT_IDS = Object.keys(DEV_COMPONENT_REGISTRY) as DevComponentId[]

const SHA = /^[a-f0-9]{40}$/
const isCommitSha = (value: unknown): value is string => typeof value === 'string' && value.length === 40 && SHA.test(value)
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const BUILD = /^((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))-dev\.([a-f0-9]{12})$/

/** Only release versions and full, lowercase commit SHAs can create dev IDs. */
export function formatDevBuildId(version: string, sha: string): string {
  if (version.trim() !== version || !VERSION.test(version) || !isCommitSha(sha)) throw new Error('invalid_dev_build_id')
  return `${version}-dev.${sha.slice(0, 12)}`
}
export function parseDevBuildId(value: unknown): { version: string; sha12: string } | null {
  if (typeof value !== 'string' || value.trim() !== value) return null
  const match = BUILD.exec(value)
  return match ? { version: match[1], sha12: match[2] } : null
}
export function isDevBuildVersion(value: unknown): value is string {
  return parseDevBuildId(value) !== null
}

export interface DevStandComponent {
  repository: string
  sha: string
  source: 'base' | 'dev'
  devBuildId?: string
  url?: string
  /** Unix milliseconds. */
  startedAt?: number
}
export interface DevStandManifest {
  schemaVersion: 1
  standId: string
  machineId: string
  baseEnvironmentId: string
  components: Record<DevComponentId, DevStandComponent>
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value))
}
function keys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  return required.every(key => Object.hasOwn(value, key))
    && Object.keys(value).every(key => required.includes(key) || optional.includes(key))
}
const identifier = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() === value && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value)
const repository = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() === value && /^[a-zA-Z0-9][a-zA-Z0-9_.-]*\/[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(value)
function httpUrl(value: unknown): boolean {
  if (typeof value !== 'string' || !/^https?:\/\//.test(value) || /[\s\\]/.test(value)) return false
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !!url.hostname && !url.username && !url.password && !url.hash
  } catch { return false }
}

/** Strict schema-1 boundary: no defaults, unknown fields, or partial component maps. */
export function isDevStandManifest(value: unknown): value is DevStandManifest {
  if (!record(value) || !keys(value, ['schemaVersion', 'standId', 'machineId', 'baseEnvironmentId', 'components'])
    || value.schemaVersion !== 1 || !identifier(value.standId) || !identifier(value.machineId)
    || !identifier(value.baseEnvironmentId) || !record(value.components)
    || !keys(value.components, DEV_COMPONENT_IDS)) return false
  const components = value.components
  return DEV_COMPONENT_IDS.every(id => {
    const component = components[id]
    if (!record(component) || !keys(component, ['repository', 'sha', 'source'], ['devBuildId', 'url', 'startedAt'])
      || !repository(component.repository) || !isCommitSha(component.sha)
      || !['base', 'dev'].includes(component.source as string)) return false
    if (Object.hasOwn(component, 'devBuildId')) {
      const build = parseDevBuildId(component.devBuildId)
      if (component.source !== 'dev' || !build || build.sha12 !== component.sha.slice(0, 12)) return false
    }
    return (!Object.hasOwn(component, 'url') || httpUrl(component.url))
      && (!Object.hasOwn(component, 'startedAt') || (typeof component.startedAt === 'number'
        && Number.isSafeInteger(component.startedAt) && component.startedAt >= 0))
  })
}
export function validateDevStandManifest(value: unknown): DevStandManifest {
  if (!isDevStandManifest(value)) throw new Error('invalid_dev_stand_manifest')
  return value
}

/** Agent-facing gateway contract, versioned independently of package releases. */
export const DEV_GATEWAY_VERSION = '1.0.0'
export const DEV_GATEWAY_HEALTH_PATH = '/__gateway/health'
export interface DevGatewayHealth {
  version: string
  standId: string
  components: Record<DevComponentId, { reachable: boolean; statusCode?: number }>
}

/** Gateway consumes routing fields only; owner gateway metadata is opaque. */
export function readDevGatewayManifest(value: unknown, warn: (message: string) => void): DevStandManifest {
  if (!record(value)) throw new Error('invalid_dev_stand_manifest')
  const fields = ['schemaVersion', 'standId', 'machineId', 'baseEnvironmentId', 'components']
  const manifest = validateDevStandManifest(Object.fromEntries(
    fields.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]])))
  for (const key of Object.keys(value)) {
    if (!fields.includes(key) && key !== 'gateway')
      warn(`dev_gateway_unknown_manifest_field: ${JSON.stringify(key)}`)
  }
  return manifest
}

export interface CreateDevStandRequest { machineId: string; baseEnvironmentId: string }
export type CreateDevStandResponse = DevStandManifest
export type ListDevStandsResponse = DevStandManifest[]
export type GetDevStandResponse = DevStandManifest
/** Branch resolution happens at the owner before RPC; exactly one ref is accepted. */
export type StartDevStandComponentRequest = { repository: string } & (
  | { sha: string; branch?: never }
  | { branch: string; sha?: never }
)
export type StartDevStandComponentResponse = DevStandManifest
export type ResetDevStandComponentResponse = DevStandManifest

export function isStartDevStandComponentRequest(value: unknown): value is StartDevStandComponentRequest {
  if (!record(value) || !repository(value.repository)) return false
  if (keys(value, ['repository', 'sha'])) return isCommitSha(value.sha)
  return keys(value, ['repository', 'branch']) && typeof value.branch === 'string'
    && value.branch.length > 0 && value.branch.length <= 255
    && !/[\s~^:?*\[\\\x00-\x1f\x7f]/.test(value.branch)
    && !value.branch.includes('..') && !value.branch.includes('@{')
    && value.branch !== '@' && !value.branch.startsWith('-')
    && value.branch.split('/').every(part => !!part && !part.startsWith('.') && !part.endsWith('.') && !part.endsWith('.lock'))
}
export function isCreateDevStandRequest(value: unknown): value is CreateDevStandRequest {
  return record(value) && keys(value, ['machineId', 'baseEnvironmentId'])
    && identifier(value.machineId) && identifier(value.baseEnvironmentId)
}

/** Stable wire codes; messages are diagnostic, never used for branching. */
export const DEV_STAND_ERROR_STATUS = {
  invalid_request: 400, invalid_manifest: 400, unknown_component: 400,
  unauthorized: 401, forbidden: 403, stand_not_found: 404, base_environment_not_found: 404,
  repository_not_found: 404, ref_not_found: 404, operation_conflict: 409,
  machine_unavailable: 503, port_unavailable: 503, repository_unavailable: 502,
  dependency_failed: 502, process_start_failed: 502, process_stop_failed: 502,
  readiness_timeout: 504, internal_error: 500
} as const
export type DevStandErrorCode = keyof typeof DEV_STAND_ERROR_STATUS
export const DEV_STAND_ERROR_CODES = Object.keys(DEV_STAND_ERROR_STATUS) as DevStandErrorCode[]
export interface DevStandErrorResponse { error: DevStandErrorCode; message: string }
