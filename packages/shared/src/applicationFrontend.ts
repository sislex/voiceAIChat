import {
  APPLICATION_ID_RE,
  applicationVersion,
  applicationVersionMatches
} from './applicationRelease'

/** API оболочки меняется отдельно от версии её интерфейса. */
export const APPLICATION_HOST_API_VERSION = '1.0.0'
export interface ApplicationFrontendAsset {
  path: string
  integrity: string
}
export interface ApplicationFrontendManifest {
  schemaVersion: 1
  applicationId: string
  version: string
  apiVersion: string
  commit: string | null
  /** Только локальная сборка вне Git; OCI-релиз всегда содержит настоящий SHA. */
  development?: boolean
  host: { minVersion: string; maxVersionExclusive: string }
  entry: ApplicationFrontendAsset
  styles: ApplicationFrontendAsset[]
}
export function parseApplicationFrontendManifest(
  value: unknown,
  id: string,
  hostVersion = APPLICATION_HOST_API_VERSION
): ApplicationFrontendManifest {
  if (!value || typeof value !== 'object')
    throw new Error('Не удалось прочитать манифест приложения')
  const m = value as ApplicationFrontendManifest
  const asset = (a: ApplicationFrontendAsset): boolean =>
    Boolean(
      a &&
        typeof a.path === 'string' &&
        /^[a-zA-Z0-9_-][a-zA-Z0-9_./-]*$/.test(a.path) &&
        !a.path
          .split('/')
          .some((part) => part === '.' || part === '..' || !part) &&
        /^sha384-[A-Za-z0-9+/]{64}$/.test(a.integrity)
    )
  if (
    m.schemaVersion !== 1 ||
    !APPLICATION_ID_RE.test(m.applicationId) ||
    m.applicationId !== id ||
    !applicationVersion(m.version) ||
    !applicationVersion(m.apiVersion) ||
    !(
      (typeof m.commit === 'string' && /^[a-f0-9]{40}$/.test(m.commit)) ||
      (m.commit === null && m.development === true)
    ) ||
    !m.host ||
    !applicationVersion(m.host.minVersion) ||
    !applicationVersion(m.host.maxVersionExclusive) ||
    !asset(m.entry) ||
    !m.entry.path.endsWith('.js') ||
    !Array.isArray(m.styles) ||
    m.styles.length > 20 ||
    m.styles.some((item) => !asset(item) || !item.path.endsWith('.css')) ||
    new Set([m.entry.path, ...m.styles.map((item) => item.path)]).size !==
      m.styles.length + 1
  )
    throw new Error('Неверный манифест приложения')
  if (
    !applicationVersionMatches(
      hostVersion,
      m.host.minVersion,
      m.host.maxVersionExclusive
    )
  )
    throw new Error(
      `Для приложения нужна версия API оболочки ${m.host.minVersion}…<${m.host.maxVersionExclusive}; установлена ${hostVersion}`
    )
  return m
}
