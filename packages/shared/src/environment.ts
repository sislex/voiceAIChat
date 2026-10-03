import { normalizeMachineStoragePath, validateStorageRelativePath } from './projects.js'
import { APPLICATION_CATALOG } from './applicationCatalog.js'

export const ENVIRONMENT_SETTINGS: readonly EnvironmentSettingDefinition[] = [
  {
    "key": "VC_ADMIN_PASSWORD",
    "label": "Пароль администратора",
    "secret": true,
    "required": true,
    "generated": false
  },
  {
    "key": "VC_PG_PASSWORD",
    "label": "Пароль PostgreSQL",
    "secret": true,
    "required": false,
    "generated": true
  },
  {
    "key": "VC_INTERNAL_TOKEN",
    "label": "Внутренний токен",
    "secret": true,
    "required": false,
    "generated": true
  },
  {
    "key": "VC_MCP_SECRET",
    "label": "Секрет MCP",
    "secret": true,
    "required": false,
    "generated": true
  },
  {
    "key": "VC_LLM_RUNNER_TOKEN",
    "label": "Токен LLM Runner",
    "secret": true,
    "required": false,
    "generated": true
  },
  {
    "key": "VC_TTS_RUNNER_TOKEN",
    "label": "Токен TTS Runner",
    "secret": true,
    "required": false,
    "generated": true
  },
  {
    "key": "VC_STT_RUNNER_TOKEN",
    "label": "Токен STT Runner",
    "secret": true,
    "required": false,
    "generated": true
  },
  {
    "key": "VC_BROWSER_RUNNER_TOKEN",
    "label": "Токен Browser Runner",
    "secret": true,
    "required": false,
    "generated": true
  },
  {
    "key": "VC_AUTOMATION_RUNNER_TOKEN",
    "label": "Токен Automation Runner",
    "secret": true,
    "required": false,
    "generated": true
  },
  {
    "key": "VC_SMTP_URL",
    "label": "Адрес SMTP",
    "secret": true,
    "required": false,
    "generated": false
  },
  {
    "key": "VC_GITHUB_TOKEN",
    "label": "Токен GitHub",
    "secret": true,
    "required": false,
    "generated": false
  },
  {
    "key": "VC_CLAUDE_UPSTREAM_API_KEY",
    "label": "Ключ API Claude",
    "secret": true,
    "required": false,
    "generated": false
  },
  {
    "key": "VC_PUBLIC_URL",
    "label": "Публичный адрес",
    "secret": false,
    "required": false,
    "generated": false
  },
  {
    "key": "VC_MAIL_FROM",
    "label": "Отправитель почты",
    "secret": false,
    "required": false,
    "generated": false
  },
  {
    "key": "VC_BROWSER_HOST_ALIASES",
    "label": "Псевдонимы хостов браузера",
    "secret": false,
    "required": false,
    "generated": false
  },
  {
    "key": "VC_DELEGATED_CHAT_ENABLED",
    "label": "Делегированный чат",
    "secret": false,
    "required": false,
    "generated": false
  },
  {
    "key": "VC_CLAUDE_GATEWAY_BACKEND",
    "label": "Сервер шлюза Claude",
    "secret": false,
    "required": false,
    "generated": false
  },
  {
    "key": "VC_CLAUDE_UPSTREAM_URL",
    "label": "Адрес сервера Claude",
    "secret": false,
    "required": false,
    "generated": false
  },
  {
    "key": "VC_CLAUDE_UPSTREAM_AUTH",
    "label": "Авторизация сервера Claude",
    "secret": false,
    "required": false,
    "generated": false
  },
  {
    "key": "VC_CLAUDE_MODEL_MAP",
    "label": "Сопоставление моделей Claude",
    "secret": false,
    "required": false,
    "generated": false
  }
]

/** Computed by provisioning; never accepted from users. */
export const RESERVED_ENVIRONMENT_SETTINGS: readonly string[] = [
  "VC_ENVIRONMENT_ID",
  "COMPOSE_PROJECT_NAME",
  "COMPOSE_FILE",
  "COMPOSE_PROFILES",
  "COMPOSE_PARALLEL_LIMIT",
  "COMPOSE_BAKE",
  "VC_STAND_PORT",
  "VC_DATA_VOLUME",
  "VC_PUBLIC_HOST",
  "VC_ENVIRONMENT_OVERRIDES",
  "VC_DB_URL",
  "VC_KANBAN_MODE",
  "VC_RELEASE_VERSION",
  "VC_RELEASE_COMMIT"
]

/** environments-v2: who owns the environment checkout. */
export type EnvironmentMode = 'external' | 'managed'
/** Lifecycle of a managed stand. An external environment is always 'ready'. */
export type EnvironmentState = 'draft' | 'provisioning' | 'ready' | 'failed' | 'removing' | 'removed'


export interface EnvironmentDefinition {
  mode: EnvironmentMode
  storageId: string | null
  state: EnvironmentState
  composeProject: string | null
  port: number | null
  id: string
  projectId: string
  name: string
  machines: string[]
  checkoutPath: string
  createdBy: string
  createdAt: number
  updatedAt: number
}


export interface ModuleSelection {
  repository: string
  version: string
  commit: string
  /** Omitted to run the module on the environment's primary machine. */
  machineId?: string
}

export type EnvironmentData = 'empty' | 'production-snapshot'

export interface EnvironmentLink {
  id: string
  environmentId: string
  service: string
  clientMachineId: string
  serverMachineId: string
  servicePort: number
  listenPort: number
  state: 'pending' | 'open' | 'down'
}


export interface EnvironmentConfiguration {
  core: CoreSelection | null
  id: string
  environmentId: string
  revision: number
  modules: ModuleSelection[]
  note: string | null
  createdBy: string
  createdAt: number
}


export interface ObservedService {
  service: string
  image: string
  imageId: string
  repository: string | null
  commit: string | null
  version: string | null
  local: boolean
  healthy: boolean | null
}

export interface EnvironmentObservation {
  environmentId: string
  machineId: string
  observedAt: number
  core: { version: string | null; commit: string | null }
  services: ObservedService[]
}


export type ModuleAction =
  | 'none'
  | 'switch'
  | 'needs_core_release'
  | 'local_build'
  | 'unavailable'

export interface ModuleDiff {
  repository: string
  name: string
  services: string[]
  desired: { version: string; commit: string } | null
  actual: { version: string | null; commit: string | null } | null
  action: ModuleAction
  reason: string | null
}

export type EnvironmentOperationStatus =
  | 'pending' | 'preparing' | 'pulling' | 'building' | 'starting' | 'switching' | 'health_check'
  | 'removing' | 'succeeded' | 'failed' | 'rolled_back'

export interface EnvironmentOperationStep {
  kind?: 'service' | 'stage'
  service: string
  from: string | null
  to: string
  status: 'pending' | 'running' | 'passed' | 'failed'
  log: string
}

export interface EnvironmentOperation {
  kind: EnvironmentOperationKind
  id: string
  environmentId: string
  configurationId: string
  previousConfigurationId: string | null
  status: EnvironmentOperationStatus
  steps: EnvironmentOperationStep[]
  startedBy: string
  startedAt: number
  finishedAt: number | null
  error: string | null
}
/** Parse canonical release identities without coercion. */
export function parseModuleSelections(value: unknown): ModuleSelection[] {
  if (!Array.isArray(value)) throw new Error('Expected module selections array')
  const seen = new Set<string>()
  return Array.from(value, item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid module selection')
    const keys = Object.keys(item)
    if (keys.length < 3 || keys.length > 4 || keys.some(key => !['repository', 'version', 'commit', 'machineId'].includes(key))) throw new Error('Unexpected module selection fields')
    const { repository, version, commit, machineId } = item as Record<string, unknown>
    if (typeof repository !== 'string' || !/^https:\/\/github\.com\/sislex\/[a-zA-Z0-9_-][a-zA-Z0-9._-]*(?![\s\S])/.test(repository) || repository.toLowerCase().endsWith('.git')) throw new Error('Invalid repository')
    if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?![\s\S])/.test(version)) throw new Error('Invalid version')
    if (typeof commit !== 'string' || !/^[a-fA-F0-9]{40}(?![\s\S])/.test(commit)) throw new Error('Invalid commit')
    if (machineId !== undefined && (typeof machineId !== 'string' || machineId.length < 1)) throw new Error('Invalid machine id')
    const identity = repository.toLowerCase()
    if (seen.has(identity)) throw new Error('Duplicate repository')
    seen.add(identity)
    return machineId === undefined ? { repository, version, commit } : { repository, version, commit, machineId }
  })
}

const repositoryKey = (url: string): string => url.trim().toLowerCase().replace(/\.git$/, '').replace(/\/+$/, '')
/** Core itself and repositories whose catalog applications have no service (SDK, UI Kit, Core UI, Desktop) ship inside the Core build. */
function isEmbeddedModule(repository: string): boolean {
  const key = repositoryKey(repository)
  if (key === 'https://github.com/sislex/voiceaichat') return true
  const apps = APPLICATION_CATALOG.filter(app => app.external && repositoryKey(app.external.repository) === key)
  return apps.length > 0 && apps.every(app => app.kind !== 'service')
}

/** Validate environments-v3 placement rules without mutating the configuration. */
export function parseModulePlacement(config: EnvironmentConfiguration, env: EnvironmentDefinition): string | null {
  const placed = config.modules.filter(module => module.machineId !== undefined)
  if (placed.length === 0) return null
  if (env.mode === 'external') return 'Placement requires a managed environment'
  if (placed.some(module => isEmbeddedModule(module.repository))) return 'Embedded modules run with Core'
  if (placed.some(module => !env.machines.includes(module.machineId!))) return 'Placement machine is not in the environment'
  return null
}

export function parseEnvironmentId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{1,39}(?![\s\S])/.test(value)) throw new Error('Invalid environment id')
  return value
}

export function parseCoreSelection(value: unknown): CoreSelection | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid core selection')
  const keys = Object.keys(value)
  if (keys.length !== 2 || keys.some(key => !['version', 'commit'].includes(key))) throw new Error('Unexpected core selection fields')
  const { version, commit } = value as Record<string, unknown>
  const [selection] = parseModuleSelections([{ repository: 'https://github.com/sislex/voiceAIChat', version, commit }])
  return { version: selection.version, commit: selection.commit }
}

export function parseEnvironmentSettingsPatch(value: unknown): EnvironmentSettingPatch[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) throw new Error('Expected 1..50 environment settings')
  const seen = new Set<string>()
  return Array.from(value, item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid environment setting')
    const keys = Object.keys(item)
    if (keys.length !== 2 || keys.some(key => !['key', 'value'].includes(key))) throw new Error('Unexpected environment setting fields')
    const { key, value } = item as Record<string, unknown>
    if (typeof key !== 'string' || !/^[A-Z][A-Z0-9_]{1,63}(?![\s\S])/.test(key)) throw new Error('Invalid environment setting key')
    if (RESERVED_ENVIRONMENT_SETTINGS.includes(key)) throw new Error(`Reserved environment setting: ${key}`)
    if (!ENVIRONMENT_SETTINGS.some(setting => setting.key === key)) throw new Error(`Unknown environment setting: ${key}`)
    if (seen.has(key)) throw new Error(`Duplicate environment setting: ${key}`)
    seen.add(key)
    if (value !== null && (typeof value !== 'string' || value.length < 1 || value.length > 4096 || /['\r\n\0]/.test(value) || (key === 'VC_ADMIN_PASSWORD' && value.length < 12))) throw new Error(`Invalid value for ${key}`)
    return { key, value: value as string | null }
  })
}

export function managedStandPaths(storageRoot: string, projectId: string, environmentId: string, platform: string): ManagedStandPaths {
  if (platform === 'win32') throw new Error('Stands are not supported on Windows')
  parseEnvironmentId(environmentId)
  if (environmentId === 'production') throw new Error('Production is not a managed stand')
  const project = validateStorageRelativePath(projectId)
  if (project.includes('/')) throw new Error('Invalid project id')
  const storage = normalizeMachineStoragePath(storageRoot, platform)
  const root = `${storage}/projects/${project}/environments/stands/${environmentId}`
  return {
    root, app: `${root}/app`, config: `${root}/config`, logs: `${root}/logs`,
    artifacts: `${root}/artifacts`, temporary: `${root}/temporary`,
    repository: `${root}/temporary/repository`, manifest: `${root}/environment.json`,
    envFile: `${root}/config/stand.env`, overrides: `${root}/config/overrides`
  }
}

/** FNV-1a over UTF-8 bytes; stable across browser and server runtimes. */
export function environmentComposeProject(projectId: string, environmentId: string): string {
  let hash = 0x811c9dc5
  for (const byte of new TextEncoder().encode(projectId)) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0
  return `sx-${environmentId}-${hash.toString(16).padStart(8, '0')}`
}

export function environmentDataVolume(composeProject: string): string {
  return `${composeProject}-server-data`
}

/** Selected Core release; identity is the commit of release/<version>. */
export interface CoreSelection { version: string; commit: string }   // x.y.z, 40 hex

export interface CoreDiff {
  desired: CoreSelection | null
  actual: { version: string | null; commit: string | null }     // observation.core
  action: 'none' | 'needs_core_release' | 'needs_provision'     // external | managed
}

export type EnvironmentOperationKind = 'apply' | 'provision' | 'remove'
export const ACTIVE_ENVIRONMENT_OPERATION_STATUSES: readonly EnvironmentOperationStatus[] =
  ['pending', 'preparing', 'pulling', 'building', 'starting', 'switching', 'health_check', 'removing']

/** Stage steps of provision/remove; apply steps stay per compose service. */
export type EnvironmentStage =
  | 'readiness' | 'directories' | 'checkout' | 'settings' | 'modules'
  | 'config' | 'build' | 'pull' | 'links' | 'snapshot' | 'restore'
  | 'start' | 'health' | 'switch' | 'down' | 'cleanup'

export type MachineReadinessCheckId =
  | 'platform' | 'architecture' | 'policy' | 'storage' | 'root' | 'docker' | 'compose' | 'git'
  | 'python' | 'repository' | 'disk' | 'memory' | 'port' | 'project'
export interface MachineReadinessCheck { id: MachineReadinessCheckId; status: 'passed' | 'warning' | 'failed'; message: string }
export interface MachineReadiness {
  environmentId: string
  machineId: string
  checkedAt: number
  ready: boolean                  // no check is 'failed'
  port: number | null             // port the next provision will use
  checks: MachineReadinessCheck[] // every id exactly once, in the order above
}

export const ENVIRONMENT_PORT_RANGE = { from: 17800, to: 17999 } as const
export const ENVIRONMENT_LINK_PORT_RANGE = { min: 17000, max: 17799 } as const
export const ENVIRONMENT_MIN_FREE_BYTES = 20 * 1024 ** 3
export const ENVIRONMENT_MIN_MEMORY_BYTES = 4 * 1024 ** 3          // below: failed
export const ENVIRONMENT_RECOMMENDED_MEMORY_BYTES = 8 * 1024 ** 3  // below: warning
export const ENVIRONMENT_MIN_COMPOSE_VERSION = '2.24.0'

export interface EnvironmentSettingDefinition {
  key: string                     // [A-Z][A-Z0-9_]{1,63}
  label: string                   // Russian UI label
  secret: boolean
  required: boolean               // provision refuses while unset
  generated: boolean              // provision generates 32 random bytes as hex when unset
}

/** What the API returns; a secret value is never returned. */
export interface EnvironmentSettingView {
  key: string; label: string; secret: boolean; required: boolean; generated: boolean
  set: boolean
  value: string | null            // plain value of a non-secret setting; always null for secrets
  source: 'user' | 'generated' | null
  updatedBy: string | null
  updatedAt: number | null
}
export interface EnvironmentSettingPatch { key: string; value: string | null }   // null deletes
/** Storage row; for secrets value is ciphertext 'v1:<iv>:<tag>:<data>' (base64). Never sent to clients. */
export interface StoredEnvironmentSetting {
  key: string; secret: boolean; value: string; source: 'user' | 'generated'; updatedBy: string; updatedAt: number
}

export interface ManagedStandPaths {
  root: string; app: string; config: string; logs: string; artifacts: string
  temporary: string; repository: string; manifest: string
  envFile: string                 // <config>/stand.env
  overrides: string               // <config>/overrides (VC_ENVIRONMENT_OVERRIDES of the stand)
}

export interface ProvisionInput {
  configurationId: string
  data?: EnvironmentData
}
