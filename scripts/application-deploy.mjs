// Исполнитель получает только проверенные digest. Конфигурация площадки задаёт
// compose-проект; её пути и секреты не возвращаются в API и журналы.
import { applicationLinksHealthy } from './application-links.mjs'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  APPLICATION_CATALOG,
  validateCatalogRelease,
  validateCatalogArtifact
} from '../packages/shared/src/applicationCatalog.ts'
import {
  applicationReleaseIdentity,
  applicationCompatibility,
  applicationRuntimeMatches,
  parseApplicationEnvironment,
  parseApplicationReleaseManifest
} from '../packages/shared/src/applicationRelease.ts'
const json = (path) => JSON.parse(readFileSync(path, 'utf8'))
const sameRelease = (a, b) =>
  applicationReleaseIdentity(a) === applicationReleaseIdentity(b)
export function parseDeploymentConfig(value, directory) {
  if (
    !value ||
    typeof value.projectId !== 'string' ||
    !value.projectId ||
    !['staging', 'production'].includes(value.environment) ||
    !/^[a-z0-9][a-z0-9_-]{0,62}$/.test(value.projectName ?? '') ||
    !Array.isArray(value.composeFiles) ||
    !value.composeFiles.length ||
    value.composeFiles.length > 8 ||
    typeof value.stateDir !== 'string' ||
    !value.health ||
    typeof value.health !== 'object'
  )
    throw new Error('Некорректная конфигурация площадки')
  const path = (name) => {
    if (typeof name !== 'string' || !name || name.includes('\0'))
      throw new Error('Некорректный путь площадки')
    return isAbsolute(name) ? name : resolve(directory, name)
  }
  for (const [service, health] of Object.entries(value.health))
    if (
      !APPLICATION_CATALOG.some((app) => app.services.includes(service)) ||
      !Number.isInteger(health.port) ||
      health.port < 1 ||
      health.port > 65535 ||
      typeof health.path !== 'string' ||
      !/^\/[a-zA-Z0-9/_-]*$/.test(health.path) ||
      (health.tokenEnv && !/^[A-Z][A-Z0-9_]*$/.test(health.tokenEnv))
    )
      throw new Error(`Некорректный health-check ${service}`)
  return {
    projectId: value.projectId,
    environment: value.environment,
    projectName: value.projectName,
    composeFiles: value.composeFiles.map(path),
    stateDir: path(value.stateDir),
    health: value.health,
    ...(value.envFile ? { envFile: path(value.envFile) } : {})
  }
}
export function createDockerRuntime(
  config,
  execute = (args) =>
    execFileSync('docker', args, {
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe']
    }),
  { allowDevelopment = false } = {}
) {
  const base = [
    'compose',
    '-p',
    config.projectName,
    ...(config.envFile ? ['--env-file', config.envFile] : []),
    ...config.composeFiles.flatMap((path) => ['-f', path])
  ]
  const overrides = join(config.stateDir, 'compose.images.json')
  const compose = (args) =>
    execute([
      ...base,
      ...(existsSync(overrides) ? ['-f', overrides] : []),
      ...args
    ])
  const inspect = (id) => JSON.parse(execute(['inspect', id]))[0]
  const inventory = () => {
    const ids = compose(['ps', '--all', '--quiet'])
      .trim()
      .split(/\s+/)
      .filter(Boolean)
    return ids
      .map((id) => inspect(id))
      .filter(
        (item) =>
          item.Config.Labels?.['com.docker.compose.project'] ===
          config.projectName
      )
  }
  const releaseOfImage = (reference, service) => {
    const image = JSON.parse(execute(['image', 'inspect', reference]))[0]
    const metadata = JSON.parse(
      image.Config.Labels?.['com.voicechat.release'] ?? 'null'
    )
    if (!metadata) return null
    if (metadata.development && !allowDevelopment)
      throw new Error('Образ рабочей копии не допускается к deploy')
    const app = APPLICATION_CATALOG.find(
      (app) => app.id === metadata.applicationId
    )
    if (!app?.services.includes(service))
      throw new Error(`Образ не владеет сервисом ${service}`)
    const manifest = parseApplicationReleaseManifest({
      ...metadata,
      artifacts: app.services.map((service) => ({
        service,
        kind: 'oci',
        reference
      }))
    })
    if (!allowDevelopment) validateCatalogArtifact(manifest)
    return manifest
  }
  const health = (container, manifest) => {
    const service = container.Config.Labels['com.docker.compose.service'],
      probe = config.health[service]
    if (!probe) throw new Error(`Не задан health-check ${service}`)
    if (!container.State.Running) return false
    // Запрос внутри контейнера не зависит от публикации внутреннего порта наружу.
    const source = `const response=await fetch(${JSON.stringify(`http://127.0.0.1:${probe.port}${probe.path}`)},{signal:AbortSignal.timeout(8000),headers:${probe.tokenEnv ? `{authorization:'Bearer '+process.env[${JSON.stringify(probe.tokenEnv)}]}` : '{}'}});console.log(JSON.stringify({status:response.status,body:await response.json()}));`
    try {
      const result = JSON.parse(
        execute([
          'exec',
          container.Id,
          'node',
          '--input-type=module',
          '-e',
          source
        ])
      )
      return (
        result.status === 200 &&
        result.body.ok === true &&
        applicationRuntimeMatches(manifest, result.body.application)
      )
    } catch {
      return false
    }
  }
  return {
    inventory,
    linksHealthy(environment) {
      return applicationLinksHealthy(environment, inventory(), execute)
    },
    observe(previous = { schemaVersion: 1, revision: 0, applications: [] }) {
      const entries = new Map()
      for (const container of inventory()) {
        const service = container.Config.Labels['com.docker.compose.service']
        if (!APPLICATION_CATALOG.some((app) => app.services.includes(service)))
          continue
        const image = JSON.parse(
          execute(['image', 'inspect', container.Image])
        )[0]
        const reference = container.Config.Image.includes('@sha256:')
          ? container.Config.Image
          : [...(image.RepoDigests ?? [])].sort()[0]
        if (!reference) continue // Legacy-образ без digest не получает выдуманную версию.
        const manifest = releaseOfImage(reference, service)
        if (!manifest) continue
        const old = previous.applications.find((item) =>
          sameRelease(item.manifest, manifest)
        )
        const existing = entries.get(manifest.applicationId)
        if (existing && !sameRelease(existing.manifest, manifest))
          throw new Error(`Разные выпуски сервисов ${manifest.applicationId}`)
        const healthy = health(container, manifest)
        const entry = existing ?? {
          manifest,
          healthy: true,
          installedAt: old?.installedAt ?? Date.now(),
          services: new Set()
        }
        if (entry.services.has(service))
          throw new Error(`Несколько контейнеров ${service}`)
        entry.services.add(service)
        entry.healthy &&= healthy
        entries.set(manifest.applicationId, entry)
      }
      return parseApplicationEnvironment({
        schemaVersion: 1,
        revision: previous.revision,
        applications: [...entries.values()]
          .map(({ services, ...entry }) => ({
            ...entry,
            healthy:
              entry.healthy &&
              entry.manifest.artifacts.every((artifact) =>
                services.has(artifact.service)
              )
          }))
          .sort((a, b) =>
            a.manifest.applicationId.localeCompare(b.manifest.applicationId)
          )
      })
    },
    pull(manifest) {
      for (const artifact of manifest.artifacts) {
        execute(['pull', artifact.reference])
        const actual = releaseOfImage(artifact.reference, artifact.service)
        if (!actual || !sameRelease(actual, manifest))
          throw new Error(
            `Метаданные образа ${artifact.service} не соответствуют выпуску`
          )
      }
    },
    replace(releases, previous) {
      const services = releases.flatMap((release) =>
        release.artifacts.map((artifact) => artifact.service)
      )
      const model = JSON.parse(compose(['config', '--format', 'json']))
      if (services.some((service) => !model.services?.[service]))
        throw new Error('Сервис отсутствует в Compose площадки')
      const images = {
        ...(existsSync(overrides) ? json(overrides).services : {}),
        ...Object.fromEntries(
          previous.applications
            .flatMap((app) => app.manifest.artifacts)
            .map((artifact) => [
              artifact.service,
              { image: artifact.reference }
            ])
        )
      }
      for (const artifact of releases.flatMap((release) => release.artifacts))
        images[artifact.service] = { image: artifact.reference }
      const temp = overrides + '.tmp'
      writeFileSync(
        temp,
        JSON.stringify({ services: images }, null, 2) + '\n',
        { mode: 0o600 }
      )
      renameSync(temp, overrides)
      compose([
        'up',
        '-d',
        '--no-deps',
        '--no-build',
        '--pull',
        'never',
        ...services
      ])
    }
  }
}
export function applicationCompositionMatches(
  actual,
  expected,
  { health = true } = {}
) {
  return (
    actual.applications.length === expected.applications.length &&
    expected.applications.every((wanted) =>
      actual.applications.some(
        (item) =>
          sameRelease(item.manifest, wanted.manifest) &&
          (!health || item.healthy)
      )
    )
  )
}
export async function deployApplications(
  request,
  runtime,
  {
    wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    attempts = 12
  } = {}
) {
  const previous = parseApplicationEnvironment(request.previous),
    releases = request.releases.map(parseApplicationReleaseManifest)
  if (!releases.length) throw new Error('Пустой deploy')
  releases.forEach((release) => validateCatalogRelease(release))
  const before = runtime.observe(previous)
  if (!applicationCompositionMatches(before, previous))
    throw new Error(
      'Фактическое окружение изменилось: обновите состав перед deploy'
    )
  const issues = applicationCompatibility(before, releases)
  if (issues.length)
    throw new Error(issues.map((issue) => issue.message).join('; '))
  const changed = new Set(
    releases.flatMap((release) =>
      release.artifacts.map((artifact) => artifact.service)
    )
  )
  const untouched = runtime
    .inventory()
    .filter(
      (item) => !changed.has(item.Config.Labels['com.docker.compose.service'])
    )
    .map((item) => item.Id)
    .sort()
  const unchanged = () =>
    JSON.stringify(
      runtime
        .inventory()
        .filter(
          (item) =>
            !changed.has(item.Config.Labels['com.docker.compose.service'])
        )
        .map((item) => item.Id)
        .sort()
    ) === JSON.stringify(untouched)
  const expected = {
    ...previous,
    applications: [
      ...previous.applications.filter(
        (item) =>
          !releases.some(
            (release) => release.applicationId === item.manifest.applicationId
          )
      ),
      ...releases.map((manifest) => ({
        manifest,
        healthy: true,
        installedAt: 0
      }))
    ]
  }
  const healthy = async (target) => {
    for (let attempt = 0; attempt < attempts; attempt++) {
      const observed = runtime.observe(previous)
      if (
        applicationCompositionMatches(observed, target) &&
        unchanged() &&
        (!runtime.linksHealthy || runtime.linksHealthy(observed))
      )
        return observed
      if (attempt + 1 < attempts) await wait(2000)
    }
    return null
  }
  for (const release of releases) runtime.pull(release)
  try {
    runtime.replace(releases, previous)
    const observed = await healthy(expected)
    if (!observed)
      throw new Error(
        'Неверный digest, версия, health или перезапущен посторонний контейнер'
      )
    return {
      status: 'released',
      environment: observed,
      log: 'Выбранные сервисы обновлены; версии, digest, health и неизменность остальных контейнеров проверены.'
    }
  } catch (error) {
    const rollback = releases.map(
      (release) =>
        previous.applications.find(
          (app) => app.manifest.applicationId === release.applicationId
        )?.manifest
    )
    if (rollback.every(Boolean) && unchanged()) {
      try {
        for (const release of rollback) runtime.pull(release)
        runtime.replace(rollback, previous)
        const restored = await healthy(previous)
        if (restored)
          return {
            status: 'failed',
            environment: previous,
            log: `${error.message}; предыдущие артефакты восстановлены и проверены.`
          }
      } catch {}
    }
    return {
      status: 'uncertain',
      environment: null,
      log: `${error.message}; фактический состав требует повторной проверки.`
    }
  }
}
export async function main(args = process.argv.slice(2)) {
  const value = (flag) => {
    const i = args.indexOf(flag)
    return i >= 0 ? args[i + 1] : undefined
  }
  const configPath = resolve(
      value('--config') ?? '/etc/voicechat/applications.json'
    ),
    config = parseDeploymentConfig(json(configPath), dirname(configPath))
  const encoded = value('--request')
  if (!encoded || encoded.length > 512_000)
    throw new Error('Нужен запрос deploy')
  const request = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
  if (
    request.projectId !== config.projectId ||
    request.environment !== config.environment
  )
    throw new Error('Конфигурация принадлежит другому проекту или окружению')
  const runtime = createDockerRuntime(config)
  mkdirSync(config.stateDir, { recursive: true, mode: 0o700 })
  const lock = join(config.stateDir, 'deploy.lock')
  if (request.mode === 'observe') {
    console.log(
      JSON.stringify({ environment: runtime.observe(request.previous) })
    )
    return
  }
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(request.id ?? ''))
    throw new Error('Неверный id deploy')
  if (request.mode === 'reconcile') {
    if (existsSync(lock)) {
      const owner = json(join(lock, 'owner.json'))
      if (owner.id !== request.id)
        throw new Error('Площадка занята другим deploy')
      if (!Number.isInteger(owner.pid) || owner.pid < 1)
        throw new Error('Нельзя установить владельца блокировки')
      let live = true
      try {
        process.kill(owner.pid, 0)
      } catch (error) {
        if (error.code === 'ESRCH') live = false
      }
      if (live)
        throw new Error(
          'Исполнитель ещё работает: сверка не снимает его блокировку'
        )
    }
    const environment = runtime.observe(request.previous)
    const expected = {
      ...request.previous,
      applications: [
        ...request.previous.applications.filter(
          (item) =>
            !request.releases.some(
              (release) => release.applicationId === item.manifest.applicationId
            )
        ),
        ...request.releases.map((manifest) => ({
          manifest,
          healthy: true,
          installedAt: 0
        }))
      ]
    }
    const linked = runtime.linksHealthy(environment)
    const status =
      applicationCompositionMatches(environment, expected) && linked
        ? 'released'
        : applicationCompositionMatches(environment, request.previous) && linked
          ? 'failed'
          : 'uncertain'
    if (
      status !== 'uncertain' &&
      existsSync(lock) &&
      json(join(lock, 'owner.json')).id === request.id
    )
      rmSync(lock, { recursive: true })
    console.log(
      JSON.stringify({
        status,
        environment:
          status === 'failed'
            ? request.previous
            : status === 'released'
              ? environment
              : null,
        log: 'Состояние перепроверено после прерывания.'
      })
    )
    return
  }
  if (request.mode !== 'deploy') throw new Error('Неизвестный режим')
  try {
    mkdirSync(lock)
  } catch {
    throw new Error('На площадке уже выполняется deploy; требуется reconcile')
  }
  writeFileSync(
    join(lock, 'owner.json'),
    JSON.stringify({ id: request.id, pid: process.pid }),
    { mode: 0o600 }
  )
  try {
    const result = await deployApplications(request, runtime)
    if (result.status !== 'uncertain') rmSync(lock, { recursive: true })
    console.log(JSON.stringify(result))
  } catch (error) {
    rmSync(lock, { recursive: true })
    throw error
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
