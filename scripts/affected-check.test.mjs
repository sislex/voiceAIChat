import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { buildGates, consumersOf, createCommandDiagnostics, dependenciesOf, fastCheckForPackage, fastPlanForPackage, packageArgs, parseOptions, PACKAGES, relatedArgs, runFastChecks, runPackageGates, selectAffected, workersPerJob } from './affected-check.mjs'
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
    assert.deepEqual(ids(decision), ['shared', 'chat-app', 'projects-app', 'operations-app', 'admin-app', 'web-reader', 'playwright-reader', 'ui', 'server', 'runner', 'tts-runner', 'stt-runner', 'automation-runner', 'browser-runner', 'agent', 'web', 'web-recorder'])
  })

  await t.test('ядро сессий тянет сервер и UI как потребителей', () => {
    const decision = selectAffected(['packages/sessions-core/src/policy.ts'])
    assert.equal(decision.full, false)
    assert.deepEqual(ids(decision), ['shared', 'sessions-core', 'sessions-app', 'profile-app', 'chat-app', 'projects-app', 'operations-app', 'admin-app', 'web-reader', 'playwright-reader', 'ui', 'server', 'runner', 'tts-runner', 'stt-runner', 'automation-runner', 'browser-runner', 'agent', 'web', 'web-recorder'])
  })

  await t.test('правка UI проверяет standalone Web Recorder как потребителя', () => {
    const decision = selectAffected(['packages/ui/src/App.tsx'])
    assert.equal(decision.full, false)
    assert.deepEqual(ids(decision), ['ui', 'web', 'web-recorder'])
  })

  for (const file of ['package-lock.json', 'package.json', 'scripts/kb.mjs', '.github/workflows/ci.yml', 'unknown/critical.ts']) {
    await t.test(`${file} включает полный гейт`, () => {
      const decision = selectAffected([file])
      assert.equal(decision.full, true)
      assert.deepEqual(ids(decision), ['shared', 'sessions-core', 'ui-kit', 'app-shell', 'sessions-app', 'profile-app', 'chat-app', 'projects-app', 'operations-app', 'admin-app', 'web-reader', 'playwright-reader', 'ui', 'server', 'runner', 'tts-runner', 'stt-runner', 'automation-runner', 'browser-runner', 'agent', 'web', 'web-recorder'])
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
    assert.deepEqual(ids(decision), ['shared', 'sessions-core', 'ui-kit', 'app-shell', 'sessions-app', 'profile-app', 'chat-app', 'projects-app', 'operations-app', 'admin-app', 'web-reader', 'playwright-reader', 'ui', 'server', 'runner', 'tts-runner', 'stt-runner', 'automation-runner', 'browser-runner', 'agent', 'web', 'web-recorder'])
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
  const idByWorkspace = new Map(PACKAGES.filter((pkg) => pkg.workspace).map((pkg) => [pkg.workspace, pkg.id]))
  const missing = []
  for (const pkg of PACKAGES) {
    const manifest = JSON.parse(readFileSync(join(repository, pkg.path, 'package.json'), 'utf8'))
    const declared = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })
    for (const dependency of declared) {
      const id = idByWorkspace.get(dependency)
      if (!id || pkg.dependsOn.includes(id)) continue
      missing.push(`${pkg.id} -> ${id}`)
    }
  }
  assert.deepEqual(missing, [])
})

test('consumersOf даёт транзитивное замыкание и не тянет пакеты вне workspaces', () => {
  // ui-kit не знает о своих потребителях, но правка токенов ломает и *-app, и ui.
  const uiKit = consumersOf('ui-kit')
  for (const id of ['sessions-app', 'profile-app', 'admin-app', 'ui', 'web']) {
    assert.ok(uiKit.has(id), `${id} должен зависеть от ui-kit`)
  }
  // desktop и agent-tray вне npm-workspaces: корневой install их не ставит,
  // поэтому чужая правка UI не должна звать их гейт.
  assert.equal(uiKit.has('desktop'), false)
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

test('buildGates в fast-режиме адресны, в полном — прежние', () => {
  assert.deepEqual(buildGates(['packages/ui/src/App.tsx'], { fast: false }), ['frontend:build-gates'])
  assert.deepEqual(buildGates(['apps/server/src/server.ts'], { fast: false }), [])
  // Правка компонента не требует ни web-сборки, ни витрины: импорты ловит
  // typecheck, сториз — stories.a11y.dom.test.tsx через related.
  assert.deepEqual(buildGates(['packages/ui/src/App.tsx'], { fast: true }), [])
  assert.deepEqual(buildGates(['apps/web/src/main.tsx'], { fast: true }), ['build:web'])
  assert.deepEqual(buildGates(['packages/ui/src/components/Badge.stories.tsx'], { fast: true }), ['build:storybook'])
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
  assert.equal(dependenciesOf('ui-kit').size, 0)
  const ui = dependenciesOf('ui')
  for (const id of ['ui-kit', 'shared', 'sessions-core', 'chat-app', 'admin-app', 'profile-app']) {
    assert.ok(ui.has(id), `ui должен зависеть от ${id}`)
  }
  assert.equal(ui.has('web'), false)
})

test('fastPlanForPackage гоняет related и по правкам зависимостей, а не только своим', () => {
  const byId = new Map(PACKAGES.map((pkg) => [pkg.id, pkg]))
  const plan = (id, files) => fastPlanForPackage(byId.get(id), files)

  // Правка компонента ui: потребители проверяются related по исходнику ui,
  // а не полным набором — раньше это стоило целого прогона пакета.
  assert.deepEqual(plan('ui', ['packages/ui/src/components/ChatColumn.tsx']).files, ['src/components/ChatColumn.tsx'])
  assert.deepEqual(plan('web', ['packages/ui/src/components/ChatColumn.tsx']).files, ['../../packages/ui/src/components/ChatColumn.tsx'])
  assert.deepEqual(plan('ui', ['packages/ui-kit/src/Button.tsx']).files, ['../ui-kit/src/Button.tsx'])

  // Пакет, до которого правка не доходит, не проверяется вовсе.
  assert.deepEqual(plan('server', ['packages/ui/src/App.tsx']), {
    pkg: byId.get('server'),
    files: [],
    reason: 'изменений в этом пакете и его зависимостях нет'
  })

  // Контракт shared и конфиги/схемы/миграции любого источника — полный набор.
  assert.equal(plan('ui', ['packages/shared/src/protocol.ts']).reason, 'shared-контракт')
  assert.equal(plan('server', ['packages/shared/src/protocol.ts']).reason, 'shared-контракт')
  assert.match(plan('web', ['packages/ui/vitest.config.ts']).reason, /^конфиг, схема или миграция/)
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

test('production deploy безопасно мигрирует постоянный серверный том до compose up', async (t) => {
  const repository = dirname(dirname(fileURLToPath(import.meta.url)))

  const runScenario = ({ target = [], legacy = {}, fail = '' }) => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'voicechat-volume-test-'))
    const commandsDirectory = join(tempRoot, 'commands')
    const volumesRoot = join(tempRoot, 'volumes')
    const calls = join(tempRoot, 'docker-calls')
    mkdirSync(commandsDirectory)
    mkdirSync(volumesRoot)

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
