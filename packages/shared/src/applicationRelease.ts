// Контракт самостоятельного выпуска: версии реализации и API проверяются
// раздельно, а deploy всегда использует неизменяемый артефакт.
export interface ApplicationVersionRequirement {
  applicationId: string
  minVersion: string
  maxVersionExclusive: string
  minApiVersion?: string
  maxApiVersionExclusive?: string
  optional?: boolean
  capabilities?: string[]
}
export interface ApplicationArtifact {
  service: string
  kind: 'oci'
  reference: string
}
export interface ApplicationReleaseManifest {
  schemaVersion: 1
  applicationId: string
  version: string
  apiVersion: string
  commit: string
  artifacts: ApplicationArtifact[]
  requires: ApplicationVersionRequirement[]
  capabilities: string[]
  /** Меняется владельцем данных; откат на другой формат требует явной миграции. */
  dataVersion: string
}
export interface InstalledApplication {
  manifest: ApplicationReleaseManifest
  healthy: boolean
  installedAt: number
}
export interface ApplicationEnvironment {
  schemaVersion: 1
  revision: number
  applications: InstalledApplication[]
}
export interface ApplicationRuntimeMetadata {
  applicationId: string
  version: string | null
  apiVersion: string | null
  commit: string | null
  dataVersion: string | null
}
/** Не выдаём legacy/dev-процесс за проверенный версионированный артефакт. */
export function applicationRuntimeMetadata(
  applicationId: string,
  env: Record<string, string | undefined>
): ApplicationRuntimeMetadata {
  const version = env.VC_APPLICATION_VERSION,
    apiVersion = env.VC_APPLICATION_API_VERSION,
    dataVersion = env.VC_APPLICATION_DATA_VERSION
  const commit = env.VC_APPLICATION_COMMIT ?? env.VC_RELEASE_COMMIT
  return {
    applicationId,
    version: applicationVersion(version) ? version : null,
    apiVersion: applicationVersion(apiVersion) ? apiVersion : null,
    dataVersion: applicationVersion(dataVersion) ? dataVersion : null,
    commit: /^[a-f0-9]{40}$/.test(commit ?? '') ? commit! : null
  }
}
export function applicationRuntimeMatches(
  manifest: ApplicationReleaseManifest,
  actual: unknown
): boolean {
  if (!actual || typeof actual !== 'object') return false
  const metadata = actual as ApplicationRuntimeMetadata
  return (
    metadata.applicationId === manifest.applicationId &&
    metadata.version === manifest.version &&
    metadata.apiVersion === manifest.apiVersion &&
    metadata.commit === manifest.commit &&
    metadata.dataVersion === manifest.dataVersion
  )
}
export interface ApplicationCompatibilityIssue {
  applicationId: string
  dependencyId: string
  code: 'missing' | 'version' | 'api' | 'capability' | 'unhealthy' | 'data'
  message: string
}
export const APPLICATION_ID_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
export function applicationVersion(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 64 &&
    VERSION.test(value) &&
    value.split('.').every((part) => Number.isSafeInteger(Number(part)))
  )
}
export function compareApplicationVersions(
  left: string,
  right: string
): -1 | 0 | 1 {
  if (!applicationVersion(left) || !applicationVersion(right))
    throw new Error('Ожидалась версия x.y.z без ведущих нулей')
  const a = left.split('.').map(Number),
    b = right.split('.').map(Number)
  for (let index = 0; index < 3; index++)
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1
  return 0
}
export function applicationVersionMatches(
  version: string,
  min: string,
  max: string
): boolean {
  return (
    applicationVersion(version) &&
    compareApplicationVersions(version, min) >= 0 &&
    compareApplicationVersions(version, max) < 0
  )
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Ожидался объект манифеста')
  return value as Record<string, unknown>
}
function id(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > 80 ||
    !APPLICATION_ID_RE.test(value)
  )
    throw new Error('Некорректный идентификатор приложения или сервиса')
  return value
}
function version(value: unknown): string {
  if (!applicationVersion(value))
    throw new Error('Некорректная версия приложения')
  return value
}
function strings(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length > 128 ||
    !value.every(
      (item) =>
        typeof item === 'string' &&
        /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(item)
    )
  )
    throw new Error('Некорректный список возможностей')
  if (new Set(value).size !== value.length)
    throw new Error('Повторяющаяся возможность')
  return [...value]
}
function range(min: unknown, max: unknown): [string, string] {
  const lower = version(min),
    upper = version(max)
  if (compareApplicationVersions(lower, upper) >= 0)
    throw new Error('Диапазон совместимости должен быть непустым')
  return [lower, upper]
}
export function parseApplicationReleaseManifest(
  value: unknown
): ApplicationReleaseManifest {
  const source = record(value)
  if (source.schemaVersion !== 1)
    throw new Error('Неподдерживаемая схема выпуска приложения')
  if (
    typeof source.commit !== 'string' ||
    !/^[a-f0-9]{40}$/.test(source.commit)
  )
    throw new Error('Нужен точный Git SHA выпуска')
  if (
    !Array.isArray(source.artifacts) ||
    !source.artifacts.length ||
    source.artifacts.length > 32
  )
    throw new Error('Нужны артефакты выпуска')
  const artifacts = source.artifacts.map((raw) => {
    const item = record(raw)
    if (
      item.kind !== 'oci' ||
      typeof item.reference !== 'string' ||
      item.reference.length > 512 ||
      !/^[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}$/.test(item.reference)
    )
      throw new Error('Образ должен быть закреплён по sha256 digest')
    return {
      service: id(item.service),
      kind: 'oci' as const,
      reference: item.reference
    }
  })
  if (new Set(artifacts.map((item) => item.service)).size !== artifacts.length)
    throw new Error('Сервис указан в выпуске дважды')
  if (!Array.isArray(source.requires) || source.requires.length > 64)
    throw new Error('Некорректные зависимости выпуска')
  const requires = source.requires.map((raw) => {
    const item = record(raw),
      [minVersion, maxVersionExclusive] = range(
        item.minVersion,
        item.maxVersionExclusive
      )
    if (item.optional !== undefined && typeof item.optional !== 'boolean')
      throw new Error('Некорректный признак optional')
    let api:
      | { minApiVersion: string; maxApiVersionExclusive: string }
      | undefined
    if (
      item.minApiVersion !== undefined ||
      item.maxApiVersionExclusive !== undefined
    ) {
      const [minApiVersion, maxApiVersionExclusive] = range(
        item.minApiVersion,
        item.maxApiVersionExclusive
      )
      api = { minApiVersion, maxApiVersionExclusive }
    }
    return {
      applicationId: id(item.applicationId),
      minVersion,
      maxVersionExclusive,
      ...api,
      ...(item.optional === undefined ? {} : { optional: item.optional }),
      ...(item.capabilities === undefined
        ? {}
        : { capabilities: strings(item.capabilities) })
    }
  })
  const applicationId = id(source.applicationId)
  if (
    requires.some((item) => item.applicationId === applicationId) ||
    new Set(requires.map((item) => item.applicationId)).size !== requires.length
  )
    throw new Error('Повтор или ссылка приложения на себя в зависимостях')
  return {
    schemaVersion: 1,
    applicationId,
    version: version(source.version),
    apiVersion: version(source.apiVersion),
    commit: source.commit,
    artifacts,
    requires,
    capabilities: strings(source.capabilities),
    dataVersion: version(source.dataVersion)
  }
}
export function parseApplicationEnvironment(
  value: unknown
): ApplicationEnvironment {
  const source = record(value)
  if (
    source.schemaVersion !== 1 ||
    !Number.isSafeInteger(source.revision) ||
    Number(source.revision) < 0 ||
    !Array.isArray(source.applications) ||
    source.applications.length > 128
  )
    throw new Error('Некорректный состав окружения')
  const applications = source.applications.map((raw) => {
    const item = record(raw)
    if (
      typeof item.healthy !== 'boolean' ||
      typeof item.installedAt !== 'number' ||
      !Number.isFinite(item.installedAt) ||
      item.installedAt < 0
    )
      throw new Error('Некорректное состояние установленного приложения')
    return {
      manifest: parseApplicationReleaseManifest(item.manifest),
      healthy: item.healthy,
      installedAt: item.installedAt
    }
  })
  if (
    new Set(applications.map((item) => item.manifest.applicationId)).size !==
    applications.length
  )
    throw new Error('Повтор приложения в окружении')
  const services = applications.flatMap((item) =>
    item.manifest.artifacts.map((artifact) => artifact.service)
  )
  if (new Set(services).size !== services.length)
    throw new Error('Сервис принадлежит нескольким приложениям')
  return { schemaVersion: 1, revision: Number(source.revision), applications }
}
export function applicationReleaseIdentity(
  value: ApplicationReleaseManifest
): string {
  const manifest = parseApplicationReleaseManifest(value)
  return JSON.stringify({
    ...manifest,
    artifacts: [...manifest.artifacts].sort((a, b) =>
      a.service.localeCompare(b.service)
    ),
    requires: manifest.requires
      .map((requirement) => ({
        ...requirement,
        ...(requirement.capabilities
          ? { capabilities: [...requirement.capabilities].sort() }
          : {})
      }))
      .sort((a, b) => a.applicationId.localeCompare(b.applicationId)),
    capabilities: [...manifest.capabilities].sort()
  })
}
/** Проверяет весь будущий состав, в том числе обратные зависимости и откат данных. */
export function applicationCompatibility(
  environment: ApplicationEnvironment,
  candidates: ApplicationReleaseManifest[]
): ApplicationCompatibilityIssue[] {
  const current = parseApplicationEnvironment(environment)
  const changes = candidates.map(parseApplicationReleaseManifest)
  if (
    new Set(changes.map((item) => item.applicationId)).size !== changes.length
  )
    throw new Error('Повтор приложения в плане deploy')
  const installed = new Map(
    current.applications.map((item) => [item.manifest.applicationId, item])
  )
  const future = new Map(installed)
  const issues: ApplicationCompatibilityIssue[] = []
  for (const manifest of changes) {
    const previous = installed.get(manifest.applicationId)?.manifest
    if (previous && previous.dataVersion !== manifest.dataVersion)
      issues.push({
        applicationId: manifest.applicationId,
        dependencyId: manifest.applicationId,
        code: 'data',
        message: `Формат данных ${previous.dataVersion} → ${manifest.dataVersion} требует отдельной миграции`
      })
    future.set(manifest.applicationId, {
      manifest,
      healthy: true,
      installedAt: 0
    })
  }
  // Не разрешаем двум приложениям заменить один compose-сервис.
  parseApplicationEnvironment({
    ...current,
    applications: [...future.values()]
  })
  for (const { manifest } of future.values())
    for (const requirement of manifest.requires) {
      const dependency = future.get(requirement.applicationId)
      const issue = (
        code: ApplicationCompatibilityIssue['code'],
        message: string
      ) =>
        issues.push({
          applicationId: manifest.applicationId,
          dependencyId: requirement.applicationId,
          code,
          message
        })
      if (!dependency) {
        if (!requirement.optional)
          issue(
            'missing',
            `Не установлено обязательное приложение ${requirement.applicationId}`
          )
        continue
      }
      if (!dependency.healthy)
        issue(
          'unhealthy',
          `${requirement.applicationId} не прошло health-check`
        )
      if (
        !applicationVersionMatches(
          dependency.manifest.version,
          requirement.minVersion,
          requirement.maxVersionExclusive
        )
      )
        issue(
          'version',
          `${requirement.applicationId} ${dependency.manifest.version}: требуется >=${requirement.minVersion} <${requirement.maxVersionExclusive}`
        )
      if (
        requirement.minApiVersion &&
        requirement.maxApiVersionExclusive &&
        !applicationVersionMatches(
          dependency.manifest.apiVersion,
          requirement.minApiVersion,
          requirement.maxApiVersionExclusive
        )
      )
        issue(
          'api',
          `${requirement.applicationId}: несовместимая версия API ${dependency.manifest.apiVersion}`
        )
      for (const capability of requirement.capabilities ?? [])
        if (!dependency.manifest.capabilities.includes(capability))
          issue(
            'capability',
            `${requirement.applicationId}: отсутствует возможность ${capability}`
          )
    }
  return issues
}
export function applicationReleaseBranch(
  applicationId: string,
  releaseVersion: string
): string {
  return `release/${id(applicationId)}/${version(releaseVersion)}`
}
export function parseApplicationReleaseBranch(
  branch: string
): { applicationId: string | null; version: string } | null {
  const parts = branch.split('/')
  if (parts[0] !== 'release') return null
  if (parts.length === 2 && applicationVersion(parts[1]))
    return { applicationId: null, version: parts[1] }
  if (
    parts.length === 3 &&
    APPLICATION_ID_RE.test(parts[1]) &&
    parts[1].length <= 80 &&
    applicationVersion(parts[2])
  )
    return { applicationId: parts[1], version: parts[2] }
  return null
}
