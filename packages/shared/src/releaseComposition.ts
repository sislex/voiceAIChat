// Состав релиза Core из опубликованных выпусков приложений. Выпуск приложения — GitHub-релиз
// `vX.Y.Z` его репозитория: npm-архивы, которые Core закрепляет в `vendor/`, образы сервисов в
// GHCR и манифест `sislexa-release.json`. Идентичность выпуска — коммит, а не номер версии:
// один номер уже публиковался дважды с разными байтами, и Core обязан видеть разницу.

/** Имя манифеста среди файлов GitHub-релиза. */
export const RELEASE_MANIFEST_ASSET = 'sislexa-release.json'
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const COMMIT = /^[a-f0-9]{40}$/
const SHA256 = /^[a-f0-9]{64}$/
const INTEGRITY = /^sha512-[A-Za-z0-9+/]{86}==$/
const PACKAGE = /^@[a-z0-9-]+\/[a-z0-9._-]+$/
const REPOSITORY = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const IMAGE = /^ghcr\.io\/[a-z0-9_.-]+\/[a-z0-9_.-]+$/
const TOOL = /^[a-z0-9][a-z0-9-]*$/
const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024

export interface ReleasePackage {
  name: string
  version: string
  /** Имя файла в GitHub-релизе и в `vendor/` Core: `<пакет>-<версия>-<sha256[:12]>.tgz` у новых выпусков. */
  asset: string
  sha256: string
  /** npm SRI (`sha512-…`) — то, что пишет `package-lock.json`. */
  integrity: string
  size: number
}

export interface ReleaseImage {
  /** Репозиторий образа без тега; тег — коммит выпуска. */
  name: string
}

export interface PublishedApplicationRelease {
  schemaVersion: 1
  repository: string
  version: string
  commit: string
  packages: ReleasePackage[]
  images: ReleaseImage[]
  /** Ключи `deploy/tools.lock.json`, которые берут версию и коммит этого выпуска. */
  tools: string[]
}

/** Выбор в центре релизов: какой выпуск какого репозитория закрепить. */
export interface ReleaseCompositionItem {
  repository: string
  version: string
  commit: string
}

/** Имя архива нового выпуска в GitHub-релизе и в `vendor/` Core. */
export function releasePackageAsset(name: string, version: string, sha256: string): string {
  return `${name.replace(/^@/, '').replace('/', '-')}-${version}-${sha256.slice(0, 12)}.tgz`
}

export function releaseImageReference(image: ReleaseImage, commit: string): string {
  return `${image.name}:${commit}`
}

function fail(message: string): never { throw new Error(`sislexa-release.json: ${message}`) }
function record(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${what} должен быть объектом`)
  return value as Record<string, unknown>
}
function text(value: unknown, pattern: RegExp, what: string): string {
  if (typeof value !== 'string' || !pattern.test(value)) fail(`неверное поле ${what}`)
  return value
}

/** Строгий разбор манифеста: лишнее или неизвестное в релизе не должно тихо попасть в Core. */
export function parsePublishedApplicationRelease(value: unknown): PublishedApplicationRelease {
  const source = record(value, 'манифест')
  if (source.schemaVersion !== 1) fail('поддерживается только schemaVersion 1')
  const repository = text(source.repository, REPOSITORY, 'repository')
  const version = text(source.version, VERSION, 'version')
  const commit = text(source.commit, COMMIT, 'commit')
  if (!Array.isArray(source.packages) || !source.packages.length) fail('нужен хотя бы один пакет')
  const names = new Set<string>()
  const packages = source.packages.map((item, index): ReleasePackage => {
    const row = record(item, `packages[${index}]`)
    const name = text(row.name, PACKAGE, `packages[${index}].name`)
    if (names.has(name)) fail(`пакет ${name} указан дважды`)
    names.add(name)
    const sha256 = text(row.sha256, SHA256, `packages[${index}].sha256`)
    const pkg: ReleasePackage = {
      name,
      version: text(row.version, VERSION, `packages[${index}].version`),
      asset: text(row.asset, /^[a-z0-9._-]+\.tgz$/, `packages[${index}].asset`),
      sha256,
      integrity: text(row.integrity, INTEGRITY, `packages[${index}].integrity`),
      size: typeof row.size === 'number' && Number.isInteger(row.size) && row.size > 0 && row.size <= MAX_ARCHIVE_BYTES ? row.size : fail(`неверный размер пакета ${name}`)
    }
    // Старые закрепления называли архив по коммиту, новые — по хэшу; обязателен пакет и версия.
    if (!pkg.asset.startsWith(`${name.replace(/^@/, '').replace('/', '-')}-${pkg.version}-`)) fail(`имя архива ${pkg.asset} не совпадает с пакетом и версией`)
    return pkg
  })
  if (!Array.isArray(source.images)) fail('images должен быть списком')
  const images = source.images.map((item, index): ReleaseImage => ({ name: text(record(item, `images[${index}]`).name, IMAGE, `images[${index}].name`) }))
  if (!Array.isArray(source.tools)) fail('tools должен быть списком')
  const tools = source.tools.map((item, index) => text(item, TOOL, `tools[${index}]`))
  return { schemaVersion: 1, repository, version, commit, packages, images, tools }
}

/** Тег GitHub-релиза выпуска. */
export function releaseTag(version: string): string {
  if (!VERSION.test(version)) throw new Error(`Неверная версия выпуска: ${version}`)
  return `v${version}`
}
