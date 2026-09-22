import { applicationVersion, applicationVersionMatches } from './applicationRelease'
import { APPLICATION_HOST_API_VERSION } from './applicationFrontend'

// These versions describe browser contracts, independently of Core product releases.
export const CORE_BROWSER_API_VERSION = '1.1.0'
export const BROWSER_UI_RUNTIME_PATH = '/ui/runtime.json'
export const BROWSER_UI_RELEASE_PREFIX = '/ui/releases/'
export const BROWSER_UI_REPOSITORY = 'https://github.com/sislex/sislexa-core-ui'
export interface BrowserUiVersionRange { min: string; maxExclusive: string }
export interface BrowserUiCompatibility { coreApi: string; applicationHost: string }
export const BROWSER_UI_COMPATIBILITY: BrowserUiCompatibility = {
  coreApi: CORE_BROWSER_API_VERSION, applicationHost: APPLICATION_HOST_API_VERSION
}
export interface BrowserUiRelease {
  schemaVersion: 1
  repository: typeof BROWSER_UI_REPOSITORY
  version: string
  commit: string
  dirty: false
  id: string
  requires: { coreApi: BrowserUiVersionRange; applicationHost: BrowserUiVersionRange }
  files: Record<string, string>
}
export interface BrowserUiActivation {
  schemaVersion: 1
  generation: string
  active: string | null
  previous: string | null
  activatedAt: string
  actor: string
}
export interface BrowserUiRuntime extends BrowserUiCompatibility {
  schemaVersion: 1
  active: string | null
  generation: string | null
  /** Allows a deployment to recover from an incompatible persisted selection. */
  configuredGeneration: string | null
}
export function browserUiReleaseId(value: unknown): value is string {
  return typeof value === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-[a-f0-9]{40}$/.test(value) && value.length <= 106
}
export function browserUiAssetPath(value: string): boolean {
  return /^[a-zA-Z0-9_-][a-zA-Z0-9_./-]*$/.test(value) && !value.split('/').some(segment => !segment || segment === '.' || segment === '..')
}
export function parseBrowserUiRelease(value: unknown, compatibility = BROWSER_UI_COMPATIBILITY): BrowserUiRelease {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid browser UI manifest')
  const release = value as BrowserUiRelease
  if (release.schemaVersion !== 1 || release.repository !== BROWSER_UI_REPOSITORY || release.dirty !== false ||
      !applicationVersion(release.version) || !/^[a-f0-9]{40}$/.test(release.commit) ||
      !browserUiReleaseId(release.id) || release.id !== `${release.version}-${release.commit}`) throw Error('Invalid browser UI provenance')
  for (const key of ['coreApi', 'applicationHost'] as const) {
    const range = release.requires?.[key]
    if (!range || !applicationVersion(range.min) || !applicationVersion(range.maxExclusive) ||
        !applicationVersionMatches(compatibility[key], range.min, range.maxExclusive)) throw Error(`Incompatible browser UI ${key}`)
  }
  if (!release.files || typeof release.files !== 'object' || Array.isArray(release.files) ||
      !Object.hasOwn(release.files, 'index.html') || Object.keys(release.files).length > 10000) throw Error('Missing browser UI assets')
  for (const [path, digest] of Object.entries(release.files)) {
    if (!browserUiAssetPath(path) || path === 'manifest.json' || typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) throw Error('Invalid browser UI asset')
  }
  return release
}
