
export interface EnvironmentDefinition {
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
}


export interface EnvironmentConfiguration {
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
  | 'pending' | 'pulling' | 'switching' | 'health_check' | 'succeeded' | 'failed' | 'rolled_back'

export interface EnvironmentOperationStep {
  service: string
  from: string | null
  to: string
  status: 'pending' | 'running' | 'passed' | 'failed'
  log: string
}

export interface EnvironmentOperation {
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
    if (keys.length !== 3 || keys.some(key => !['repository', 'version', 'commit'].includes(key))) throw new Error('Unexpected module selection fields')
    const { repository, version, commit } = item as Record<string, unknown>
    if (typeof repository !== 'string' || !/^https:\/\/github\.com\/sislex\/[a-zA-Z0-9_-][a-zA-Z0-9._-]*(?![\s\S])/.test(repository) || repository.toLowerCase().endsWith('.git')) throw new Error('Invalid repository')
    if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?![\s\S])/.test(version)) throw new Error('Invalid version')
    if (typeof commit !== 'string' || !/^[a-fA-F0-9]{40}(?![\s\S])/.test(commit)) throw new Error('Invalid commit')
    const identity = repository.toLowerCase()
    if (seen.has(identity)) throw new Error('Duplicate repository')
    seen.add(identity)
    return { repository, version, commit }
  })
}

export function parseEnvironmentId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{1,39}(?![\s\S])/.test(value)) throw new Error('Invalid environment id')
  return value
}
