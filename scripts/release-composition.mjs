// Закрепление выбранных выпусков приложений в чекауте Core — шаг «состав релиза» центра релизов.
//
//   node --import tsx scripts/release-composition.mjs current
//   node --import tsx scripts/release-composition.mjs apply --dir <каталог>
//
// `current` печатает, какие выпуски каких репозиториев закреплены сейчас. `apply` берёт каталог,
// где на каждый выпуск лежит подкаталог с `sislexa-release.json` и его архивами (их скачивает центр
// релизов из GitHub-релиза владельца), проверяет байты и переписывает всё, чем Core закрепляет
// владельца: `vendor/*.tgz`, три манифеста архивов, `package.json`/`package-lock.json`,
// `deploy/tools.lock.json` и образы в compose. Результат — чистая замена закреплений: регрессия
// релиза узнаёт её (`scripts/owner-pins.mjs`) и идёт суженным планом.
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, copyFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { RELEASE_MANIFEST_ASSET, parsePublishedApplicationRelease } from '../packages/shared/src/releaseComposition.ts'
import { archiveDigests, rowCommit, rowRepository } from './owner-release-publish.mjs'

const MANIFESTS = ['vendor/owner-artifacts.json', 'vendor/ui-libraries.json', 'dependency-snapshots.json']
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const writeJson = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n')

function composeFiles(core) {
  const deploy = join(core, 'deploy')
  return ['docker-compose.yml', ...(existsSync(deploy) ? readdirSync(deploy).filter((file) => /^compose\.[\w.-]+\.yml$/.test(file)).map((file) => `deploy/${file}`) : [])]
    .filter((file) => existsSync(join(core, file)))
}

function packageJsonFiles(core) {
  const files = ['package.json']
  for (const dir of ['apps', 'packages']) {
    if (!existsSync(join(core, dir))) continue
    for (const name of readdirSync(join(core, dir))) if (existsSync(join(core, dir, name, 'package.json'))) files.push(`${dir}/${name}/package.json`)
  }
  return files
}

/** Закреплённые выпуски по репозиториям: версия и коммит — у инструмента или первого пакета. */
export function currentComposition(core) {
  const toolsLock = readJson(join(core, 'deploy/tools.lock.json'))
  const byRepository = new Map()
  for (const file of MANIFESTS) {
    if (!existsSync(join(core, file))) continue
    for (const row of readJson(join(core, file)).packages) {
      const repository = rowRepository(row)
      if (!repository) continue
      const entry = byRepository.get(repository) ?? { repository, packages: new Map() }
      if (!entry.packages.has(row.name)) entry.packages.set(row.name, { name: row.name, version: row.version, commit: rowCommit(row), asset: row.asset })
      byRepository.set(repository, entry)
    }
  }
  // Сервис без npm-архивов (Kanban) закреплён только инструментом и образом.
  for (const tool of Object.values(toolsLock.tools)) if (tool.repository && !byRepository.has(tool.repository)) byRepository.set(tool.repository, { repository: tool.repository, packages: new Map() })
  return [...byRepository.values()].map(({ repository, packages }) => {
    const tool = Object.values(toolsLock.tools).find((item) => item.repository === repository)
    const first = [...packages.values()][0]
    return { repository, version: tool?.version ?? first?.version, commit: tool?.commit ?? first?.commit, packages: [...packages.values()] }
  }).sort((a, b) => a.repository.localeCompare(b.repository))
}

/** Проверка архива против манифеста и содержимого: имя, версия и коммит внутри пакета. */
export function verifyArchive(bytes, pkg, commit, inspect = inspectArchive) {
  const digests = archiveDigests(bytes)
  if (digests.size !== pkg.size || digests.sha256 !== pkg.sha256 || digests.integrity !== pkg.integrity) throw new Error(`${pkg.asset}: байты не совпадают с манифестом`)
  const inside = inspect(bytes)
  if (inside.name !== pkg.name || inside.version !== pkg.version) throw new Error(`${pkg.asset}: внутри ${inside.name}@${inside.version}, ожидался ${pkg.name}@${pkg.version}`)
  if (inside.commit && inside.commit !== commit) throw new Error(`${pkg.asset}: собран из ${inside.commit}, выпуск — ${commit}`)
}

/** `package/package.json` и `package/release-source.json` из npm-архива. */
export function inspectArchive(bytes) {
  const read = (member) => {
    try { return execFileSync('tar', ['-xzOf', '-', member], { input: bytes, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['pipe', 'pipe', 'ignore'] }) } catch { return null }
  }
  const pkg = JSON.parse(read('package/package.json') ?? '{}')
  const source = read('package/release-source.json')
  return { name: pkg.name, version: pkg.version, commit: source ? JSON.parse(source).commit : undefined }
}

const imagePattern = (name) => new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:[a-f0-9]{40}`, 'g')

/** Всё, что может отказать, проверяется до первой записи: чекаут не остаётся наполовину переписанным. */
export function checkRelease(core, manifest, dir, { inspect = inspectArchive } = {}) {
  const rows = MANIFESTS.filter((file) => existsSync(join(core, file))).flatMap((file) => readJson(join(core, file)).packages.map((row) => ({ file, row })))
  for (const pkg of manifest.packages) {
    verifyArchive(readFileSync(join(dir, pkg.asset)), pkg, manifest.commit, inspect)
    const pinned = rows.filter(({ row }) => row.name === pkg.name)
    // Состав релиза заменяет закреплённое; новый пакет — изменение Core, а не выбор версии.
    if (!pinned.length) throw new Error(`${pkg.name} не закреплён в Core: добавление пакета — отдельный PR`)
    for (const { file, row } of pinned) if (rowRepository(row) !== manifest.repository) throw new Error(`${pkg.name} в ${file} закреплён из ${rowRepository(row)}, а выпуск — из ${manifest.repository}`)
  }
  const toolsLock = readJson(join(core, 'deploy/tools.lock.json'))
  for (const key of manifest.tools) {
    const tool = toolsLock.tools[key]
    if (!tool) throw new Error(`Инструмент ${key} не закреплён в deploy/tools.lock.json`)
    if (tool.repository !== manifest.repository) throw new Error(`Инструмент ${key} собирается из ${tool.repository}, а выпуск — из ${manifest.repository}`)
  }
  const compose = composeFiles(core).map((file) => readFileSync(join(core, file), 'utf8'))
  for (const image of manifest.images) if (!compose.some((text) => imagePattern(image.name).test(text))) throw new Error(`Образ ${image.name} не закреплён в compose Core`)
}

/** Закрепить один проверенный выпуск; файлы архивов лежат в `dir`. Возвращает, что поменялось. */
export function applyRelease(core, manifest, dir) {
  const changes = []
  for (const pkg of manifest.packages) {
    let previous = null
    for (const file of MANIFESTS) {
      const path = join(core, file)
      if (!existsSync(path)) continue
      const value = readJson(path)
      let touched = false
      for (const row of value.packages) {
        if (row.name !== pkg.name) continue
        previous ??= { asset: row.asset, integrity: row.integrity, version: row.version }
        row.version = pkg.version
        if ('filename' in row) row.filename = `${pkg.name.replace(/^@/, '').replace('/', '-')}-${pkg.version}.tgz`
        row.asset = pkg.asset
        row.sha256 = pkg.sha256
        row.integrity = pkg.integrity
        if ('commit' in row) row.commit = manifest.commit
        for (const key of ['provenance', 'source']) if (row[key] && typeof row[key] === 'object') {
          if ('commit' in row[key]) row[key].commit = manifest.commit
          if ('version' in row[key]) row[key].version = pkg.version
        }
        touched = true
      }
      if (touched) writeJson(path, value)
    }
    copyFileSync(join(dir, pkg.asset), join(core, 'vendor', pkg.asset))
    for (const file of packageJsonFiles(core)) {
      const path = join(core, file)
      const text = readFileSync(path, 'utf8')
      if (text.includes(`vendor/${previous.asset}`)) writeFileSync(path, text.split(`vendor/${previous.asset}`).join(`vendor/${pkg.asset}`))
    }
    const lockPath = join(core, 'package-lock.json')
    if (existsSync(lockPath)) {
      const lock = readJson(lockPath)
      for (const [key, entry] of Object.entries(lock.packages ?? {})) {
        if (typeof entry.resolved === 'string' && entry.resolved.endsWith(`vendor/${previous.asset}`)) {
          entry.resolved = entry.resolved.slice(0, -previous.asset.length) + pkg.asset
          entry.integrity = pkg.integrity
          if (key.endsWith(`node_modules/${pkg.name}`)) entry.version = pkg.version
        }
        for (const field of ['dependencies', 'devDependencies', 'optionalDependencies'])
          for (const [name, spec] of Object.entries(entry[field] ?? {}))
            if (typeof spec === 'string' && spec.endsWith(`vendor/${previous.asset}`)) entry[field][name] = spec.slice(0, -previous.asset.length) + pkg.asset
      }
      writeJson(lockPath, lock)
    }
    if (previous.asset !== pkg.asset && !stillReferenced(core, previous.asset)) rmSync(join(core, 'vendor', previous.asset), { force: true })
    changes.push({ package: pkg.name, from: previous.version, to: pkg.version })
  }
  const toolsPath = join(core, 'deploy/tools.lock.json')
  const toolsLock = readJson(toolsPath)
  for (const key of manifest.tools) {
    const tool = toolsLock.tools[key]
    tool.version = manifest.version
    tool.commit = manifest.commit
  }
  if (manifest.tools.length) writeJson(toolsPath, toolsLock)
  for (const image of manifest.images) {
    for (const file of composeFiles(core)) {
      const path = join(core, file)
      const text = readFileSync(path, 'utf8')
      const next = text.replace(imagePattern(image.name), `${image.name}:${manifest.commit}`)
      if (next !== text) writeFileSync(path, next)
    }
  }
  return { repository: manifest.repository, version: manifest.version, commit: manifest.commit, packages: changes, tools: manifest.tools, images: manifest.images.map((image) => image.name) }
}

function stillReferenced(core, asset) {
  return MANIFESTS.some((file) => existsSync(join(core, file)) && readFileSync(join(core, file), 'utf8').includes(`"${asset}"`))
}

/** Все выпуски из каталога: по подкаталогу на выпуск. Один репозиторий — один выпуск. */
export function applyComposition(core, dir, options) {
  const releases = readdirSync(dir).filter((name) => statSync(join(dir, name)).isDirectory() && existsSync(join(dir, name, RELEASE_MANIFEST_ASSET)))
    .map((name) => ({ dir: join(dir, name), manifest: parsePublishedApplicationRelease(readJson(join(dir, name, RELEASE_MANIFEST_ASSET))) }))
  if (!releases.length) throw new Error(`В ${dir} нет ни одного ${RELEASE_MANIFEST_ASSET}`)
  const repositories = new Set()
  for (const { manifest } of releases) {
    if (repositories.has(manifest.repository)) throw new Error(`Два выпуска одного репозитория: ${manifest.repository}`)
    repositories.add(manifest.repository)
  }
  for (const { dir: releaseDir, manifest } of releases) checkRelease(core, manifest, releaseDir, options)
  return releases.map(({ dir: releaseDir, manifest }) => applyRelease(core, manifest, releaseDir))
}

export function main(args = process.argv.slice(2), core = resolve(import.meta.dirname, '..')) {
  const command = args[0]
  if (command === 'current') { console.log(JSON.stringify(currentComposition(core))); return }
  if (command === 'apply') {
    const index = args.indexOf('--dir')
    if (index < 0) throw new Error('Нужен --dir <каталог с выпусками>')
    console.log(JSON.stringify(applyComposition(core, resolve(args[index + 1]))))
    return
  }
  throw new Error('Команды: current | apply --dir <каталог>')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main() } catch (error) { console.error(error.message); process.exitCode = 1 }
}
