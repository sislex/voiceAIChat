// Публикация выпуска приложения как GitHub-релиза `vX.Y.Z`: npm-архивы, образы сервисов в GHCR с
// тегом коммита и манифест `sislexa-release.json`. Центр релизов берёт выпуски только отсюда
// (packages/shared/src/releaseComposition.ts), поэтому публикация проверяет байты, а не верит им.
//
//   node --import tsx scripts/owner-release-publish.mjs --source <чекаут владельца> [--skip-pack] [--skip-images] [--dry-run]
//   node --import tsx scripts/owner-release-publish.mjs --from-core <repository> [--dry-run]
//
// Первый вариант запускается на машине сборки в чистом чекауте владельца на коммите выпуска.
// Второй один раз публикует то, что уже закреплено в Core (`vendor/`): это ровно те байты, что
// стоят на проде. Токен — `GITHUB_TOKEN` с правом создавать релизы в репозитории владельца.
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  RELEASE_MANIFEST_ASSET, parsePublishedApplicationRelease, releasePackageAsset, releaseTag
} from '../packages/shared/src/releaseComposition.ts'

const root = resolve(import.meta.dirname, '..')
const json = (path) => JSON.parse(readFileSync(path, 'utf8'))

/** Образы владельцев: имя в GHCR и цель Dockerfile. Потребитель (compose Core) закрепляет их тегом коммита. */
export const OWNER_IMAGES = Object.freeze({
  'https://github.com/sislex/make': [{ name: 'ghcr.io/sislex/make-api', target: 'api' }],
  'https://github.com/sislex/webreader': [{ name: 'ghcr.io/sislex/webreader-api', target: 'api' }],
  'https://github.com/sislex/playwrightreader': [
    { name: 'ghcr.io/sislex/playwrightreader-api', target: 'api' },
    { name: 'ghcr.io/sislex/playwrightreader-browser', target: 'browser' }
  ],
  'https://github.com/sislex/llm-runner': [{ name: 'ghcr.io/sislex/llm-runner', target: '' }],
  'https://github.com/sislex/image-studio': [{ name: 'ghcr.io/sislex/image-studio-api', target: 'api' }],
  'https://github.com/sislex/voice': [
    { name: 'ghcr.io/sislex/voice-stt', target: 'stt' },
    { name: 'ghcr.io/sislex/voice-tts', target: 'tts' }
  ],
  'https://github.com/sislex/identity': [{ name: 'ghcr.io/sislex/identity', target: '' }],
  'https://github.com/sislex/billing': [{ name: 'ghcr.io/sislex/billing', target: '' }],
  'https://github.com/sislex/analytics': [{ name: 'ghcr.io/sislex/analytics', target: '' }]
})

export function archiveDigests(bytes) {
  return {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64'),
    size: bytes.length
  }
}

/** Пакет манифеста из архива: хэши считаются по байтам, запись владельца только сверяется. */
export function releasePackage(bytes, declared) {
  const digests = archiveDigests(bytes)
  if (declared.sha256 && declared.sha256 !== digests.sha256) throw new Error(`${declared.name}: sha256 не совпадает с архивом`)
  if (declared.integrity && declared.integrity !== digests.integrity) throw new Error(`${declared.name}: integrity не совпадает с архивом`)
  return { name: declared.name, version: declared.version, asset: declared.asset ?? releasePackageAsset(declared.name, declared.version, digests.sha256), ...digests }
}

/** Инструменты Core (`deploy/tools.lock.json`), которые собраны из этого репозитория. */
export function toolsOf(repository, toolsLock) {
  return Object.entries(toolsLock.tools).filter(([, tool]) => tool.repository === repository).map(([key]) => key).sort()
}

/** Образы из compose Core, закреплённые на коммите выпуска (для публикации уже стоящего выпуска). */
export function pinnedImages(repository, commit, composeTexts) {
  const names = new Set()
  for (const image of OWNER_IMAGES[repository] ?? [])
    if (composeTexts.some((text) => text.includes(`${image.name}:${commit}`))) names.add(image.name)
  return [...names].sort().map((name) => ({ name }))
}

const COMPOSE_FILES = () => ['docker-compose.yml', ...(existsSync(join(root, 'deploy')) ? execFileSync('ls', [join(root, 'deploy')], { encoding: 'utf8' }).split('\n').filter((f) => /^compose\.[\w.-]+\.yml$/.test(f)).map((f) => `deploy/${f}`) : [])]

export const rowRepository = (row) => row.repository ?? row.provenance?.repository ?? row.source?.repository
export const rowCommit = (row) => row.commit ?? row.provenance?.commit ?? row.source?.commit

/** Манифест и файлы выпуска из того, что сейчас закреплено в Core. */
export function manifestFromCore(repository, core = root) {
  const all = new Map()
  for (const file of ['vendor/owner-artifacts.json', 'vendor/ui-libraries.json', 'dependency-snapshots.json']) {
    if (!existsSync(join(core, file))) continue
    for (const row of json(join(core, file)).packages) if (rowRepository(row) === repository && !all.has(row.name)) all.set(row.name, row)
  }
  if (!all.size) throw new Error(`В Core не закреплено ни одного пакета из ${repository}`)
  // Пакеты одного репозитория бывают закреплены на разных коммитах (контракты не пересобирались).
  // Выпуск — один коммит: берётся коммит инструмента или первого пакета, остальные пакеты не входят.
  const toolsLock = json(join(core, 'deploy/tools.lock.json'))
  const toolCommits = toolsOf(repository, toolsLock).map((key) => toolsLock.tools[key].commit)
  const commit = toolCommits[0] ?? rowCommit([...all.values()][0])
  const rows = new Map([...all].filter(([, row]) => rowCommit(row) === commit))
  if (!rows.size) throw new Error(`Ни один пакет ${repository} не закреплён на коммите инструмента ${commit}`)
  const tools = toolsOf(repository, toolsLock).filter((key) => toolsLock.tools[key].commit === commit)
  const versions = new Set([...tools.map((key) => toolsLock.tools[key].version), ...[...rows.values()].map((row) => row.provenance?.version).filter(Boolean)])
  const version = versions.size === 1 ? [...versions][0] : [...rows.values()][0].version
  const files = []
  const packages = [...rows.values()].map((row) => {
    const path = join(core, 'vendor', row.asset)
    files.push(path)
    return releasePackage(readFileSync(path), { name: row.name, version: row.version, asset: row.asset, sha256: row.sha256, integrity: row.integrity })
  })
  const images = pinnedImages(repository, commit, COMPOSE_FILES().filter((file) => existsSync(join(core, file))).map((file) => readFileSync(join(core, file), 'utf8')))
  return { manifest: parsePublishedApplicationRelease({ schemaVersion: 1, repository, version, commit, packages, images, tools }), files }
}

/** Манифест и файлы выпуска из чекаута владельца после `npm run pack:release`. */
export function manifestFromSource(source, { repository, commit, version }) {
  const integrity = json(join(source, 'artifacts', 'integrity.json'))
  const files = []
  const packages = integrity.packages.map((row) => {
    if (row.commit !== commit) throw new Error(`${row.name}: архив собран из ${row.commit}, а выпуск — ${commit}`)
    const bytes = readFileSync(join(source, 'artifacts', row.filename))
    const pkg = releasePackage(bytes, { name: row.name, version: row.version, sha256: row.sha256, integrity: row.integrity })
    const staged = join(source, 'artifacts', pkg.asset)
    if (staged !== join(source, 'artifacts', row.filename)) copyFileSync(join(source, 'artifacts', row.filename), staged)
    files.push(staged)
    return pkg
  })
  const toolsLock = json(join(root, 'deploy/tools.lock.json'))
  const images = (OWNER_IMAGES[repository] ?? []).map(({ name }) => ({ name }))
  return { manifest: parsePublishedApplicationRelease({ schemaVersion: 1, repository, version, commit, packages, images, tools: toolsOf(repository, toolsLock) }), files }
}

/** GitHub API: создать релиз (или взять существующий того же коммита) и дозалить недостающие файлы. */
export async function publishGithubRelease({ manifest, files, token, fetchImpl = fetch, log = console.log }) {
  if (!token) throw new Error('Нужен GITHUB_TOKEN с правом создавать релизы')
  const slug = manifest.repository.replace('https://github.com/', '')
  const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'sislexa-owner-release' }
  const api = async (path, init = {}) => {
    const response = await fetchImpl(`https://api.github.com/repos/${slug}${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } })
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`GitHub ${init.method ?? 'GET'} ${path}: ${response.status} ${await response.text()}`)
    return await response.json()
  }
  const tag = releaseTag(manifest.version)
  let release = await api(`/releases/tags/${tag}`)
  if (release) {
    const existing = release.assets.find((asset) => asset.name === RELEASE_MANIFEST_ASSET)
    if (existing) {
      const published = await fetchImpl(existing.url, { headers: { ...headers, Accept: 'application/octet-stream' }, redirect: 'follow' })
      const current = parsePublishedApplicationRelease(await published.json())
      if (current.commit !== manifest.commit) throw new Error(`${tag} уже опубликован из ${current.commit}; новый коммит требует новой версии`)
    }
  } else {
    // Существующий тег GitHub возьмёт как есть и проигнорирует target_commitish: релиз на чужом
    // коммите разошёлся бы с манифестом, поэтому такой тег — отказ, а не молчаливая подмена.
    const ref = await api(`/git/ref/tags/${tag}`)
    if (ref) {
      let object = ref.object
      if (object.type === 'tag') object = (await api(`/git/tags/${object.sha}`)).object
      if (object.sha !== manifest.commit) throw new Error(`Тег ${tag} уже указывает на ${object.sha}, а выпуск собран из ${manifest.commit}`)
    }
    release = await api('/releases', { method: 'POST', body: JSON.stringify({ tag_name: tag, target_commitish: manifest.commit, name: `${basename(slug)} ${manifest.version}`, body: `Коммит ${manifest.commit}. Манифест выпуска: ${RELEASE_MANIFEST_ASSET}.`, draft: false, prerelease: false }) })
    log(`создан релиз ${slug} ${tag}`)
  }
  const present = new Set(release.assets.map((asset) => asset.name))
  const uploads = [...files.map((path) => ({ name: basename(path), data: readFileSync(path), type: 'application/gzip' })),
    { name: RELEASE_MANIFEST_ASSET, data: Buffer.from(JSON.stringify(manifest, null, 2) + '\n'), type: 'application/json' }]
  for (const upload of uploads) {
    if (present.has(upload.name)) continue
    const url = release.upload_url.replace(/\{\?name,label\}$/, `?name=${encodeURIComponent(upload.name)}`)
    const response = await fetchImpl(url, { method: 'POST', headers: { ...headers, 'Content-Type': upload.type }, body: upload.data })
    if (!response.ok) throw new Error(`Загрузка ${upload.name}: ${response.status} ${await response.text()}`)
    log(`загружен ${upload.name}`)
  }
  return { tag, url: release.html_url }
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')}: ${result.status ?? result.signal}`)
}

export async function main(args = process.argv.slice(2), env = process.env) {
  const value = (flag) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined }
  const dryRun = args.includes('--dry-run')
  let prepared
  if (value('--from-core')) {
    prepared = manifestFromCore(value('--from-core'))
  } else if (value('--source')) {
    const source = resolve(value('--source'))
    const git = (...gitArgs) => execFileSync('git', gitArgs, { cwd: source, encoding: 'utf8' }).trim()
    if (git('status', '--porcelain')) throw new Error('Выпуск публикуется только из чистого чекаута')
    const commit = git('rev-parse', 'HEAD')
    const repository = git('remote', 'get-url', 'origin').replace(/\.git$/, '').replace(/^git@github\.com:/, 'https://github.com/')
    const version = json(join(source, 'package.json')).version
    if (!args.includes('--skip-pack')) run('npm', ['run', 'pack:release'], source)
    prepared = manifestFromSource(source, { repository, commit, version })
    if (!args.includes('--skip-images') && !dryRun) for (const image of OWNER_IMAGES[repository] ?? []) {
      const reference = `${image.name}:${commit}`
      run('docker', ['build', '--platform', 'linux/amd64', ...(image.target ? ['--target', image.target] : []), '--build-arg', `APPLICATION_VERSION=${version}`, '--build-arg', `APPLICATION_COMMIT=${commit}`, '-t', reference, '.'], source)
      run('docker', ['push', reference], source)
    }
  } else throw new Error('Нужен --source <чекаут владельца> или --from-core <repository>')
  const out = mkdtempSync(join(tmpdir(), 'sislexa-release-'))
  writeFileSync(join(out, RELEASE_MANIFEST_ASSET), JSON.stringify(prepared.manifest, null, 2) + '\n')
  console.log(JSON.stringify({ manifest: prepared.manifest, files: prepared.files.map((path) => basename(path)), staged: out }, null, 2))
  if (dryRun) return prepared
  mkdirSync(out, { recursive: true })
  const result = await publishGithubRelease({ ...prepared, token: env.GITHUB_TOKEN })
  console.log(`опубликовано: ${result.url}`)
  return prepared
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch((error) => { console.error(error.message); process.exitCode = 1 })
