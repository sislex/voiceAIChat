// Повторяемый локальный staging-пилот: настоящие Docker/SQLite, сохранность
// данных, неизменность других контейнеров, health failure и точный rollback.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { VoiceChatDb } from '../apps/server/src/db/database.ts'
import { parseApplicationReleaseManifest } from '../packages/shared/src/applicationRelease.ts'
import {
  createDockerRuntime,
  deployApplications
} from './application-deploy.mjs'
import {
  compatibilityCompose,
  runCompatibilityCase
} from './application-compatibility.mjs'
import { verifyCompatibility } from '../apps/make/compatibility.mjs'
const token = 'compatibility-isolated-local-only'
const docker = (args) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 180_000,
    maxBuffer: 8 * 1024 * 1024
  })
const json = (path) => JSON.parse(readFileSync(path, 'utf8'))
export async function pilotMake(
  core,
  previous,
  candidate,
  { development = false } = {}
) {
  const dir = mkdtempSync(join(tmpdir(), 'vc-deploy-pilot-')),
    projectName = 'vc-pilot-' + randomUUID().slice(0, 12),
    file = join(dir, 'compose.json'),
    stateDir = join(dir, 'state')
  mkdirSync(stateDir)
  const compose = compatibilityCompose(previous, [core])
  compose.services.voicechat.volumes = ['core-data:/data']
  compose.services.make.volumes = ['make-data:/data']
  compose.services.sentinel = {
    image: core.artifacts[0].reference,
    command: ['node', '-e', 'setInterval(()=>{},1000)']
  }
  compose.volumes = { 'core-data': {}, 'make-data': {} }
  const save = () =>
    writeFileSync(file, JSON.stringify(compose), { mode: 0o600 })
  save()
  const base = ['compose', '-p', projectName, '-f', file]
  const runtime = createDockerRuntime(
    {
      projectId: projectName,
      environment: 'staging',
      projectName,
      composeFiles: [file],
      stateDir,
      health: {
        voicechat: { port: 8080, path: '/api/health' },
        make: { port: 8080, path: '/v1/health' }
      }
    },
    docker,
    { allowDevelopment: development }
  )
  const urls = () =>
    Object.fromEntries(
      runtime
        .inventory()
        .filter((item) => item.NetworkSettings.Ports?.['8080/tcp']?.[0])
        .map((item) => [
          item.Config.Labels['com.docker.compose.service'],
          `http://127.0.0.1:${item.NetworkSettings.Ports['8080/tcp'][0].HostPort}`
        ])
    )
  const stableIds = () =>
    Object.fromEntries(
      runtime
        .inventory()
        .filter(
          (item) => item.Config.Labels['com.docker.compose.service'] !== 'make'
        )
        .map((item) => [
          item.Config.Labels['com.docker.compose.service'],
          item.Id
        ])
    )
  const db = new VoiceChatDb(join(dir, 'releases.sqlite'))
  try {
    await db.ready
    await db.identity.createUser('owner', '', 'developer')
    const projectId = (
      await db.projects.createProject('owner', { name: projectName })
    ).id
    docker([...base, 'up', '-d', '--no-build', '--pull', 'never'])
    let observed
    for (let attempt = 0; attempt < 40; attempt++) {
      observed = runtime.observe()
      if (
        observed.applications.length === 2 &&
        observed.applications.every((item) => item.healthy)
      )
        break
      if (attempt === 39) throw new Error('Не поднялся исходный состав пилота')
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    const originalIds = stableIds(),
      originalMake = runtime
        .inventory()
        .find(
          (item) => item.Config.Labels['com.docker.compose.service'] === 'make'
        ).Id
    const data = await verifyCompatibility({ urls: urls(), token })
    await db.releases.observeApplicationEnvironment(
      'owner',
      projectId,
      'staging',
      observed,
      0
    )
    const prepare = async (manifest) => {
      const { record } = await db.releases.createApplicationRelease(
        'owner',
        projectId,
        {
          applicationId: manifest.applicationId,
          version: manifest.version,
          image: manifest.artifacts[0].reference.split('@')[0],
          baseBranch: 'main',
          requires: manifest.requires
        }
      )
      await db.releases.finishApplicationRelease(
        record.id,
        manifest,
        'Локальный пилот: контрактная матрица проверена на артефакте'
      )
      return record.id
    }
    const candidateId = await prepare(candidate),
      previousId = await prepare(previous)
    const run = async (input, executor = runtime) => {
      const view = await db.releases.applicationReleaseOverview(
        'owner',
        projectId,
        'staging'
      )
      const { record } = await db.releases.beginApplicationDeployment(
        'owner',
        projectId,
        'staging',
        {
          requestId: randomUUID(),
          expectedRevision: view.environment.revision,
          ...input
        }
      )
      const result = await deployApplications(record, executor, { attempts: 4 })
      await db.releases.finishApplicationDeployment(
        record.id,
        result.status,
        result.environment,
        result.log
      )
      assert.deepEqual(
        stableIds(),
        originalIds,
        'Посторонний контейнер был перезапущен'
      )
      return { record, result }
    }
    const updated = await run({ releaseIds: [candidateId] })
    assert.equal(updated.result.status, 'released')
    assert.notEqual(
      runtime
        .inventory()
        .find(
          (item) => item.Config.Labels['com.docker.compose.service'] === 'make'
        ).Id,
      originalMake
    )
    const checkData = async () => {
      const response = await fetch(
        `${urls().voicechat}/api/make/${data.conversationId}/file?path=index.html`,
        {
          headers: { authorization: `Bearer ${data.auth}` },
          signal: AbortSignal.timeout(10000)
        }
      )
      assert.equal(response.status, 200)
      assert.equal((await response.json()).content, data.content)
    }
    await checkData()
    // Ошибка конфигурации именно после preflight: контейнер нового выпуска
    // запускается без обязательного секрета. Восстановление возвращает конфиг.
    let replacement = 0
    const failing = {
      ...runtime,
      replace(releases, current) {
        replacement++
        compose.services.make.environment.VC_MCP_SECRET =
          replacement === 1 ? '' : token
        save()
        runtime.replace(releases, current)
      }
    }
    const failed = await run({ releaseIds: [previousId] }, failing)
    assert.equal(failed.result.status, 'failed')
    await checkData()
    const rollback = await run({
      releaseIds: [],
      rollbackOf: updated.record.id
    })
    assert.equal(rollback.result.status, 'released')
    await checkData()
    const overview = await db.releases.applicationReleaseOverview(
      'owner',
      projectId,
      'staging'
    )
    assert.equal(
      overview.environment.applications.find(
        (item) => item.manifest.applicationId === 'make'
      ).manifest.version,
      previous.version
    )
    return {
      coreVersion: core.version,
      development,
      untouchedContainers: originalIds,
      updated: updated.result,
      healthFailure: failed.result,
      rollback: rollback.result,
      overview
    }
  } finally {
    try {
      await db.close()
    } finally {
      try {
        docker([...base, 'down', '--volumes', '--remove-orphans'])
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }
  }
}
export async function main(args = process.argv.slice(2)) {
  const value = (flag) => {
    const i = args.indexOf(flag)
    return i >= 0 ? args[i + 1] : undefined
  }
  const manifest = (flag) => {
    const path = value(flag)
    if (!path) throw new Error(`Нужен ${flag}`)
    return parseApplicationReleaseManifest(json(resolve(path)))
  }
  const old = manifest('--make-old'),
    candidate = manifest('--make-new'),
    minimum = manifest('--core-min'),
    current = manifest('--core-current')
  const development = args.includes('--development'),
    results = []
  for (const core of [minimum, current]) {
    console.error(
      `Пилот: Make ${old.version} → ${candidate.version}, ядро ${core.version}`
    )
    await runCompatibilityCase(
      candidate,
      { name: `core-${core.version}`, applications: [core] },
      { allowDevelopment: development }
    )
    results.push(await pilotMake(core, old, candidate, { development }))
  }
  const output =
    JSON.stringify(
      { development, finishedAt: new Date().toISOString(), results },
      null,
      2
    ) + '\n'
  if (value('--output')) writeFileSync(resolve(value('--output')), output)
  else console.log(output)
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error))
    process.exitCode = 1
  })
