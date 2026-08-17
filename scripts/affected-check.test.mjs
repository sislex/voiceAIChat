import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createCommandDiagnostics, fastCheckForPackage, packageArgs, relatedArgs, runFastChecks, runPackageGates, selectAffected } from './affected-check.mjs'
import { gitHistoryPaths } from './kb.mjs'

const ids = (decision) => decision.packages.map((pkg) => pkg.id)
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function timedStart(events, { fail } = {}) {
  let active = 0
  let maxActive = 0
  return {
    start(pkg, script, { maxWorkers }) {
      active += 1
      maxActive = Math.max(maxActive, active)
      events.push({ type: 'start', pkg: pkg.id, script, maxWorkers })
      let stopped = false
      const done = (async () => {
        await delay(30)
        active -= 1
        events.push({ type: 'end', pkg: pkg.id, script })
        if (fail?.(pkg, script)) throw Object.assign(new Error('expected failure'), { code: 23 })
      })()
      return {
        done,
        stop() {
          if (stopped) return
          stopped = true
          events.push({ type: 'stop', pkg: pkg.id, script })
        }
      }
    },
    maxActive: () => maxActive
  }
}

test('selectAffected выбирает пакеты и безопасный fallback', async (t) => {
  await t.test('правка только server', () => {
    const decision = selectAffected(['apps/server/src/server.ts'])
    assert.equal(decision.full, false)
    assert.deepEqual(ids(decision), ['server'])
  })

  await t.test('shared проверяет себя и всех известных потребителей', () => {
    const decision = selectAffected(['packages/shared/src/ci.ts'])
    assert.equal(decision.full, false)
    assert.deepEqual(ids(decision), ['shared', 'server', 'runner', 'agent', 'ui', 'web'])
  })

  for (const file of ['package-lock.json', 'package.json', 'scripts/kb.mjs', '.github/workflows/ci.yml', 'unknown/critical.ts']) {
    await t.test(`${file} включает полный гейт`, () => {
      const decision = selectAffected([file])
      assert.equal(decision.full, true)
      assert.deepEqual(ids(decision), ['shared', 'server', 'runner', 'agent', 'ui', 'web'])
      assert.match(decision.reason, /общий конфиг|нераспознанный/)
    })
  }

  await t.test('пустой diff ничего не запускает', () => {
    const decision = selectAffected([])
    assert.equal(decision.full, false)
    assert.deepEqual(ids(decision), [])
  })

  await t.test('некорректный diff включает полный гейт', () => {
    const decision = selectAffected(['apps/server/src/x.ts', ''])
    assert.equal(decision.full, true)
    assert.deepEqual(ids(decision), ['shared', 'server', 'runner', 'agent', 'ui', 'web'])
  })
})

test('gitHistoryPaths исключает генерируемый индекс БЗ из широких areas', () => {
  assert.deepEqual(gitHistoryPaths(['docs/kb', 'apps/server/src/kb']), [
    'docs/kb',
    'apps/server/src/kb',
    ':(exclude)docs/kb/README.md'
  ])
})

test('диагностика молчит на быстром успехе, даёт heartbeat и хвост при остановке', async () => {
  const info = []
  const errors = []
  const quick = createCommandDiagnostics('server / test', { heartbeatMs: 20, info: (line) => info.push(line), error: (line) => errors.push(line) })
  quick.append('quick output')
  quick.complete()
  await delay(30)
  assert.deepEqual(info, [])
  assert.deepEqual(errors, [])

  let now = 0
  const hanging = createCommandDiagnostics('server / test', {
    heartbeatMs: 10,
    now: () => now,
    info: (line) => info.push(line),
    error: (line) => errors.push(line)
  })
  hanging.append('first line\nlast active test')
  now = 31_000
  await delay(15)
  hanging.stopped('timeout')
  assert.match(info.at(-1), /active package: server \/ test; elapsed: 31s; stage: running/)
  assert.match(errors.at(-1), /timeout: server \/ test[\s\S]*last active test/)
})

test('packageArgs согласует min/max workers для Vitest', () => {
  assert.deepEqual(
    packageArgs({ workspace: '@voicechat/shared' }, 'test', 1, ['--reporter=json']),
    ['run', '-w', '@voicechat/shared', 'test', '--', '--minWorkers=1', '--maxWorkers=1', '--reporter=json']
  )
  assert.deepEqual(
    packageArgs({ workspace: '@voicechat/shared' }, 'typecheck', 1),
    ['run', '-w', '@voicechat/shared', 'typecheck']
  )
})

test('relatedArgs согласует min/max workers для fast-stage Vitest', () => {
  assert.deepEqual(
    relatedArgs(['src/server.ts'], '/tmp/report.json', 1),
    ['vitest', 'related', 'src/server.ts', '--run', '--passWithNoTests', '--reporter=json', '--outputFile=/tmp/report.json', '--silent', '--minWorkers=1', '--maxWorkers=1']
  )
})

test('runPackageGates ограничивает два независимых гейта и замеряет ускорение', async () => {
  const packages = [{ id: 'one' }, { id: 'two' }]

  const sequentialEvents = []
  const sequentialRunner = timedStart(sequentialEvents)
  const sequentialStarted = Date.now()
  await runPackageGates(packages, { jobs: 1, start: sequentialRunner.start })
  const sequentialMs = Date.now() - sequentialStarted

  const parallelEvents = []
  const parallelRunner = timedStart(parallelEvents)
  const parallelStarted = Date.now()
  await runPackageGates(packages, { jobs: 2, start: parallelRunner.start })
  const parallelMs = Date.now() - parallelStarted

  assert.equal(sequentialRunner.maxActive(), 1)
  assert.equal(parallelRunner.maxActive(), 2)
  assert.ok(parallelMs < sequentialMs, `parallel ${parallelMs}ms must be faster than sequential ${sequentialMs}ms`)
  const parallelTests = parallelEvents.filter((event) => event.type === 'start' && event.script === 'test')
  const sequentialTests = sequentialEvents.filter((event) => event.type === 'start' && event.script === 'test')
  assert.ok(parallelTests.every((event) => event.maxWorkers === 1))
  assert.ok(sequentialTests.every((event) => event.maxWorkers === undefined))
})

test('runPackageGates останавливает активные процессы и не выдаёт новые после ошибки', async () => {
  const events = []
  const runner = timedStart(events, { fail: (pkg, script) => pkg.id === 'one' && script === 'typecheck' })

  await assert.rejects(
    runPackageGates([{ id: 'one' }, { id: 'two' }, { id: 'three' }], { jobs: 2, start: runner.start }),
    (error) => error.code === 23
  )

  assert.ok(events.some((event) => event.type === 'stop' && event.pkg === 'two'))
  assert.equal(events.some((event) => event.type === 'start' && event.pkg === 'three'), false)
})

test('fastCheckForPackage пропускает shared, конфиги и миграции к полному гейту', () => {
  const shared = { id: 'shared', path: 'packages/shared' }
  const server = { id: 'server', path: 'apps/server' }

  assert.equal(fastCheckForPackage(shared, ['packages/shared/src/ci.ts']).reason, 'shared-контракт')
  assert.equal(fastCheckForPackage(server, ['apps/server/vitest.config.ts']).reason, 'конфиг, схема или миграция')
  assert.equal(fastCheckForPackage(server, ['apps/server/src/db/migrations/001.sql']).reason, 'конфиг, схема или миграция')
  assert.deepEqual(fastCheckForPackage(server, ['apps/server/src/ci/runManager.ts']).files, ['src/ci/runManager.ts'])
})

test('related проходит до обязательного полного гейта и ноль тестов не даёт успех', async () => {
  const pkg = { id: 'server', path: 'apps/server' }
  const events = []
  const startedAt = Date.now()
  const fast = (check) => {
    events.push(`fast:${check.pkg.id}`)
    return { done: delay(20).then(() => ({ found: false })), stop() {} }
  }
  const full = (current, script) => {
    events.push(`full:${current.id}:${script}`)
    return { done: delay(20), stop() {} }
  }

  await runFastChecks([fastCheckForPackage(pkg, ['apps/server/src/ci/runManager.ts'])], { jobs: 1, start: fast })
  const fastMs = Date.now() - startedAt
  await runPackageGates([pkg], { jobs: 1, start: full })
  const fullMs = Date.now() - startedAt - fastMs

  assert.deepEqual(events, ['fast:server', 'full:server:typecheck', 'full:server:test'])
  assert.ok(fastMs >= 15, `fast stage duration: ${fastMs}ms`)
  assert.ok(fullMs >= 35, `full stage duration: ${fullMs}ms`)
})

test('ошибка related останавливает этап до полного гейта', async () => {
  const events = []
  const pkg = { id: 'server', path: 'apps/server' }
  const fast = () => ({
    done: Promise.reject(Object.assign(new Error('related failed'), { code: 31 })),
    stop() { events.push('fast:stop') }
  })

  await assert.rejects(
    runFastChecks([fastCheckForPackage(pkg, ['apps/server/src/ci/runManager.ts'])], { start: fast }),
    (error) => error.code === 31
  )
  assert.deepEqual(events, ['fast:stop'])
})

test('точка входа запускает гейт из пути с не-ASCII и передаёт ошибку теста пакета', () => {
  const repository = dirname(dirname(fileURLToPath(import.meta.url)))
  const tempRoot = mkdtempSync(join(tmpdir(), 'affected-check-тест-'))
  const worktree = join(tempRoot, 'репозиторий')
  const commandsDirectory = join(tempRoot, 'commands')
  const npmCalls = join(tempRoot, 'npm-calls.log')
  const script = join(repository, 'scripts/affected-check.mjs')

  try {
    // Содержимое репозитория гейту не нужно: BASE_BRANCH указывает на несуществующую
    // ветку, поэтому diff недоступен и скрипт идёт по полному fallback с npm-заглушками.
    // Пустой git-репозиторий вместо копии рабочего дерева — иначе тест копировал
    // гигабайты (node_modules, electron, .venv-piper) и падал по месту на диске.
    const initialized = spawnSync('git', ['init', '--quiet', worktree], { encoding: 'utf8' })
    assert.equal(initialized.status, 0, initialized.stderr)
    mkdirSync(commandsDirectory)
    const npm = join(commandsDirectory, 'npm')
    writeFileSync(npm, `#!/bin/sh
printf '%s\\n' "$*" >> ${npmCalls}
case "$*" in *test*) exit 1 ;; *) exit 0 ;; esac
`)
    chmodSync(npm, 0o755)
    const npx = join(commandsDirectory, 'npx')
    writeFileSync(npx, '#!/bin/sh\nexit 0\n')
    chmodSync(npx, 0o755)

    const result = spawnSync(process.execPath, [script, '--jobs', '1'], {
      cwd: worktree,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${commandsDirectory}:${process.env.PATH}`,
        BASE_BRANCH: 'non-existing-base-branch-for-test'
      }
    })
    assert.notEqual(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
    assert.match(readFileSync(npmCalls, 'utf8'), /test/)
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('production deploy сохраняет версию защищённого релиза после setsid/nohup', async () => {
  const repository = dirname(dirname(fileURLToPath(import.meta.url)))
  const tempRoot = mkdtempSync(join(tmpdir(), 'voicechat-deploy-test-'))
  const commandsDirectory = join(tempRoot, 'commands')
  const marker = join(tempRoot, 'docker-env')
  const log = join(tempRoot, 'deploy.log')
  mkdirSync(commandsDirectory)

  const executable = (name, body) => {
    const path = join(commandsDirectory, name)
    writeFileSync(path, `#!/bin/sh
set -eu
${body}
`)
    chmodSync(path, 0o755)
  }

  try {
    executable('git', `
case "$*" in
  "rev-parse --short=12 HEAD") echo abcdef123456 ;;
  "rev-parse --short HEAD") echo abcdef1 ;;
  "log -1 --pretty=%s") echo "release test" ;;
esac
`)
    // macOS не поставляет GNU setsid; заглушки сохраняют границу exec/env,
    // которую проверяет тест, не привязывая suite к платформе CI.
    executable('setsid', `exec "$@"`)
    executable('nohup', `exec "$@"`)
    executable('flock', `exit 0`)
    executable('docker', `printf '%s|%s|%s' "$VC_RELEASE_VERSION" "$VC_RELEASE_VERSION_SOURCE" "$VC_RELEASE_COMMIT" >"$DEPLOY_TEST_MARKER"`)
    executable('curl', `printf '%s\\n' '{"ok":true}'`)

    const result = spawnSync('bash', [join(repository, 'scripts/prod/deploy.sh')], {
      cwd: tempRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${commandsDirectory}:${process.env.PATH}`,
        VC_REPO_DIR: tempRoot,
        VC_DEPLOY_LOG: log,
        VC_DEPLOY_LOCK: join(tempRoot, 'deploy.lock'),
        VC_RELEASE_VERSION: '0.1.42',
        VC_RELEASE_VERSION_SOURCE: 'protected-release',
        DEPLOY_TEST_MARKER: marker
      }
    })
    assert.equal(result.status, 0, result.stderr)

    let metadata = ''
    for (let attempt = 0; attempt < 500 && !metadata; attempt += 1) {
      await delay(20)
      try { metadata = readFileSync(marker, 'utf8') } catch {}
    }
    assert.equal(metadata, '0.1.42|protected-release|abcdef123456')
    assert.match(readFileSync(log, 'utf8'), /version=0\.1\.42 .*source=protected-release/)
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
})
