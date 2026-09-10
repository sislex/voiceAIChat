// Матрица использует реальные OCI-артефакты. Отсутствие минимального baseline
// или контрактного сценария — ошибка подготовки, а не пропущенный тест.
import { execFileSync } from 'node:child_process'
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  existsSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { APPLICATION_CATALOG } from '../packages/shared/src/applicationCatalog.ts'
import {
  applicationCompatibility,
  applicationReleaseIdentity,
  compareApplicationVersions,
  parseApplicationReleaseManifest
} from '../packages/shared/src/applicationRelease.ts'
import { createDockerRuntime } from './application-deploy.mjs'
const root = resolve(import.meta.dirname, '..')
const json = (path) => JSON.parse(readFileSync(path, 'utf8'))
export function planCompatibilityMatrix(candidate, source) {
  candidate = parseApplicationReleaseManifest(candidate)
  if (
    !source ||
    source.schemaVersion !== 1 ||
    !Array.isArray(source.environments) ||
    !source.environments.length ||
    source.environments.length > 32
  )
    throw new Error('Нужна матрица проверяемых артефактов')
  const names = new Set()
  const cases = source.environments.map((row) => {
    if (
      !row ||
      typeof row.name !== 'string' ||
      !row.name ||
      row.name.length > 100 ||
      names.has(row.name) ||
      !Array.isArray(row.applications)
    )
      throw new Error('Неверный или повторный сценарий матрицы')
    names.add(row.name)
    const applications = row.applications.map(parseApplicationReleaseManifest)
    if (
      applications.some((app) => app.applicationId === candidate.applicationId)
    )
      throw new Error('Baseline не может подменять проверяемый артефакт')
    const environment = {
      schemaVersion: 1,
      revision: 0,
      applications: applications.map((manifest) => ({
        manifest,
        healthy: true,
        installedAt: 0
      }))
    }
    const issues = applicationCompatibility(environment, [candidate])
    if (issues.length)
      throw new Error(
        `${row.name}: ${issues.map((issue) => issue.message).join('; ')}`
      )
    return { name: row.name, applications }
  })
  for (const requirement of candidate.requires.filter(
    (item) => !item.optional
  )) {
    const versions = cases.flatMap((row) =>
      row.applications
        .filter((app) => app.applicationId === requirement.applicationId)
        .map((app) => app.version)
    )
    if (!versions.includes(requirement.minVersion))
      throw new Error(
        `Нет артефакта минимальной версии ${requirement.applicationId} ${requirement.minVersion}`
      )
    // Текущая поддерживаемая версия задаётся отдельно, чтобы один случай с
    // минимумом не выдавался за проверку последнего поддерживаемого выпуска.
    const current = source.current?.[requirement.applicationId]
    if (
      typeof current !== 'string' ||
      !versions.includes(current) ||
      compareApplicationVersions(current, requirement.minVersion) < 0
    )
      throw new Error(
        `Нет текущего поддерживаемого артефакта ${requirement.applicationId}`
      )
  }
  return cases
}
const token = 'compatibility-isolated-local-only'
export function compatibilityCompose(candidate, baselines) {
  const releases = [...baselines, candidate],
    services = {}
  for (const manifest of releases) {
    const app = APPLICATION_CATALOG.find(
      (app) => app.id === manifest.applicationId
    )
    if (
      !app ||
      app.services.length !== manifest.artifacts.length ||
      manifest.artifacts.some(
        (artifact) => !app.services.includes(artifact.service)
      )
    )
      throw new Error(`Неизвестные сервисы ${manifest.applicationId}`)
    for (const artifact of manifest.artifacts)
      services[artifact.service] = {
        image: artifact.reference,
        ports: ['127.0.0.1::8080'],
        environment: {
          PORT: '8080',
          HOST: '0.0.0.0',
          VC_DATA_DIR: '/data',
          VC_AUTOMATION_DATA_DIR: '/data',
          VC_TTS_DATA_DIR: '/data',
          VC_CORE_URL: 'http://voicechat:8080',
          VC_APPLICATION_FRONTENDS: JSON.stringify(
            Object.fromEntries(
              releases
                .filter(
                  (release) =>
                    APPLICATION_CATALOG.find(
                      (app) => app.id === release.applicationId
                    )?.frontend
                )
                .map((release) => [
                  release.applicationId,
                  'http://' + release.artifacts[0].service + ':8080'
                ])
            )
          ),
          VC_INTERNAL_TOKEN: token,
          VC_MCP_SECRET: token,
          VC_ADMIN_PASSWORD: token,
          VC_RUNNER_TOKEN: token,
          VC_STT_RUNNER_TOKEN: token,
          VC_TTS_RUNNER_TOKEN: token,
          VC_BROWSER_RUNNER_TOKEN: token,
          VC_AUTOMATION_RUNNER_TOKEN: token,
          ...(releases.some((item) => item.applicationId === 'web-reader')
            ? { VC_READER_MODE: 'remote', VC_READER_URL: 'http://web-reader:8080' } : {}),
          ...(releases.some((item) => item.applicationId === 'make')
            ? { VC_MAKE_MODE: 'remote', VC_MAKE_URL: 'http://make:8080' }
            : {}),
          ...(releases.some((item) => item.applicationId === 'image-studio')
            ? {
                VC_IMAGE_STUDIO_MODE: 'remote',
                VC_IMAGE_STUDIO_URL: 'http://image-studio:8080'
              }
            : {}),
          ...(releases.some(
            (item) => item.applicationId === 'playwright-reader'
          )
            ? {
                VC_PLAYWRIGHT_READER_MODE: 'remote',
                VC_PLAYWRIGHT_READER_URL: 'http://playwright-reader:8080'
              }
            : {}),
          ...(releases.some((item) => item.applicationId === 'browser-runner')
            ? { VC_BROWSER_RUNNER_URL: 'http://browser-runner:8080' }
            : {}),
          ...(releases.some((item) => item.applicationId === 'llm-runner')
            ? {
                VC_LLM_RUNNER_URL: 'http://runner-work:8080',
                VC_LLM_RUNNER_TOKEN: token
              }
            : {})
        }
      }
  }
  return { services }
}
export async function runCompatibilityCase(
  candidate,
  row,
  {
    allowDevelopment = false,
    execute = (args) =>
      execFileSync('docker', args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 180_000,
        maxBuffer: 8 * 1024 * 1024
      })
  } = {}
) {
  const app = APPLICATION_CATALOG.find(
    (app) => app.id === candidate.applicationId
  )
  const driver = app && join(root, app.paths[0], 'compatibility.mjs')
  if (!driver || !existsSync(driver))
    throw new Error(`Нет контрактного сценария ${candidate.applicationId}`)
  const contract = await import(pathToFileURL(driver).href)
  if (typeof contract.verifyCompatibility !== 'function')
    throw new Error('Сценарий не экспортирует verifyCompatibility')
  const dir = mkdtempSync(join(tmpdir(), 'vc-compatibility-')),
    projectName = 'vc-matrix-' + randomUUID().slice(0, 12),
    composeFile = join(dir, 'compose.json')
  const compose = compatibilityCompose(candidate, row.applications)
  writeFileSync(composeFile, JSON.stringify(compose), { mode: 0o600 })
  const base = ['compose', '-p', projectName, '-f', composeFile]
  const health = Object.fromEntries(
    [candidate, ...row.applications].flatMap((manifest) =>
      manifest.artifacts.map((artifact) => [
        artifact.service,
        {
          port: 8080,
          path: APPLICATION_CATALOG.find(
            (app) => app.id === manifest.applicationId
          ).healthPath,
          ...(manifest.applicationId.endsWith('runner')
            ? {
                tokenEnv:
                  manifest.applicationId === 'llm-runner'
                    ? 'VC_RUNNER_TOKEN'
                    : `VC_${manifest.applicationId.toUpperCase().replaceAll('-', '_')}_TOKEN`
              }
            : {})
        }
      ])
    )
  )
  const runtime = createDockerRuntime(
    {
      projectId: projectName,
      environment: 'staging',
      projectName,
      composeFiles: [composeFile],
      stateDir: dir,
      health
    },
    execute,
    { allowDevelopment }
  )
  try {
    execute([...base, 'pull'])
    execute([...base, 'up', '-d', '--no-build', '--pull', 'never'])
    let observed
    for (let attempt = 0; attempt < 45; attempt++) {
      observed = runtime.observe()
      if (
        observed.applications.length === row.applications.length + 1 &&
        observed.applications.every((item) => item.healthy)
      )
        break
      if (attempt === 44)
        throw new Error(
          `${row.name}: контейнеры не прошли health и сверку версии`
        )
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    for (const manifest of [candidate, ...row.applications])
      if (
        !observed.applications.some(
          (actual) =>
            applicationReleaseIdentity(actual.manifest) ===
            applicationReleaseIdentity(manifest)
        )
      )
        throw new Error(
          `${row.name}: запущен другой артефакт ${manifest.applicationId}`
        )
    const urls = Object.fromEntries(
      runtime
        .inventory()
        .map((container) => [
          container.Config.Labels['com.docker.compose.service'],
          `http://127.0.0.1:${container.NetworkSettings.Ports['8080/tcp'][0].HostPort}`
        ])
    )
    await contract.verifyCompatibility({
      candidate,
      baselines: row.applications,
      urls,
      token
    })
    return {
      name: row.name,
      status: 'passed',
      candidate: candidate.artifacts,
      baselines: row.applications.map((app) => ({
        applicationId: app.applicationId,
        version: app.version,
        artifacts: app.artifacts
      }))
    }
  } finally {
    try {
      execute([...base, 'down', '--volumes', '--remove-orphans'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}
export async function main(args = process.argv.slice(2)) {
  const value = (flag) => {
    const i = args.indexOf(flag)
    return i >= 0 ? args[i + 1] : undefined
  }
  if (!value('--manifest')) throw new Error('Нужен --manifest <json>')
  const candidate = parseApplicationReleaseManifest(
      json(resolve(value('--manifest')))
    ),
    app = APPLICATION_CATALOG.find((app) => app.id === candidate.applicationId)
  if (!app) throw new Error('Неизвестное приложение')
  const matrixPath = value('--matrix')
    ? resolve(value('--matrix'))
    : join(root, app.paths[0], 'release-matrix.json')
  const source = existsSync(matrixPath)
    ? json(matrixPath)
    : candidate.requires.some((item) => !item.optional)
      ? null
      : {
          schemaVersion: 1,
          environments: [{ name: 'standalone', applications: [] }],
          current: {}
        }
  const cases = planCompatibilityMatrix(candidate, source),
    results = []
  for (const row of cases)
    results.push(
      await runCompatibilityCase(candidate, row, {
        allowDevelopment: args.includes('--development')
      })
    )
  console.log(
    JSON.stringify(
      {
        applicationId: candidate.applicationId,
        version: candidate.version,
        development: args.includes('--development'),
        results
      },
      null,
      2
    )
  )
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
