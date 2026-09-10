// Собирает контекст приложения из его npm-замыкания: остальные исходники и
// frontend-сборка не попадают даже во вход Docker.
import { execFileSync, spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  APPLICATION_CATALOG,
  validateCatalogRelease,
  validateCatalogArtifact
} from '../packages/shared/src/applicationCatalog.ts'
import {
  applicationVersion,
  parseApplicationReleaseManifest
} from '../packages/shared/src/applicationRelease.ts'
const root = resolve(import.meta.dirname, '..')
const json = (path) => JSON.parse(readFileSync(path, 'utf8'))
export function applicationBuildPaths(applicationId, repo = root) {
  const app = APPLICATION_CATALOG.find((item) => item.id === applicationId)
  if (!app?.entrypoint || !app.isolation.build)
    throw new Error(`Нет самостоятельной сборки ${applicationId}`)
  const lock = json(join(repo, 'package-lock.json')),
    byName = new Map()
  for (const path of Object.keys(lock.packages))
    if (
      /^(apps|packages)\//.test(path) &&
      !path.includes('/node_modules/') &&
      existsSync(join(repo, path, 'package.json'))
    )
      byName.set(json(join(repo, path, 'package.json')).name, path)
  const paths = new Set(),
    queue = [...app.workspaces]
  while (queue.length) {
    const name = queue.shift(),
      path = byName.get(name)
    if (!path) throw new Error(`Не найден workspace ${name}`)
    if (paths.has(path)) continue
    paths.add(path)
    const pkg = json(join(repo, path, 'package.json'))
    for (const dependency of Object.keys({
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.optionalDependencies,
      ...pkg.peerDependencies
    }))
      if (byName.has(dependency)) queue.push(dependency)
  }
  return [...paths].sort()
}
export function createApplicationBuildContext(
  applicationId,
  output,
  {
    repo = root,
    version = '1.0.0',
    commit,
    requires = [],
    apiVersion,
    dataVersion,
    capabilities,
    development = false
  } = {}
) {
  if (!applicationVersion(version)) throw new Error('Неверная версия сборки')
  if (!/^[a-f0-9]{40}$/.test(commit ?? ''))
    throw new Error('Нужен полный SHA сборки')
  const app = APPLICATION_CATALOG.find((item) => item.id === applicationId),
    paths = applicationBuildPaths(applicationId, repo)
  const sourceReleasePath = join(repo, app.paths[0], 'release.json')
  const sourceRelease = existsSync(sourceReleasePath)
    ? json(sourceReleasePath)
    : {
        schemaVersion: 1,
        apiVersion: '1.0.0',
        dataVersion: '1.0.0',
        capabilities: []
      }
  if (sourceRelease.schemaVersion !== 1)
    throw new Error('Неизвестная схема настроек выпуска')
  apiVersion ??= sourceRelease.apiVersion
  dataVersion ??= sourceRelease.dataVersion
  capabilities ??= sourceRelease.capabilities
  mkdirSync(output, { recursive: true })
  for (const path of paths)
    cpSync(join(repo, path), join(output, path), {
      recursive: true,
      filter: (source) =>
        !/(?:^|\/)(node_modules|dist|storybook-static|coverage|artifacts|test-results|playwright-report|\.git)(?:\/|$)/.test(
          source
        ) &&
        !source.endsWith('.tsbuildinfo') &&
        !/(?:^|\/)\.env(?:$|\.(?!example$|sample$))/.test(source)
    })
  if (app.frontend) {
    mkdirSync(join(output, 'scripts'), { recursive: true })
    for (const script of [
      'application-frontend.mjs',
      'application-frontend-server.mjs'
    ])
      cpSync(join(repo, 'scripts', script), join(output, 'scripts', script))
  }
  const original = json(join(repo, 'package.json'))
  const pkg = {
    name: original.name,
    version: original.version,
    private: true,
    type: 'module',
    workspaces: paths
  }
  writeFileSync(
    join(output, 'package.json'),
    JSON.stringify(pkg, null, 2) + '\n'
  )
  const lock = json(join(repo, 'package-lock.json'))
  lock.packages[''] = {
    name: pkg.name,
    version: pkg.version,
    workspaces: paths
  }
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (
      /^(apps|packages)\//.test(path) &&
      !paths.some((owner) => path === owner || path.startsWith(owner + '/'))
    )
      delete lock.packages[path]
    if (entry.link && !paths.includes(entry.resolved))
      delete lock.packages[path]
  }
  // npm ci восстанавливает и лишние записи lock; удаляем всё вне замыкания,
  // включая зависимости других workspace, даже если их исходники не скопированы.
  const reachable = new Set(['']),
    queue = [
      ...paths,
      ...Object.entries(lock.packages)
        .filter(([, entry]) => entry.link && paths.includes(entry.resolved))
        .map(([path]) => path)
    ]
  while (queue.length) {
    const key = queue.shift()
    if (reachable.has(key)) continue
    reachable.add(key)
    const entry = lock.packages[key]
    if (entry?.link) {
      queue.push(entry.resolved)
      continue
    }
    for (const name of Object.keys({
      ...entry?.dependencies,
      ...entry?.devDependencies,
      ...entry?.optionalDependencies,
      ...entry?.peerDependencies
    })) {
      let directory = key
      while (true) {
        const candidate =
          (directory ? directory + '/' : '') + 'node_modules/' + name
        if (lock.packages[candidate]) {
          queue.push(candidate)
          break
        }
        if (!directory) break
        directory = directory.includes('/')
          ? directory.slice(0, directory.lastIndexOf('/'))
          : ''
      }
    }
  }
  for (const path of Object.keys(lock.packages))
    if (!reachable.has(path)) delete lock.packages[path]
  writeFileSync(
    join(output, 'package-lock.json'),
    JSON.stringify(lock, null, 2) + '\n'
  )
  const release = {
    schemaVersion: 1,
    applicationId,
    version,
    apiVersion,
    commit,
    dataVersion,
    requires,
    capabilities,
    development
  }
  parseApplicationReleaseManifest({
    ...release,
    artifacts: app.services.map((service) => ({
      service,
      kind: 'oci',
      reference: 'validation@sha256:' + '0'.repeat(64)
    }))
  })
  writeFileSync(
    join(output, 'application-build.json'),
    JSON.stringify(release, null, 2) + '\n'
  )
  const configPath = join(repo, app.paths[0], 'container.json')
  const container = existsSync(configPath)
    ? json(configPath)
    : { schemaVersion: 1 }
  if (container.schemaVersion !== 1)
    throw new Error('Неизвестная схема настройки образа')
  const base = container.base ?? 'node:22-bookworm-slim',
    user = container.user ?? 'node',
    packages = container.apt ?? ['ca-certificates']
  if (
    !/^[a-z][a-z0-9_-]*$/.test(user) ||
    !Array.isArray(packages) ||
    packages.some(
      (name) => typeof name !== 'string' || !/^[a-z0-9][a-z0-9+.-]*$/.test(name)
    )
  )
    throw new Error('Некорректная конфигурация образа')
  const stages = container.stages ?? [],
    runtime = container.runtime ?? []
  if (
    !Array.isArray(stages) ||
    !Array.isArray(runtime) ||
    [...stages, ...runtime].some((line) => typeof line !== 'string')
  )
    throw new Error('Некорректные стадии образа')
  const dockerfile =
    [
      ...stages,
      `FROM ${base}`,
      'WORKDIR /app',
      'COPY . .',
      `RUN apt-get update && apt-get install -y --no-install-recommends ${packages.join(' ')} && rm -rf /var/lib/apt/lists/*`,
      'RUN npm ci --include=dev --no-audit --no-fund',
      ...(app.frontend
        ? [
            `RUN VC_APPLICATION_VERSION=${version} VC_RELEASE_COMMIT=${commit} node --import tsx scripts/application-frontend.mjs ${applicationId}`
          ]
        : []),
      ...runtime,
      `ENV NODE_ENV=production HOST=0.0.0.0 VC_DATA_DIR=/data VC_APPLICATION_ID=${applicationId} VC_APPLICATION_COMMIT=${commit} VC_APPLICATION_VERSION=${version} VC_APPLICATION_API_VERSION=${apiVersion} VC_APPLICATION_DATA_VERSION=${dataVersion} VC_RELEASE_VERSION=${version} VC_RELEASE_COMMIT=${commit}`,
      `LABEL org.opencontainers.image.version="${version}" org.opencontainers.image.revision="${commit}" com.voicechat.application="${applicationId}" com.voicechat.release=${JSON.stringify(JSON.stringify(release))}`,
      `RUN mkdir -p /data && chown -R ${user}:${user} /data /app`,
      `USER ${user}`,
      `CMD ["node", "--import", "tsx", "${app.entrypoint}"]`
    ].join('\n') + '\n'
  writeFileSync(join(output, 'Dockerfile'), dockerfile)
  return { app, paths, release }
}
/** Первичный baseline сохраняет прежние web/embedded-возможности ядра. */
export function coreBaselineBuildArgs(release) {
  if (release.applicationId !== 'core')
    throw new Error('Baseline принадлежит ядру')
  const values = {
    VC_APPLICATION_METADATA: JSON.stringify(release),
    VC_APPLICATION_VERSION: release.version,
    VC_APPLICATION_API_VERSION: release.apiVersion,
    VC_APPLICATION_DATA_VERSION: release.dataVersion,
    VC_APPLICATION_COMMIT: release.commit
  }
  return Object.entries(values).flatMap(([key, value]) => [
    '--build-arg',
    `${key}=${value}`
  ])
}
function run(args, options = {}) {
  const r = spawnSync('docker', args, { stdio: 'inherit', ...options })
  if (r.error) throw r.error
  if (r.status !== 0)
    throw new Error(`docker ${args[0]}: ${r.status ?? r.signal}`)
}
export function main(args = process.argv.slice(2)) {
  const id = args[0],
    value = (flag) => {
      const i = args.indexOf(flag)
      return i >= 0 ? args[i + 1] : undefined
    },
    version = value('--version'),
    image = value('--image')
  if (
    !id ||
    !version ||
    !image ||
    !applicationVersion(version) ||
    !/^([a-z0-9][a-z0-9._:/-]*)$/.test(image)
  )
    throw new Error(
      'Использование: build:app -- make --version 1.0.0 --image registry/repository [--push] [--allow-dirty]'
    )
  if (args.includes('--allow-dirty') && args.includes('--push'))
    throw new Error('Публикация непроверенной рабочей копии запрещена')
  const baseline = args.includes('--baseline')
  if (baseline && id !== 'core')
    throw new Error(
      '--baseline допускается только для исходного общего образа ядра'
    )
  const requirements = value('--requires')
    ? json(resolve(value('--requires')))
    : []
  const app = APPLICATION_CATALOG.find((app) => app.id === id)
  if (!app) throw new Error('Неизвестное приложение')
  const metadataPath = join(root, app.paths[0], 'release.json'),
    metadata = existsSync(metadataPath)
      ? json(metadataPath)
      : { apiVersion: '1.0.0', dataVersion: '1.0.0', capabilities: [] }
  if (!args.includes('--allow-dirty'))
    (baseline ? validateCatalogArtifact : validateCatalogRelease)(
      parseApplicationReleaseManifest({
        schemaVersion: 1,
        applicationId: id,
        version,
        apiVersion: metadata.apiVersion,
        commit: '0'.repeat(40),
        dataVersion: metadata.dataVersion,
        requires: requirements,
        capabilities: metadata.capabilities,
        artifacts: app.services.map((service) => ({
          service,
          kind: 'oci',
          reference: 'validation@sha256:' + '0'.repeat(64)
        }))
      })
    )
  if (
    !args.includes('--allow-dirty') &&
    execFileSync('git', ['status', '--porcelain'], {
      cwd: root,
      encoding: 'utf8'
    }).trim()
  )
    throw new Error('Релиз собирается только из чистого checkout точного SHA')
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8'
    }).trim(),
    context = mkdtempSync(join(tmpdir(), 'voicechat-app-build-'))
  try {
    const { paths, app, release } = createApplicationBuildContext(id, context, {
      version,
      commit,
      requires: requirements,
      development: args.includes('--allow-dirty')
    })
    console.log(
      JSON.stringify({ applicationId: id, paths, version, commit }, null, 2)
    )
    run(
      baseline
        ? [
            'build',
            '--target',
            'server-runtime',
            ...coreBaselineBuildArgs(release),
            '-t',
            `${image}:${version}`,
            root
          ]
        : [
            'build',
            '--label',
            `com.voicechat.application=${id}`,
            '-t',
            `${image}:${version}`,
            context
          ]
    )
    if (args.includes('--allow-dirty')) {
      console.log(
        'Локальная проверка образа завершена; релиз из рабочей копии не создаётся.'
      )
      return
    }
    if (args.includes('--push')) run(['push', `${image}:${version}`])
    const digests =
      JSON.parse(
        execFileSync(
          'docker',
          [
            'image',
            'inspect',
            `${image}:${version}`,
            '--format',
            '{{json .RepoDigests}}'
          ],
          { encoding: 'utf8' }
        )
      ) ?? []
    const reference = digests.find((ref) => ref.startsWith(image + '@sha256:'))
    if (!reference) {
      if (!args.includes('--allow-dirty'))
        throw new Error(
          'Образ не имеет registry digest: используйте --push для подготовки выпуска'
        )
      console.log(
        'Локальная проверка образа завершена; публикуемого манифеста без digest нет.'
      )
      return
    }
    const manifest = parseApplicationReleaseManifest({
      schemaVersion: 1,
      applicationId: id,
      version,
      apiVersion: release.apiVersion,
      commit,
      artifacts: app.services.map((service) => ({
        kind: 'oci',
        service,
        reference
      })),
      requires: requirements,
      capabilities: release.capabilities,
      dataVersion: release.dataVersion
    })
    const output = value('--output')
    if (output)
      writeFileSync(resolve(output), JSON.stringify(manifest, null, 2) + '\n')
    else console.log(JSON.stringify(manifest, null, 2))
  } finally {
    rmSync(context, { recursive: true, force: true })
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    main()
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
