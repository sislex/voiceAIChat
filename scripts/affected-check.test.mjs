import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { buildGates, consumersOf, createCommandDiagnostics, dependenciesOf, fastCheckForPackage, fastPlanForPackage, packageArgs, parseOptions, PACKAGES, relatedArgs, runFastChecks, runPackageGates, selectAffected, validatePackageDependencies, workersPerJob } from './affected-check.mjs'
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

  await t.test('retired Reader and worker paths select the conservative consumer gate', () => {
    assert.equal(selectAffected(['apps/playwright-reader/src/module.ts']).full, true)
    assert.equal(selectAffected(['apps/browser-runner/src/client.ts']).full, true)
  })

  await t.test('shared проверяет себя и всех известных потребителей', () => {
    const decision = selectAffected(['packages/shared/src/ci.ts'])
    assert.equal(decision.full, false)
    assert.deepEqual(ids(decision), ['component-runtime', 'shared', 'server', 'automation-runner'])
  })

  await t.test('retired session source paths fail safely to the full consumer gate', () => {
    assert.equal(selectAffected(['packages/sessions-core/src/policy.ts']).full, true)
  })

  await t.test('правка UI не затрагивает отделённый Web Recorder', () => {
    const decision = selectAffected(['packages/ui/src/App.tsx'])
    assert.equal(decision.full, true)
    assert.deepEqual(ids(decision), ['component-runtime', 'shared', 'server', 'automation-runner'])
  })

  for (const file of ['package-lock.json', 'package.json', 'scripts/kb.mjs', '.github/workflows/ci.yml', 'unknown/critical.ts']) {
    await t.test(`${file} включает полный гейт`, () => {
      const decision = selectAffected([file])
      assert.equal(decision.full, true)
      assert.deepEqual(ids(decision), ['component-runtime', 'shared', 'server', 'automation-runner'])
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
    assert.deepEqual(ids(decision), ['component-runtime', 'shared', 'server', 'automation-runner'])
  })
})

// Сторожевые тесты карты пакетов. Забытый в PACKAGES воркспейс не ломал гейт
// заметно — он молча превращал узкий гейт в полный («нераспознанный критичный
// путь»), и так десять воркспейсов ездили мимо. Поэтому список сверяется с
// файловой системой, а dependsOn — с манифестами.
test('PACKAGES перечисляет каждый воркспейс репозитория', () => {
  const repository = dirname(dirname(fileURLToPath(import.meta.url)))
  const found = []
  for (const root of ['packages', 'apps']) {
    for (const entry of readdirSync(join(repository, root))) {
      if (existsSync(join(repository, root, entry, 'package.json'))) found.push(`${root}/${entry}`)
    }
  }
  const known = new Set(PACKAGES.map((pkg) => pkg.path))
  assert.deepEqual(found.filter((path) => !known.has(path)), [], 'путь есть в репозитории, но не в PACKAGES')
  assert.deepEqual(PACKAGES.map((pkg) => pkg.path).filter((path) => !found.includes(path)), [], 'путь есть в PACKAGES, но не в репозитории')
})

test('dependsOn включает каждую workspace-зависимость из package.json', () => {
  const repository = dirname(dirname(fileURLToPath(import.meta.url)))
  assert.doesNotThrow(() => validatePackageDependencies(repository))
})

test('owner contract archive updates select the full consumer gate', () => {
  assert.equal(selectAffected(['vendor/voicechat-make-contracts-1.2.0.tgz']).full, true)
})

test('consumersOf даёт транзитивное замыкание и не тянет пакеты вне workspaces', () => {
  const appShell = consumersOf('shared')
  for (const id of ['server', 'automation-runner']) assert.ok(appShell.has(id))
  for (const id of ['ui', 'web']) assert.equal(appShell.has(id), false)
  assert.equal(appShell.has('desktop'), false)
  assert.equal(consumersOf('shared').has('agent-tray'), false)
})

test('e2e, frontend-quality и настройки агентов не включают полный гейт', () => {
  for (const file of ['e2e/projects.e2e.test.ts', 'frontend-quality/bundle-baseline.json', '.claude/settings.json']) {
    const decision = selectAffected([file])
    assert.equal(decision.full, false, `${file} не должен звать полный гейт`)
    assert.deepEqual(ids(decision), [], file)
  }
})

test('parseOptions разбирает базу диффа, режим и jobs', () => {
  assert.deepEqual(parseOptions([]), { jobs: 2, base: 'origin/main', fast: false })
  assert.deepEqual(parseOptions(['--fast', '--worktree']), { jobs: 2, base: 'HEAD', fast: true })
  assert.deepEqual(parseOptions(['--base', 'origin/release/1.2.0', '--jobs', '4']), { jobs: 4, base: 'origin/release/1.2.0', fast: false })
  assert.throws(() => parseOptions(['--base']), /--base требует git-ref/)
  assert.throws(() => parseOptions(['--base', '--fast']), /--base требует git-ref/)
  assert.throws(() => parseOptions(['--base', 'main', '--worktree']), /взаимно исключают/)
  assert.throws(() => parseOptions(['--jobs', '0']), /положительным целым/)
})

test('workersPerJob делит пул и не опускается ниже одного воркера', () => {
  assert.equal(workersPerJob(1), undefined)
  assert.equal(workersPerJob(2, 8), 4)
  assert.equal(workersPerJob(4, 8), 2)
  assert.equal(workersPerJob(16, 8), 1)
})

test('artifact updates retain frontend integration without building extracted sources', () => {
  assert.deepEqual(buildGates(['vendor/sislexa-core-ui-1.0.0.tgz'], { fast: true }), ['frontend:build-gates'])
  assert.deepEqual(buildGates(['apps/server/src/server.ts'], { fast: false }), [])
  assert.deepEqual(buildGates(['packages/ui/src/App.tsx'], { fast: false }), ['frontend:build-gates'])
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
  // Раньше здесь стояла жёсткая единица, и `packages/ui` в параллельном режиме
  // шёл 108 с вместо 42 с. Теперь пул делится между заданиями.
  assert.ok(parallelTests.every((event) => event.maxWorkers === workersPerJob(2)))
  assert.ok(workersPerJob(2) > 1)
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

test('dependenciesOf даёт транзитивные зависимости пакета', () => {
  assert.ok(dependenciesOf('server').has('shared'))
  assert.equal(dependenciesOf('server').has('ui'), false)
})

test('fastPlanForPackage гоняет related и по правкам зависимостей, а не только своим', () => {
  const byId = new Map(PACKAGES.map((pkg) => [pkg.id, pkg]))
  const plan = (id, files) => fastPlanForPackage(byId.get(id), files)

  assert.deepEqual(plan('server', ['apps/server/src/routes/rest.ts']).files, ['src/routes/rest.ts'])

  // Пакет, до которого правка не доходит, не проверяется вовсе.
  assert.deepEqual(plan('server', ['packages/ui/src/App.tsx']), {
    pkg: byId.get('server'),
    files: [],
    reason: 'изменений в этом пакете и его зависимостях нет'
  })

  // Контракт shared и конфиги/схемы/миграции любого источника — полный набор.
  assert.equal(plan('server', ['packages/shared/src/protocol.ts']).reason, 'shared-контракт')
  assert.match(plan('server', ['apps/server/src/db/migrations/001.sql']).reason, /^конфиг, схема или миграция/)
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
  "rev-parse HEAD") echo abcdef123456abcdef123456abcdef123456abcdef ;;
  "rev-parse --short HEAD") echo abcdef1 ;;
  "log -1 --pretty=%s") echo "release test" ;;
esac
`)
    // macOS не поставляет GNU setsid; заглушки сохраняют границу exec/env,
    // которую проверяет тест, не привязывая suite к платформе CI.
    mkdirSync(join(tempRoot, 'apps/server'), { recursive: true })
    writeFileSync(join(tempRoot, 'apps/server/release.json'), JSON.stringify({ apiVersion: '1.1.0', dataVersion: '1.0.0' }))
    executable('setsid', `exec "$@"`)
    executable('nohup', `exec "$@"`)
    executable('flock', `exit 0`)
    executable('docker', `printf '%s|%s|%s' "$VC_RELEASE_VERSION" "$VC_RELEASE_VERSION_SOURCE" "$VC_RELEASE_COMMIT" >"$DEPLOY_TEST_MARKER"; printf '%s|%s|%s|%s' "$VC_APPLICATION_VERSION" "$VC_APPLICATION_API_VERSION" "$VC_APPLICATION_DATA_VERSION" "$VC_APPLICATION_COMMIT" >"$DEPLOY_TEST_MARKER.application"`)
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

    let metadata = '', applicationMetadata = ''
    // The detached child writes the two files sequentially. Observing the first
    // one does not mean the second has been created yet.
    for (let attempt = 0; attempt < 500 && (!metadata || !applicationMetadata); attempt += 1) {
      await delay(20)
      try { metadata = readFileSync(marker, 'utf8') } catch {}
      try { applicationMetadata = readFileSync(marker + '.application', 'utf8') } catch {}
    }
    assert.equal(metadata, '0.1.42|protected-release|abcdef123456')
    assert.equal(applicationMetadata, '0.1.42|1.1.0|1.0.0|abcdef123456abcdef123456abcdef123456abcdef')
    assert.match(readFileSync(log, 'utf8'), /version=0\.1\.42 .*source=protected-release/)
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('production deploy безопасно мигрирует постоянный серверный том до compose up', async (t) => {
  const repository = dirname(dirname(fileURLToPath(import.meta.url)))

  const runScenario = ({ target = [], legacy = {}, fail = '' }) => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'voicechat-volume-test-'))
    const commandsDirectory = join(tempRoot, 'commands')
    const volumesRoot = join(tempRoot, 'volumes')
    const calls = join(tempRoot, 'docker-calls')
    mkdirSync(commandsDirectory)
    mkdirSync(volumesRoot)
    mkdirSync(join(tempRoot, 'apps/server'), { recursive: true })
    writeFileSync(join(tempRoot, 'apps/server/release.json'), JSON.stringify({ apiVersion: '1.1.0', dataVersion: '1.0.0' }))

    const putVolume = (name, files) => {
      const directory = join(volumesRoot, name)
      mkdirSync(directory, { recursive: true })
      for (const [file, contents] of Object.entries(files)) {
        writeFileSync(join(directory, file), contents)
      }
    }
    putVolume('voicechat-server-data', Object.fromEntries(target.map(([name, value]) => [name, value])))
    for (const [name, files] of Object.entries(legacy)) putVolume(name, Object.fromEntries(files))

    const executable = (name, body) => {
      const path = join(commandsDirectory, name)
      writeFileSync(path, `#!/bin/bash
set -eu
${body}
`)
      chmodSync(path, 0o755)
    }
    executable('git', `
case "$*" in
  "rev-parse --short=12 HEAD") echo abcdef123456 ;;
  "rev-parse HEAD") echo abcdef123456abcdef123456abcdef123456abcdef ;;
  "rev-parse --short HEAD") echo abcdef1 ;;
  "log -1 --pretty=%s") echo "volume migration test" ;;
esac
`)
    executable('flock', 'exit 0')
    executable('curl', `printf '%s\\n' '{"ok":true}'`)
    executable('docker', `
printf '%s\\n' "$*" >>"$DOCKER_CALLS"
if [[ \${1:-} == volume && \${2:-} == create ]]; then
  mkdir -p "$VOLUMES_ROOT/\${3}"
  exit 0
fi
if [[ \${1:-} == volume && \${2:-} == ls ]]; then
  printf '%s\\n' \${LEGACY_VOLUMES:-}
  exit 0
fi
if [[ \${1:-} == compose ]]; then exit 0; fi
mounts=()
previous=
for argument in "$@"; do
  if [[ $previous == -v ]]; then mounts+=("$argument"); fi
  previous=$argument
done
data=
source=
target=
backup=
for mount in "\${mounts[@]}"; do
  volume=\${mount%%:*}
  path=\${mount#*:}; path=\${path%%:*}
  case "$path" in
    /data) data=$volume ;;
    /source) source=$volume ;;
    /target) target=$volume ;;
    /backup) backup=$volume ;;
  esac
done
if [[ -n $data && "$*" == *python3* ]]; then
  [[ -f "$VOLUMES_ROOT/$data/voicechat.db" &&
     -s "$VOLUMES_ROOT/$data/voicechat.db" &&
     -f "$VOLUMES_ROOT/$data/session.secret" &&
     -s "$VOLUMES_ROOT/$data/session.secret" &&
     "$(IFS= read -r line <"$VOLUMES_ROOT/$data/voicechat.db"; printf %s "$line")" == valid-db ]]
  exit
fi
if [[ -n $data ]]; then
  [[ -n "$(find "$VOLUMES_ROOT/$data" -mindepth 1 -maxdepth 1 -print -quit)" ]]
  exit
fi
if [[ -n $backup ]]; then
  if [[ "\${MIGRATION_FAIL:-}" == backup ]]; then exit 42; fi
  mkdir -p "$VOLUMES_ROOT/$backup/snapshot"
  cp -R "$VOLUMES_ROOT/$source/." "$VOLUMES_ROOT/$backup/snapshot/"
  exit
fi
if [[ -n $target ]]; then
  if [[ "\${MIGRATION_FAIL:-}" == copy ]]; then exit 43; fi
  cp -R "$VOLUMES_ROOT/$source/." "$VOLUMES_ROOT/$target/"
  exit
fi
exit 2
`)

    const result = spawnSync('bash', [join(repository, 'scripts/prod/deploy.sh')], {
      cwd: tempRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${commandsDirectory}:${process.env.PATH}`,
        VC_DEPLOY_CHILD: '1',
        VC_REPO_DIR: tempRoot,
        VC_DEPLOY_LOCK: join(tempRoot, 'deploy.lock'),
        VC_HEALTH_TRIES: '1',
        VOLUMES_ROOT: volumesRoot,
        DOCKER_CALLS: calls,
        LEGACY_VOLUMES: Object.keys(legacy).join(' '),
        MIGRATION_FAIL: fail
      }
    })
    return {
      result,
      calls: readFileSync(calls, 'utf8'),
      read: (volume, file) => readFileSync(join(volumesRoot, volume, file), 'utf8'),
      cleanup: () => rmSync(tempRoot, { recursive: true, force: true })
    }
  }

  await t.test('единственный корректный legacy-том копируется после backup и повторно не заменяется', () => {
    const scenario = runScenario({
      legacy: { 'old_project_vc-data': [['voicechat.db', 'valid-db'], ['session.secret', 'secret']] }
    })
    try {
      assert.equal(scenario.result.status, 0, scenario.result.stderr)
      assert.equal(scenario.read('voicechat-server-data', 'session.secret'), 'secret')
      const backupAt = scenario.calls.indexOf('/backup')
      const copyAt = scenario.calls.indexOf('/target')
      const upAt = scenario.calls.indexOf('compose up -d --build')
      assert.ok(backupAt >= 0 && backupAt < copyAt && copyAt < upAt, scenario.calls)
    } finally { scenario.cleanup() }

    const repeat = runScenario({
      target: [['voicechat.db', 'valid-db'], ['session.secret', 'current']],
      legacy: { 'old_project_vc-data': [['voicechat.db', 'valid-db'], ['session.secret', 'old']] }
    })
    try {
      assert.equal(repeat.result.status, 0, repeat.result.stderr)
      assert.equal(repeat.read('voicechat-server-data', 'session.secret'), 'current')
      assert.doesNotMatch(repeat.calls, /\/target/)
    } finally { repeat.cleanup() }
  })

  await t.test('чистая установка и пустой legacy не блокируют compose', () => {
    const scenario = runScenario({ legacy: { 'old_project_vc-data': [] } })
    try {
      assert.equal(scenario.result.status, 0, scenario.result.stderr)
      assert.match(scenario.calls, /compose up -d --build/)
      assert.doesNotMatch(scenario.calls, /\/backup|\/target/)
    } finally { scenario.cleanup() }
  })

  for (const [name, options] of [
    ['повреждённая БД', { legacy: { old: [['voicechat.db', 'broken'], ['session.secret', 'secret']] } }],
    ['отсутствующий secret', { legacy: { old: [['voicechat.db', 'valid-db']] } }],
    ['пустой secret', { legacy: { old: [['voicechat.db', 'valid-db'], ['session.secret', '']] } }],
    ['частичный постоянный том', { target: [['voicechat.db', 'valid-db']] }],
    ['несколько legacy-томов', {
      legacy: {
        old_a: [['voicechat.db', 'valid-db'], ['session.secret', 'a']],
        old_b: [['voicechat.db', 'valid-db'], ['session.secret', 'b']]
      }
    }],
    ['ошибка backup', {
      legacy: { old: [['voicechat.db', 'valid-db'], ['session.secret', 'secret']] },
      fail: 'backup'
    }],
    ['ошибка копирования', {
      legacy: { old: [['voicechat.db', 'valid-db'], ['session.secret', 'secret']] },
      fail: 'copy'
    }]
  ]) {
    await t.test(name + ' останавливает deploy до compose up', () => {
      const scenario = runScenario(options)
      try {
        assert.notEqual(scenario.result.status, 0)
        assert.doesNotMatch(scenario.calls, /compose up -d --build/)
      } finally { scenario.cleanup() }
    })
  }
})

test('production compose закрепляет каноническое имя server data volume', () => {
  const repository = dirname(dirname(fileURLToPath(import.meta.url)))
  const compose = readFileSync(join(repository, 'docker-compose.yml'), 'utf8')
  assert.match(compose, /vc-data:\n {4}name: voicechat-server-data/)
  assert.match(compose, /- vc-data:\/data/)
  assert.match(compose, /- vc-data:\/mnt\/server-data:ro/)
})

test('source recovery v2 uses real detached processes and the Core/UI kernel lock', async (t) => {
  const launcher = fileURLToPath(new URL('./prod/deploy.sh', import.meta.url))
  const hash = value => createHash('sha256').update(value).digest('hex')
  const previous = 'b'.repeat(40), target = 'a'.repeat(40)
  const previousImage = 'sha256:' + 'b'.repeat(64), targetImage = 'sha256:' + 'a'.repeat(64)
  async function scenario(options, check) {
    const base = process.env.DELIVERY_ATTEMPT_ROOT ? join(process.env.DELIVERY_ATTEMPT_ROOT, 'tmp') : homedir()
    const root = realpathSync(mkdtempSync(join(base, '.source-recovery-')))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    chmodSync(root, 0o700)
    const bin = join(root, 'bin'), state = join(root, 'operations')
    mkdirSync(bin); mkdirSync(state, { mode: 0o700 })
    const put = (name, value) => writeFileSync(join(root, name), value, { mode: 0o600 })
    put('active', 'previous'); put('options.json', JSON.stringify(options))
    const fixture = join(root, 'fixture.py')
    writeFileSync(fixture, `import hashlib,json,os,pathlib,signal,sys,time
r=pathlib.Path(${JSON.stringify(root)})
options=json.loads((r/'options.json').read_text())
args=sys.argv[1:]; kind=args.pop(0)
def emit(v): print(json.dumps(v))
if kind=='verify':
 lease=json.load(sys.stdin)
 emit({'valid':not (r/'revoked').exists() and not (options.get('rejectStatus') and lease['action']=='status'),'epoch':lease['epoch'],'leaseId':lease['leaseId']});sys.exit()
active=(r/'active').read_text()
if kind=='curl':
 if args[-1].endswith('/ui/runtime.json'): emit({'generation':2 if (r/'changed-ui').exists() else 1});sys.exit()
 commit=${JSON.stringify(previous)} if active=='previous' else ${JSON.stringify(target)}
 emit({'ok':not(options.get('healthFailure') and active=='target'),'application':{'applicationId':'core','commit':commit}});sys.exit()
with (r/'calls').open('a') as out: out.write(' '.join(args)+'\\n')
def image(which): return ${JSON.stringify(previousImage)} if which=='previous' else ${JSON.stringify(targetImage)}
def container(service):
 return {'Id':service+'-id','Image':image(active) if service=='voicechat' else 'unchanged','Config':{'Labels':{'com.docker.compose.service':service,'com.docker.compose.config-hash':hashlib.sha256((r/(active+'.json')).read_bytes()).hexdigest()}},'State':{'StartedAt':'fixed'}}
if args[:2]==['image','inspect']:
 which='previous' if args[2]==image('previous') else 'target'
 if (r/'missing').exists() and which=='previous': sys.exit(1)
 declared={'/data':{}} if options.get('namedVolume') else ({'/unbound':{}} if options.get('unboundImageVolume') and which=='target' else {})
 emit([{'Id':image(which),'Config':{'Labels':{'org.opencontainers.image.revision':${JSON.stringify(previous)} if which=='previous' else ${JSON.stringify(target)}},'Volumes':declared}}]);sys.exit()
if args[:2]==['volume','inspect']: emit([{'Name':args[2]}]);sys.exit()
if args[0]=='inspect': emit([container(x.replace('-id','')) for x in args[1:]]);sys.exit()
assert args[0]=='compose'
which=pathlib.Path(args[4]).stem
tail=args[5:]
if tail==['config','--hash','voicechat']: print('voicechat '+hashlib.sha256((r/(which+'.json')).read_bytes()).hexdigest());sys.exit()
if tail[:1]==['config']: print((r/(which+'.json')).read_text());sys.exit()
if tail==['ps','-aq']: print('voicechat-id dependency-id');sys.exit()
if tail==['ps','-q','voicechat']: print('voicechat-id');sys.exit()
if tail[:1]==['exec']: sys.exit(0)
assert tail==['up','-d','--no-build','--pull','never','--no-deps','voicechat']
(r/'active').write_text(which)
if options.get('liveChild') and which=='target':
 (r/'live').write_text(str(os.getpid()))
 if options.get('killOwner'): os.kill(os.getppid(),signal.SIGKILL)
 deadline=time.time()+15
 while not (r/'release').exists() and time.time()<deadline: time.sleep(.02)
 (r/'child-ended').touch()
if options.get('revokeAfterEffect') or (options.get('revokeRecovery') and which=='previous'): (r/'revoked').touch()
sys.exit(23 if (which=='target' and options.get('composeFailure')) or (which=='previous' and options.get('rollbackFailure')) else 0)
`)
    const python = spawnSync('python3', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' })
    assert.equal(python.status, 0, python.error?.message || python.stderr)
    for (const name of ['docker', 'curl']) {
      writeFileSync(join(bin, name), `#!/bin/sh\nexec '${python.stdout.trim()}' '${fixture}' '${name}' "$@"\n`, { mode: 0o755 })
    }
    const spec = (name, image) => {
      const configuration = { services: { voicechat: { image }, dependency: { image: 'unchanged' } } }
      if (options.anonymousVolume) configuration.services.voicechat.volumes = [{ type: 'volume', target: '/data' }]
      if (options.namedVolume) {
        configuration.services.voicechat.volumes = [{ type: 'volume', source: 'data', target: '/data' }]
        configuration.volumes = { data: { name: 'existing-fixture-data' } }
      }
      const value = JSON.stringify(configuration)
      put(name + '.json', value)
      return { path: join(root, name + '.json'), sha256: hash(value), image, validationSha256: 'c'.repeat(64) }
    }
    const operation = { id: 'one', runId: 'fixture', environment: 'staging', releaseSetId: 'candidate', manifestHash: 'c'.repeat(64),
      expectedCommit: target, expectedPreviousCommit: previous, project: process.env.COMPOSE_PROJECT_NAME || 'source-fixture',
      previous: spec('previous', previousImage), target: spec('target', targetImage), compositionFiles: [],
      healthUrl: `http://127.0.0.1:${process.env.DELIVERY_PORTS?.match(/\d+/)?.[0] || '23000'}/api/health` }
    const env = { ...process.env, PATH: bin + ':' + process.env.PATH, VC_REPO_DIR: root, VC_DEPLOY_OPERATIONS: state, VC_DEPLOY_LOCK: join(root, 'lock'), VC_DEPLOY_LOG: join(root, 'log'), TMPDIR: root }
    const request = (action, epoch, change = {}) => {
      const path = join(root, action + '-' + epoch + '-' + Math.random().toString(16).slice(2) + '.json')
      writeFileSync(path, JSON.stringify({ schemaVersion: 2, operation: { ...operation, ...change },
        lease: { id: 'one', runId: 'fixture', environment: 'staging', releaseSetId: 'candidate', manifestHash: 'c'.repeat(64), epoch, leaseId: 'lease-' + epoch, expiresAt: Date.now() + 60000, action },
        verifyLeaseCommand: [python.stdout.trim(), fixture, 'verify'], environment: {} }), { mode: 0o600 })
      return path
    }
    const run = path => spawnSync('bash', [launcher, '--source-request', path], { env, encoding: 'utf8', timeout: 5000 })
    const record = () => JSON.parse(readFileSync(join(state, 'one.json'), 'utf8'))
    const wait = async predicate => {
      for (let i = 0; i < 500; i++) { if (predicate()) return; await delay(20) }
      assert.fail('fixture did not finish: ' + (existsSync(join(root, 'log')) ? readFileSync(join(root, 'log'), 'utf8') : 'no log'))
    }
    const calls = () => existsSync(join(root, 'calls')) ? readFileSync(join(root, 'calls'), 'utf8') : ''
    const ups = () => calls().split('\n').filter(x => x.includes(' up '))
    try {
      const deploy = request('deploy', 1)
      const start = run(deploy)
      assert.equal(start.status, 0, start.error?.message || start.stderr)
      if (options.liveChild) await wait(() => existsSync(join(root, 'live')))
      else await wait(() => record().finishedAction === 'deploy')
      await check({ root, put, request, run, record, wait, calls, ups, deploy })
    } finally {
      put('release', '')
      if (options.liveChild) await wait(() => existsSync(join(root, 'child-ended')))
      // Ensure the last inherited lock holder has exited before removing fixtures.
      let lockReleased = false
      for (let i = 0; i < 100; i++) {
        const free = spawnSync(python.stdout.trim(), ['-c', 'import fcntl,sys; f=open(sys.argv[1],"a"); fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)', join(root, 'lock')])
        if (free.status === 0) { lockReleased = true; break }
        await delay(20)
      }
      assert.equal(lockReleased, true, 'fixture cleanup must not hide a live inherited lock holder')
      rmSync(root, { recursive: true, force: true })
    }
  }
  await t.test('exact successful source deployment is idempotent', () => scenario({}, f => {
    assert.equal(f.record().state, 'succeeded')
    assert.equal(f.run(f.deploy).status, 0)
    assert.equal(f.ups().length, 1)
  }))
  await t.test('live-authorized status preserves the same lease and immutable effect fence', () => scenario({}, f => {
    const before = f.record(), calls = f.calls()
    for (const epoch of [1, 2]) {
      const result = f.run(f.request('status', epoch))
      assert.equal(result.status, 0, result.stderr)
      assert.deepEqual(JSON.parse(result.stdout), before)
      assert.deepEqual(f.record(), before)
      assert.equal(f.calls(), calls)
    }
    const wrongLease = f.request('status', 1)
    const envelope = JSON.parse(readFileSync(wrongLease, 'utf8'))
    envelope.lease.leaseId = 'different-live-lease'
    writeFileSync(wrongLease, JSON.stringify(envelope))
    assert.notEqual(f.run(wrongLease).status, 0)
    assert.notEqual(f.run(f.request('status', 1, { expectedCommit: previous })).status, 0)
    assert.deepEqual(f.record(), before)
    assert.equal(f.calls(), calls)
    // A higher-epoch read did not supersede the original idempotent deploy lease.
    assert.equal(f.run(f.deploy).status, 0)
    assert.equal(f.calls(), calls)
    f.put('revoked', '')
    assert.notEqual(f.run(f.request('status', 1)).status, 0)
    assert.deepEqual(f.record(), before)
  }))
  await t.test('status needs independent action authorization even with the exact effect lease', () => scenario({ rejectStatus: true }, f => {
    const before = f.record(), calls = f.calls()
    assert.notEqual(f.run(f.request('status', 1)).status, 0)
    assert.deepEqual(f.record(), before)
    assert.equal(f.calls(), calls)
  }))
  await t.test('existing named volume covers image-declared storage without creating a volume', () => scenario({ namedVolume: true }, f => {
    assert.equal(f.record().state, 'succeeded')
    assert.equal(f.ups().length, 1)
    assert.match(f.calls(), /volume inspect existing-fixture-data/)
    assert.doesNotMatch(f.calls(), /volume create/)
  }))
  for (const storage of [{ anonymousVolume: true }, { unboundImageVolume: true }]) {
    await t.test('unpinned storage blocks before any replacement: ' + JSON.stringify(storage), () => scenario(storage, f => {
      assert.equal(f.record().state, 'uncertain')
      assert.equal(f.record().outcomes.deploy.exitCode, 1)
      assert.equal(f.ups().length, 0)
      assert.equal(f.record().prepared, undefined)
    }))
  }
  for (const failure of [{ composeFailure: true }, { healthFailure: true }]) {
    await t.test('known terminal failure recovers exact previous source: ' + JSON.stringify(failure), () => scenario(failure, async f => {
      assert.equal(f.record().state, 'uncertain'); assert.equal(f.record().deploymentCompleted, true)
      assert.equal(f.record().outcomes.deploy.exitCode, 1)
      assert.ok(f.record().commands.every(x => x.completed))
      const recover = f.request('recover', 2)
      assert.equal(f.run(recover).status, 0)
      await f.wait(() => f.record().finishedAction === 'recover')
      assert.equal(f.record().state, 'recovered'); assert.equal(f.ups().length, 2)
      assert.equal(f.record().outcomes.deploy.exitCode, 1)
      assert.equal(f.record().outcomes.recover.exitCode, 2)
      // Discarded launch reply and repeated/renewed requests reconcile the same record.
      assert.equal(f.run(recover).status, 0)
      assert.equal(f.run(f.request('recover', 3)).status, 0)
      assert.equal(f.ups().length, 2)
      assert.notEqual(f.run(f.request('recover', 4, { expectedCommit: previous })).status, 0)
      assert.equal(f.ups().length, 2)
    }))
  }
  await t.test('observation only cannot turn a failed candidate into recovery', () => scenario({ composeFailure: true }, f => {
    assert.notEqual(f.run(f.request('reconcile', 2)).status, 0)
    assert.equal(f.ups().length, 1); assert.equal(f.record().state, 'uncertain')
  }))
  await t.test('stale and revoked recovery authority have no effects', () => scenario({ composeFailure: true }, f => {
    assert.notEqual(f.run(f.request('recover', 1)).status, 0)
    const expired = f.request('recover', 2)
    const envelope = JSON.parse(readFileSync(expired, 'utf8'))
    envelope.lease.expiresAt = Date.now() - 1
    writeFileSync(expired, JSON.stringify(envelope))
    assert.notEqual(f.run(expired).status, 0)
    f.put('revoked', '')
    assert.notEqual(f.run(f.request('recover', 2)).status, 0)
    assert.equal(f.ups().length, 1); assert.equal(f.record().state, 'uncertain')
  }))
  await t.test('lost terminal observation reconciles completed recovery without effects', () => scenario({ composeFailure: true, revokeRecovery: true }, async f => {
    assert.equal(f.run(f.request('recover', 2)).status, 0)
    await f.wait(() => f.record().finishedAction === 'recover')
    assert.equal(f.record().state, 'uncertain'); assert.equal(f.record().recoveryCompleted, true)
    assert.notEqual(f.run(f.request('reconcile', 3)).status, 0)
    rmSync(join(f.root, 'revoked'))
    assert.equal(f.run(f.request('reconcile', 3)).status, 2)
    assert.equal(f.record().state, 'recovered'); assert.equal(f.ups().length, 2)
  }))
  await t.test('changed artifact bytes cannot be used for recovery', () => scenario({ composeFailure: true }, async f => {
    f.put('previous.json', '{}')
    assert.equal(f.run(f.request('recover', 2)).status, 0)
    await f.wait(() => f.record().finishedAction === 'recover')
    assert.equal(f.record().state, 'uncertain'); assert.equal(f.ups().length, 1)
  }))
  for (const marker of ['missing', 'changed-ui']) {
    await t.test('missing artifact or changed composition retains barrier: ' + marker, () => scenario({ composeFailure: true }, async f => {
      f.put(marker, '')
      assert.equal(f.run(f.request('recover', 2)).status, 0)
      await f.wait(() => f.record().finishedAction === 'recover')
      assert.equal(f.record().state, 'uncertain'); assert.equal(f.ups().length, 1)
    }))
  }
  await t.test('rollback failure is durable and never retries the effect', () => scenario({ composeFailure: true, rollbackFailure: true }, async f => {
    const recovery = f.request('recover', 2)
    assert.equal(f.run(recovery).status, 0)
    await f.wait(() => f.record().finishedAction === 'recover')
    assert.equal(f.record().state, 'uncertain')
    assert.equal(f.record().commands.at(-1).exitCode, 23)
    assert.equal(f.run(recovery).status, 0)
    assert.notEqual(f.run(f.request('reconcile', 3)).status, 0)
    assert.equal(f.ups().length, 2)
  }))
  for (const killOwner of [false, true]) {
    await t.test('live child excludes owner and legacy flock; unknown completion stays blocked: ' + killOwner, () => scenario({ liveChild: true, killOwner, composeFailure: true }, async f => {
      assert.notEqual(f.run(f.request('recover', 2)).status, 0)
      if (process.platform === 'linux') {
        const contender = spawnSync('flock', ['-n', join(f.root, 'lock'), 'true'])
        assert.equal(contender.status, 1)
      }
      f.put('release', '')
      await f.wait(() => existsSync(join(f.root, 'child-ended')))
      if (killOwner) {
        await delay(100)
        assert.notEqual(f.run(f.request('recover', 2)).status, 0)
        assert.notEqual(f.run(f.request('reconcile', 3)).status, 0)
        assert.ok(f.record().commands.some(x => !x.completed))
      } else await f.wait(() => f.record().finishedAction === 'deploy')
      assert.equal(f.ups().length, 1)
    }))
  }
})

test('controlled deployment pins a commit, persists detached completion and never repeats an uncertain effect', async (t) => {
  const launcher = join(dirname(dirname(fileURLToPath(import.meta.url))), 'scripts/prod/deploy.sh')
  const head = 'a'.repeat(40), previous = 'b'.repeat(40)
  async function scenario({ actual = head, failCompose = false, wrongHealth = false, busy = false, killChild = false, dirty = false, statusFailure = false, fence = false, expectedPrevious = previous, rejectChild = false, revokeAfterDocker = false, changeEnvelope = false } = {}, check) {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'controlled-deploy-')))
    const bin = join(root, 'bin'), state = join(root, 'operations'), calls = join(root, 'calls')
    mkdirSync(bin); mkdirSync(state, { mode: 0o700 }); mkdirSync(join(root, 'apps/server'), { recursive: true })
    writeFileSync(join(root, 'apps/server/release.json'), JSON.stringify({ apiVersion: '1.0.0', dataVersion: '1.0.0' }))
    const executable = (name, body) => { const path = join(bin, name); writeFileSync(path, '#!/bin/bash\nset -eu\n' + body); chmodSync(path, 0o755) }
    executable('setsid', 'exec "$@"'); executable('nohup', 'exec "$@"')
    executable('flock', busy ? 'exit 1' : 'exit 0')
    executable('sleep', 'exit 0')
    executable('git', `case "$*" in
      'status --porcelain --untracked-files=all') ${statusFailure ? 'exit 1' : dirty ? "echo '?? injected-source.js'" : 'exit 0'};;
      'rev-parse HEAD') echo ${actual};;
      'rev-parse --short HEAD'|'rev-parse --short=12 HEAD') echo ${actual.slice(0, 12)};;
    esac`)
    executable('curl', `if test -f "$FIXTURE_ROOT/up"; then commit=${wrongHealth ? previous : head}; else commit=${previous}; fi
      printf '{"ok":true,"application":{"applicationId":"core","commit":"%s"}}' "$commit"`)
    executable('docker', `printf '%s\n' "$*" >>"$FIXTURE_ROOT/calls"
      if [[ "$*" == 'compose up -d --build' ]]; then touch "$FIXTURE_ROOT/up"; ${killChild ? 'kill -9 "$PPID"; touch "$FIXTURE_ROOT/killed";' : ''} exit ${failCompose ? 1 : 0}; fi
      exit 0`)
    const env = { ...process.env, PATH: bin + ':' + process.env.PATH, VC_REPO_DIR: root,
      VC_DEPLOY_OPERATIONS: state, VC_DEPLOY_LOG: join(root, 'log'), VC_DEPLOY_LOCK: join(root, 'lock'),
      VC_RELEASE_VERSION: '0.1.77', VC_RELEASE_VERSION_SOURCE: 'protected-release', VC_HEALTH_TRIES: '1', FIXTURE_ROOT: root }
    delete env.VC_DEPLOY_CHILD
    // The operator envelope is outside the candidate checkout, with protected
    // ancestors. A conventional /tmp ancestor is intentionally not accepted.
    const protectedRoot = fence ? realpathSync(mkdtempSync(join(process.env.DELIVERY_ATTEMPT_ROOT ? join(process.env.DELIVERY_ATTEMPT_ROOT, 'tmp') : homedir(), '.delivery-fence-test-'))) : null
    const fencePath = protectedRoot && join(protectedRoot, 'fence.json')
    const verifier = join(root, 'verifier.cjs')
    if (fence) {
      chmodSync(protectedRoot, 0o700)
      writeFileSync(verifier, `const fs=require('node:fs'),path=require('node:path');let input='';process.stdin.on('data',x=>input+=x);process.stdin.on('end',()=>{
        const lease=JSON.parse(input),root=process.argv[2],countFile=path.join(root,'verifications');
        let n=fs.existsSync(countFile)?Number(fs.readFileSync(countFile,'utf8')):0;fs.writeFileSync(countFile,String(++n));
        fs.appendFileSync(path.join(root,'calls'),'verify '+n+'\\n');
        if (${changeEnvelope} && n===2) fs.appendFileSync(process.argv[3],' ');
        const rejected=(${rejectChild}&&n>=2)||(${revokeAfterDocker}&&fs.readFileSync(path.join(root,'calls'),'utf8').includes('volume create'));
        console.log(JSON.stringify(rejected?{valid:false}:{valid:true,epoch:lease.epoch,leaseId:lease.leaseId}));
      });`)
      writeFileSync(fencePath, JSON.stringify({ schemaVersion: 1, expectedCommit: head, expectedPreviousCommit: expectedPrevious,
        lease: { id: 'one', epoch: 1, leaseId: 'fixture-lease', expiresAt: Date.now() + 60000, action: 'deploy', runId: 'fixture', environment: 'staging', releaseSetId: 'candidate', manifestHash: 'c'.repeat(64) },
        verifyLeaseCommand: [process.execPath, verifier, root, fencePath], environment: {} }), { mode: 0o600 })
    }
    const run = (...args) => spawnSync('bash', [launcher, ...args], { env, encoding: 'utf8', timeout: 10000 })
    const start = run('--operation-id', 'one', '--expected-commit', head, ...(fence ? ['--delivery-fence', fencePath] : []))
    assert.equal(start.status, 0, start.stderr)
    assert.equal(JSON.parse(start.stdout).state, 'accepted')
    let record
    for (let n = 0; n < 500; n++) {
      record = JSON.parse(readFileSync(join(state, 'one.json'), 'utf8'))
      if (!['accepted', 'running'].includes(record.state) || existsSync(join(root, 'killed'))) break
      await delay(20)
    }
    try { await check({ root, state, record, run, fencePath, calls: () => existsSync(calls) ? readFileSync(calls, 'utf8') : '' }) }
    finally { rmSync(root, { recursive: true, force: true }); if (protectedRoot) rmSync(protectedRoot, { recursive: true, force: true }) }
  }
  await t.test('success is observed at the exact SHA and an identical request is read-only', () => scenario({}, ({ record, run, calls }) => {
    assert.equal(record.state, 'succeeded'); assert.equal(record.composeCompleted, true)
    assert.equal(record.request.expectedCommit, head); assert.equal(record.previousCommit, previous)
    assert.equal(JSON.parse(run('--status-operation', 'one').stdout).state, 'succeeded')
    assert.equal(run('--operation-id', 'one', '--expected-commit', head).status, 0)
    assert.equal(calls().split('compose up -d --build').length - 1, 1)
    assert.notEqual(run('--operation-id', 'one', '--expected-commit', previous).status, 0)
  }))
  await t.test('a moved checkout fails before Docker', () => scenario({ actual: previous }, ({ record, calls }) => {
    assert.equal(record.state, 'failed'); assert.equal(record.exitCode, 65); assert.equal(calls(), '')
  }))
  for (const options of [{ dirty: true }, { statusFailure: true }]) {
    await t.test('untracked source or unreadable Git status fails before Docker: ' + JSON.stringify(options), () => scenario(options, ({ record, calls }) => {
      assert.equal(record.state, 'failed'); assert.equal(calls(), '')
    }))
  }
  await t.test('host-lock contention is a failed operation, not successful deployment', () => scenario({ busy: true }, ({ record, calls }) => {
    assert.equal(record.state, 'failed'); assert.equal(record.exitCode, 75); assert.equal(calls(), '')
  }))
  await t.test('unknown command completion blocks a new effect and cannot be cleared by healthy observation', () => scenario({ failCompose: true }, ({ record, run, calls }) => {
    assert.equal(record.state, 'uncertain'); assert.equal(record.composeCompleted, undefined)
    assert.notEqual(run('--operation-id', 'two', '--expected-commit', head).status, 0)
    assert.notEqual(run('--reconcile-operation', 'one').status, 0)
    assert.equal(calls().split('compose up -d --build').length - 1, 1)
  }))
  await t.test('SIGKILL leaves durable uncertainty and never launches a replacement', () => scenario({ killChild: true }, ({ record, run, calls }) => {
    assert.equal(record.state, 'running'); assert.equal(record.composeCompleted, undefined)
    assert.notEqual(run('--operation-id', 'two', '--expected-commit', head).status, 0)
    assert.notEqual(run('--reconcile-operation', 'one').status, 0)
    assert.equal(calls().split('compose up -d --build').length - 1, 1)
  }))
  await t.test('wrong healthy runtime remains uncertain until observation proves completed recovery', () => scenario({ wrongHealth: true }, ({ record, run, calls }) => {
    assert.equal(record.state, 'uncertain'); assert.equal(record.composeCompleted, true)
    assert.notEqual(run('--operation-id', 'two', '--expected-commit', head).status, 0)
    const observed = run('--reconcile-operation', 'one')
    assert.equal(observed.status, 0, observed.stderr); assert.equal(JSON.parse(observed.stdout).state, 'recovered')
    assert.equal(calls().split('compose up -d --build').length - 1, 1)
  }))
  await t.test('detached source deployment verifies live authority before every Docker invocation', () => scenario({ fence: true }, ({ record, calls }) => {
    assert.equal(record.state, 'succeeded')
    assert.equal(record.request.delivery.expectedPreviousCommit, previous)
    const lines = calls().trim().split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (/^(volume |run |compose )/.test(lines[i])) assert.match(lines[i - 1], /^verify /)
    }
    assert.ok(lines.includes('compose up -d --build'))
  }))
  await t.test('previous runtime mismatch under the host lock prevents all Docker effects', () => scenario({ fence: true, expectedPrevious: head }, ({ record, calls }) => {
    assert.equal(record.state, 'failed'); assert.equal(record.exitCode, 65)
    assert.doesNotMatch(calls(), /volume |compose |run /)
  }))
  for (const options of [{ rejectChild: true }, { changeEnvelope: true }]) {
    await t.test('authority lost between parent and child prevents deployment: ' + JSON.stringify(options), () => scenario({ fence: true, ...options }, ({ record, calls }) => {
      assert.equal(record.state, 'failed'); assert.doesNotMatch(calls(), /volume |compose |run /)
    }))
  }
  await t.test('revocation after an effect preserves uncertainty and stops subsequent mutations', () => scenario({ fence: true, revokeAfterDocker: true }, ({ record, calls }) => {
    assert.equal(record.state, 'uncertain'); assert.match(calls(), /volume create/)
    assert.doesNotMatch(calls(), /compose up/)
  }))
  await t.test('reconciliation requires renewed live authority and the same immutable transition', () => scenario({ fence: true, wrongHealth: true }, ({ record, run, fencePath }) => {
    assert.equal(record.state, 'uncertain')
    assert.notEqual(run('--reconcile-operation', 'one').status, 0)
    const value = JSON.parse(readFileSync(fencePath, 'utf8'))
    value.lease.action = 'reconcile'; value.lease.epoch++
    writeFileSync(fencePath, JSON.stringify(value))
    const result = run('--reconcile-operation', 'one', '--delivery-fence', fencePath)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(JSON.parse(result.stdout).state, 'recovered')
  }))
})
