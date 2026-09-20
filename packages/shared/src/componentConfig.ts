import { APPLICATION_ID_RE, applicationVersion, compareApplicationVersions } from './applicationRelease'

/** Release-owned requirements cannot be weakened by installation settings. */
export interface ComponentDependency {
  applicationId: string
  minVersion: string
  maxVersionExclusive: string
  minApiVersion: string
  maxApiVersionExclusive: string
  scopes: string[]
  optional: boolean
}
export interface ComponentContract {
  schemaVersion: 1
  applicationId: string
  provides: string[]
  legacyScopes: string[]
  dependencies: ComponentDependency[]
}
export interface ComponentGrant { consumerId: string; scopes: string[]; maxTtlSeconds: number }
export interface ComponentConfig {
  schemaVersion: 1
  environmentId: string
  registryDirectory?: string
  grants: ComponentGrant[]
  legacyScopes: string[]
  dependencies: { applicationId: string; url: string; tokenFile: string }[]
}
export interface ComponentPrincipal {
  tokenId: string
  consumerId: string
  providerId: string
  environmentId: string
  scopes: string[]
  expiresAt: number
}
export const COMPONENT_METADATA_PATH = '/v1/component'
export const COMPONENT_AUTHORIZE_PATH = '/v1/component/authorize'
export const COMPONENT_READY_PATH = '/v1/ready'

function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Expected a configuration object')
  const result = value as Record<string, unknown>
  if (Object.keys(result).some(key => !keys.includes(key))) throw Error('Unknown configuration field')
  return result
}
function id(value: unknown): string {
  if (typeof value !== 'string' || value.length > 80 || !APPLICATION_ID_RE.test(value)) throw Error('Invalid component identifier')
  return value
}
function list(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > 128) throw Error('Expected a bounded configuration list')
  return value
}
function unique<T>(items: T[], key: (item: T) => string): T[] {
  if (new Set(items.map(key)).size !== items.length) throw Error('Duplicate configuration entry')
  return items
}
function scopes(value: unknown): string[] {
  return unique(list(value).map(item => {
    if (typeof item !== 'string' || !/^[a-z][a-z0-9-]*\.[a-z][a-z0-9.-]{0,79}$/.test(item)) throw Error('Invalid exact scope')
    return item
  }), item => item)
}
function path(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.length > 4096 || /[\x00-\x1f]/.test(value)) throw Error('Expected an absolute private file path')
  return value
}
function range(min: unknown, max: unknown): [string, string] {
  if (!applicationVersion(min) || !applicationVersion(max) || compareApplicationVersions(min, max) >= 0) throw Error('Invalid dependency version range')
  return [min, max]
}
function subset(values: string[], allowed: string[]): string[] {
  if (values.some(value => !allowed.includes(value))) throw Error('Scope exceeds release permissions')
  return values
}
export function parseComponentContract(value: unknown): ComponentContract {
  const raw = object(value, ['schemaVersion', 'applicationId', 'provides', 'legacyScopes', 'dependencies'])
  if (raw.schemaVersion !== 1) throw Error('Unsupported component contract schema')
  const applicationId = id(raw.applicationId), provides = scopes(raw.provides)
  const dependencies = unique(list(raw.dependencies).map(value => {
    const d = object(value, ['applicationId', 'minVersion', 'maxVersionExclusive', 'minApiVersion', 'maxApiVersionExclusive', 'scopes', 'optional'])
    const [minVersion, maxVersionExclusive] = range(d.minVersion, d.maxVersionExclusive)
    const [minApiVersion, maxApiVersionExclusive] = range(d.minApiVersion, d.maxApiVersionExclusive)
    if (d.optional !== undefined && typeof d.optional !== 'boolean') throw Error('Invalid dependency optional flag')
    if (d.applicationId === applicationId) throw Error('A component cannot depend on itself')
    return { applicationId: id(d.applicationId), minVersion, maxVersionExclusive, minApiVersion, maxApiVersionExclusive, scopes: scopes(d.scopes), optional: d.optional === true }
  }), d => d.applicationId)
  return { schemaVersion: 1, applicationId, provides, legacyScopes: subset(scopes(raw.legacyScopes), provides), dependencies }
}
export function parseComponentConfig(value: unknown, contract: ComponentContract): ComponentConfig {
  const raw = object(value, ['schemaVersion', 'environmentId', 'registryDirectory', 'grants', 'legacyScopes', 'dependencies'])
  if (raw.schemaVersion !== 1) throw Error('Unsupported component configuration schema')
  const grants = unique(list(raw.grants).map(value => {
    const g = object(value, ['consumerId', 'scopes', 'maxTtlSeconds'])
    if (!Number.isSafeInteger(g.maxTtlSeconds) || (g.maxTtlSeconds as number) < 60 || (g.maxTtlSeconds as number) > 366 * 86400) throw Error('Invalid token lifetime limit')
    const allowed = subset(scopes(g.scopes), contract.provides)
    if (!allowed.length || g.consumerId === contract.applicationId) throw Error('Invalid consumer grant')
    return { consumerId: id(g.consumerId), scopes: allowed, maxTtlSeconds: g.maxTtlSeconds as number }
  }), g => g.consumerId)
  const dependencies = unique(list(raw.dependencies).map(value => {
    const d = object(value, ['applicationId', 'url', 'tokenFile'])
    const applicationId = id(d.applicationId)
    if (!contract.dependencies.some(item => item.applicationId === applicationId)) throw Error('Undeclared dependency')
    if (typeof d.url !== 'string' || d.url.length > 2048) throw Error('Invalid dependency URL')
    const url = new URL(d.url)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw Error('Expected a dependency origin without credentials')
    return { applicationId, url: url.origin, tokenFile: path(d.tokenFile) }
  }), d => d.applicationId)
  if (contract.dependencies.some(d => !d.optional && !dependencies.some(item => item.applicationId === d.applicationId))) throw Error('Missing required dependency')
  const registryDirectory = raw.registryDirectory === undefined ? undefined : path(raw.registryDirectory)
  if (contract.provides.length && !registryDirectory) throw Error('Provider requires a private token registry')
  return { schemaVersion: 1, environmentId: id(raw.environmentId), registryDirectory, grants, legacyScopes: subset(scopes(raw.legacyScopes), contract.legacyScopes), dependencies }
}
