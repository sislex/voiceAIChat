import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  openSync,
  closeSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import {
  ADAPTER,
  contentHash,
  executeRelease,
  parseReleaseSet,
  runOwnerGate,
  verifyDeploymentLock
} from './delivery-release.mjs'

const release = (applicationId, version = '1.0.0') => ({
  schemaVersion: 1,
  applicationId,
  version,
  apiVersion: '1.0.0',
  commit: (version === '1.0.0' ? 'a' : 'b').repeat(40),
  dataVersion: '1.0.0',
  requires:
    applicationId === 'make'
      ? [
          {
            applicationId: 'core',
            minVersion: '1.0.0',
            maxVersionExclusive: '2.0.0',
            minApiVersion: '1.0.0',
            maxApiVersionExclusive: '2.0.0'
          }
        ]
      : [],
  capabilities: [],
  artifacts: [
    {
      kind: 'oci',
      service: applicationId === 'core' ? 'voicechat' : applicationId,
      reference: `registry.test/${applicationId}@sha256:${(version === '1.0.0' ? 'a' : 'b').repeat(64)}`
    }
  ]
})
const environment = (...releases) => ({
  schemaVersion: 1,
  revision: 1,
  applications: releases.map((manifest) => ({
    manifest,
    healthy: true,
    installedAt: 1
  }))
})
function fixture(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'delivery-release-test-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const previous = environment(release('core'), release('make')),
    next = release('make', options.noop ? '1.0.0' : '1.1.0')
  const manifest = {
    schemaVersion: 1,
    releaseSetId: 'release-1',
    runId: 'run-1',
    stage: 0,
    environment: 'staging',
    previous,
    releases: [next],
    owners: [
      {
        repository: 'sislex/make',
        commit: next.commit,
        gate: {
          command: 'gate:release',
          exitCode: 0,
          evidenceSha256: 'c'.repeat(64)
        },
        artifacts: []
      }
    ],
    migrations: [],
    flags: {},
    recovery: { strategy: 'artifact-rollback', evidenceSha256: 'd'.repeat(64) }
  }
  const input = {
    action: 'deploy',
    request: {
      id: 'effect-1',
      epoch: 1,
      leaseId: 'lease-1',
      expiresAt: Date.now() + 60000
    },
    manifest,
    statePath: join(directory, 'state.json'),
    policy: {
      schemaVersion: 1,
      runId: 'run-1',
      environment: 'staging',
      actions: ['deploy', 'reconcile'],
      repositories: ['sislex/make']
    }
  }
  let current = structuredClone(previous),
    replaces = 0,
    valid = true
  const calls = [],
    runtime = {
      observe: () => structuredClone(current),
      inventory: () => [
        {
          Id: options.touchOther && replaces ? 'core-changed' : 'core-original',
          State: { StartedAt: 'start-core' },
          Config: { Labels: { 'com.docker.compose.service': 'voicechat' } }
        },
        {
          Id: `make-${replaces}`,
          State: { StartedAt: `start-${replaces}` },
          Config: { Labels: { 'com.docker.compose.service': 'make' } }
        }
      ],
      linksHealthy: () => true,
      pull: (item) => calls.push(['pull', item.version]),
      replace: (items) => {
        calls.push(['replace', items[0].version])
        replaces++
        if (options.rollbackFailure && replaces > 1)
          throw new Error('rollback failed')
        current = environment(release('core'), items[0])
        if (options.healthFailure && replaces === 1)
          current.applications[1].healthy = false
        if (options.loseLease) valid = false
      }
    }
  const verify = (envelope) => ({
    valid,
    epoch: envelope.epoch,
    leaseId: envelope.leaseId
  })
  return {
    directory,
    input,
    runtime,
    verify,
    calls,
    restoreLease: () => {
      valid = true
    }
  }
}
const run = (f) => executeRelease(f.input, f.runtime, f.verify, { attempts: 1 })
test('versioned manifest rejects missing provenance, mutable digests, duplicate owners, migrations and uncommissioned rollback', (t) => {
  const { input } = fixture(t)
  assert.equal(ADAPTER.schemaVersion, 1)
  for (const mutate of [
    (m) => {
      m.owners[0].commit = 'c'.repeat(40)
    },
    (m) => {
      m.releases[0].artifacts[0].reference = 'registry.test/make:latest'
    },
    (m) => {
      m.owners.push(m.owners[0])
    },
    (m) => {
      m.migrations.push('schema-change')
    },
    (m) => {
      m.releases[0].dataVersion = '2.0.0'
    },
    (m) => {
      m.recovery = null
    },
    (m) => {
      m.owners[0].gate.exitCode = 1
    }
  ]) {
    const changed = structuredClone(input.manifest)
    mutate(changed)
    assert.throws(() => parseReleaseSet(changed))
  }
  assert.equal(
    contentHash(parseReleaseSet(input.manifest)),
    contentHash(parseReleaseSet(structuredClone(input.manifest)))
  )
})
test('isolated no-op observes exact composition without pulling or replacing', async (t) => {
  const f = fixture(t, { noop: true }),
    result = await run(f)
  assert.equal(result.status, 'noop')
  assert.deepEqual(f.calls, [])
  assert.deepEqual(result.observed, f.input.manifest.previous)
  assert.equal(JSON.parse(readFileSync(f.input.statePath)).active, null)
})
test('successful release and durable idempotency replay make one effect', async (t) => {
  const f = fixture(t),
    result = await run(f)
  assert.equal(result.status, 'released')
  assert.equal(result.observed.applications[1].manifest.version, '1.1.0')
  assert.deepEqual(await run(f), result)
  assert.equal(f.calls.filter(([name]) => name === 'replace').length, 1)
  f.input.manifest.flags = { enabled: true }
  await assert.rejects(run(f), /immutable|payload mismatch/)
})
test('failed health rolls back and proves the actual previous versions', async (t) => {
  const f = fixture(t, { healthFailure: true }),
    result = await run(f)
  assert.equal(result.status, 'failed')
  assert.equal(result.recovery, 'previous-composition-verified')
  assert.deepEqual(result.observed, f.input.manifest.previous)
  assert.deepEqual(
    f.calls
      .filter(([name]) => name === 'replace')
      .map(([, version]) => version),
    ['1.1.0', '1.0.0']
  )
})
test('unknown rollback and untouched-service drift retain the durable environment barrier', async (t) => {
  for (const options of [
    { healthFailure: true, rollbackFailure: true },
    { touchOther: true }
  ]) {
    const f = fixture(t, options),
      result = await run(f)
    assert.equal(result.status, 'uncertain')
    assert.ok(JSON.parse(readFileSync(f.input.statePath)).active)
    await assert.rejects(run(f), /reconcile/)
    f.input.request.id = 'another-effect'
    f.input.request.epoch++
    await assert.rejects(run(f), /unresolved/)
  }
})
test('lost lease suppresses further mutation and restart reconciliation observes without replaying', async (t) => {
  const f = fixture(t, { loseLease: true }),
    result = await run(f)
  assert.equal(result.status, 'uncertain')
  assert.equal(f.calls.filter(([name]) => name === 'replace').length, 1)
  f.restoreLease()
  f.input.request.epoch = 2
  f.input.request.leaseId = 'lease-2'
  f.input.action = 'reconcile'
  const reconciled = await run(f)
  assert.equal(reconciled.status, 'released')
  assert.equal(f.calls.filter(([name]) => name === 'replace').length, 1)
  assert.equal(JSON.parse(readFileSync(f.input.statePath)).active, null)
  f.input.request.epoch = 1
  f.input.request.leaseId = 'lease-1'
  await assert.rejects(run(f), /Stale/)
})
test('expired, unauthorized and impersonated fences cannot make an effect', async (t) => {
  for (const mutate of [
    (f) => {
      f.input.request.expiresAt = 1
    },
    (f) => {
      f.input.policy.repositories = []
    },
    (f) => {
      f.input.policy.runId = 'other-run'
    },
    (f) => {
      f.verify = () => ({ valid: true, epoch: 999, leaseId: 'other' })
    }
  ]) {
    const f = fixture(t)
    mutate(f)
    await assert.rejects(run(f))
    assert.deepEqual(f.calls, [])
  }
})
test('gate adapter invokes existing owner gate at exact clean SHA and rejects changed source', (t) => {
  const f = fixture(t),
    commit = 'a'.repeat(40)
  t.mock.method(process, 'getuid', () => 1000)
  const gateEnvironment = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    SISLEXA_DELIVERY_GATE_WORKER: '1',
    GH_TOKEN: 'must-not-reach-candidate',
    DELIVERY_ADMIN_TOKEN: 'must-not-reach-candidate'
  }
  writeFileSync(
    join(f.directory, 'package.json'),
    JSON.stringify({
      scripts: { gate: 'node tests.js', 'gate:release': 'npm run gate' }
    })
  )
  let dirty = false,
    changed = false
  const commands = [],
    execute = (command, args, options) => {
      assert.equal(options.env.GH_TOKEN, undefined)
      assert.equal(options.env.DELIVERY_ADMIN_TOKEN, undefined)
      commands.push([command, ...args])
      if (command === 'npm') {
        if (changed) dirty = true
        return { status: 0 }
      }
      return {
        status: 0,
        stdout:
          args[0] === 'rev-parse'
            ? commit
            : args[0] === 'status'
              ? dirty
                ? ' M file'
                : ''
              : 'https://github.com/sislex/make.git'
      }
    }
  const input = { repository: 'sislex/make', commit, checkout: f.directory }
  assert.equal(
    runOwnerGate(input, execute, gateEnvironment).command,
    'gate:release'
  )
  assert.ok(
    commands.some((command) => command.join(' ') === 'npm run gate:release')
  )
  assert.throws(
    () =>
      runOwnerGate(input, execute, {
        ...gateEnvironment,
        SISLEXA_RELEASE_LOCK_FD: '3'
      }),
    /unprivileged/
  )
  assert.throws(() => runOwnerGate(input, execute, {}), /unprivileged/)
  changed = true
  assert.throws(() => runOwnerGate(input, execute, gateEnvironment), /dirty/)
})
test('host OS lock survives exec and excludes concurrent legacy flock users', async (t) => {
  const f = fixture(t),
    config = join(f.directory, 'config.json'),
    lock = join(f.directory, 'host.lock'),
    fakeNode = join(f.directory, 'node-probe.py')
  writeFileSync(config, JSON.stringify({ hostLock: lock }))
  writeFileSync(
    fakeNode,
    `#!/usr/bin/env python3\nimport os\nos.execv(${JSON.stringify(process.execPath)}, [${JSON.stringify(process.execPath)}, "-e", 'require("node:fs").fstatSync(Number(process.env.SISLEXA_RELEASE_LOCK_FD));console.log("locked");setInterval(()=>{},1000)'])\n`,
    { mode: 0o700 }
  )
  const child = spawn(
    'python3',
    [
      resolve('scripts/delivery-release-lock.py'),
      'deploy',
      'input.json',
      config,
      fakeNode
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  )
  t.after(() => child.kill('SIGKILL'))
  await once(child.stdout, 'data', { signal: AbortSignal.timeout(10_000) })
  const probe = () =>
    spawnSync('python3', [
      '-c',
      'import fcntl,sys; f=open(sys.argv[1],"a"); fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)',
      lock
    ])
  assert.notEqual(probe().status, 0)
  const unlocked = openSync(lock, 'r+')
  try {
    assert.throws(() => verifyDeploymentLock(lock, unlocked))
  } finally {
    closeSync(unlocked)
  }
  const ended = once(child, 'exit')
  child.kill('SIGKILL')
  await ended
  assert.equal(probe().status, 0)
})

test('adapter death cannot release the host lock while its command is still running', async (t) => {
  const f = fixture(t),
    config = join(f.directory, 'config.json'),
    lock = join(f.directory, 'host.lock'),
    fakeNode = join(f.directory, 'command-node.py'),
    marker = join(f.directory, 'command-started'),
    finish = join(f.directory, 'command-finished')
  writeFileSync(config, JSON.stringify({ hostLock: lock }))
  const command = `import os,time;open(${JSON.stringify(marker)},'w').write(str(os.getpid()));time.sleep(1);open(${JSON.stringify(finish)},'w').write('done')`
  const source = `import { runDeploymentCommand } from ${JSON.stringify(new URL('./delivery-release.mjs', import.meta.url).href)};runDeploymentCommand('python3',['-c',${JSON.stringify(command)}],Number(process.env.SISLEXA_RELEASE_LOCK_FD))`
  writeFileSync(
    fakeNode,
    `#!/usr/bin/env python3\nimport os\nos.execv(${JSON.stringify(process.execPath)}, [${JSON.stringify(process.execPath)}, '--import', 'tsx', '--input-type=module', '-e', ${JSON.stringify(source)}])\n`,
    { mode: 0o700 }
  )
  const child = spawn(
    'python3',
    [
      resolve('scripts/delivery-release-lock.py'),
      'deploy',
      'input.json',
      config,
      fakeNode
    ],
    { stdio: 'ignore' }
  )
  t.after(() => child.kill('SIGKILL'))
  const waitFor = async (path) => {
    const start = Date.now()
    while (true) {
      try {
        readFileSync(path)
        return
      } catch {}
      if (Date.now() - start > 10000) throw new Error('Command did not finish')
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }
  await waitFor(marker)
  const ended = once(child, 'exit')
  child.kill('SIGKILL')
  await ended
  const probe = () =>
    spawnSync('python3', [
      '-c',
      'import fcntl,sys; f=open(sys.argv[1],"a"); fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)',
      lock
    ])
  assert.notEqual(probe().status, 0)
  await waitFor(finish)
  let released = false
  for (let i = 0; i < 20; i++) {
    if (probe().status === 0) {
      released = true
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.equal(released, true)
})
