// Versioned release tooling boundary for delivery-control. No product runtime hooks.
import { createHash, randomUUID } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  APPLICATION_CATALOG,
  validateCatalogRelease
} from '../packages/shared/src/applicationCatalog.ts'
import {
  parseApplicationEnvironment,
  parseApplicationReleaseManifest
} from '../packages/shared/src/applicationRelease.ts'
import {
  applicationCompositionMatches,
  createDockerRuntime,
  deployApplications,
  parseDeploymentConfig
} from './application-deploy.mjs'
import { ownerGateCommand } from './owner-application-release.mjs'

export const ADAPTER = Object.freeze({
  schemaVersion: 1,
  adapter: 'sislexa-core-release',
  version: '1.0.0',
  commands: ['describe', 'gate', 'validate', 'observe', 'deploy', 'reconcile'],
  deploymentKinds: ['oci'],
  automaticPublication: false,
  automaticStageAcceptance: false
})
const json = (path) => JSON.parse(readFileSync(path, 'utf8'))
const requireValue = (value, message) => {
  if (!value) throw new Error(message)
}
const id = (value) =>
  typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/.test(value)
const sha = (value) => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value)
const digest = (value) =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const repository = (value) =>
  typeof value === 'string' && /^sislex\/[a-zA-Z0-9._-]+$/.test(value)
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])])
        )
      : value
export const contentHash = (value) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex')
const ownerRepository = (app) =>
  app.external?.repository
    ?.replace(/^https:\/\/github.com\//, '')
    .replace(/\.git$/, '') ?? 'sislex/voiceAIChat'

export function parseReleaseSet(value) {
  requireValue(
    value?.schemaVersion === 1 &&
      id(value.releaseSetId) &&
      id(value.runId) &&
      Number.isSafeInteger(value.stage) &&
      value.stage >= 0 &&
      ['staging', 'production'].includes(value.environment),
    'Invalid release-set identity'
  )
  requireValue(
    Array.isArray(value.releases) &&
      value.releases.length > 0 &&
      value.releases.length <= 50 &&
      Array.isArray(value.owners),
    'Missing releases or owners'
  )
  const previous = parseApplicationEnvironment(value.previous),
    releases = value.releases.map(parseApplicationReleaseManifest)
  requireValue(
    new Set(releases.map((item) => item.applicationId)).size ===
      releases.length,
    'Duplicate release application'
  )
  const owners = value.owners.map((owner) => {
    requireValue(
      repository(owner.repository) &&
        sha(owner.commit) &&
        owner.gate?.exitCode === 0 &&
        ['gate', 'gate:release'].includes(owner.gate.command) &&
        digest(owner.gate.evidenceSha256),
      'Invalid owner gate evidence'
    )
    requireValue(
      Array.isArray(owner.artifacts) &&
        owner.artifacts.every(
          (item) =>
            typeof item.name === 'string' &&
            item.name.length <= 200 &&
            typeof item.version === 'string' &&
            item.version.length <= 100 &&
            digest(item.sha256)
        ),
      'Invalid owner artifact inventory'
    )
    return {
      repository: owner.repository,
      commit: owner.commit,
      gate: {
        command: owner.gate.command,
        exitCode: 0,
        evidenceSha256: owner.gate.evidenceSha256
      },
      artifacts: owner.artifacts.map(({ name, version, sha256 }) => ({
        name,
        version,
        sha256
      }))
    }
  })
  requireValue(
    new Set(owners.map((item) => item.repository)).size === owners.length,
    'Duplicate owner repository'
  )
  for (const release of releases) {
    validateCatalogRelease(release)
    const app = APPLICATION_CATALOG.find(
      (item) => item.id === release.applicationId
    )
    requireValue(
      owners.some(
        (owner) =>
          owner.repository === ownerRepository(app) &&
          owner.commit === release.commit
      ),
      'Release has no exact owner gate evidence'
    )
    const old = previous.applications.find(
      (item) => item.manifest.applicationId === release.applicationId
    )
    requireValue(
      old && old.manifest.dataVersion === release.dataVersion,
      'Artifact rollback requires an existing application and unchanged data format'
    )
  }
  requireValue(
    value.recovery?.strategy === 'artifact-rollback' &&
      digest(value.recovery.evidenceSha256),
    'Missing tested recovery evidence'
  )
  requireValue(
    Array.isArray(value.migrations) && value.migrations.length === 0,
    'Data migrations require a separately commissioned recovery adapter'
  )
  requireValue(
    value.flags &&
      typeof value.flags === 'object' &&
      !Array.isArray(value.flags) &&
      Object.values(value.flags).every((item) => typeof item === 'boolean'),
    'Invalid feature flags'
  )
  return {
    schemaVersion: 1,
    releaseSetId: value.releaseSetId,
    runId: value.runId,
    stage: value.stage,
    environment: value.environment,
    previous,
    releases,
    owners,
    recovery: {
      strategy: 'artifact-rollback',
      evidenceSha256: value.recovery.evidenceSha256
    },
    migrations: [],
    flags: value.flags
  }
}

// Candidate output is bounded in memory and never published as raw shared logs.
export function runOwnerGate(
  input,
  execute = spawnSync,
  environment = process.env
) {
  requireValue(
    environment.SISLEXA_DELIVERY_GATE_WORKER === '1' &&
      process.getuid?.() !== 0 &&
      !environment.SISLEXA_RELEASE_LOCK_FD &&
      !environment.VC_REPO_DIR,
    'Owner gates require an isolated unprivileged worker, never the release host'
  )
  const gateEnvironment = Object.fromEntries(
    [
      'PATH',
      'HOME',
      'USER',
      'LOGNAME',
      'LANG',
      'LC_ALL',
      'TMPDIR',
      'TMP',
      'TEMP'
    ]
      .filter((key) => environment[key] !== undefined)
      .map((key) => [key, environment[key]])
  )
  requireValue(
    repository(input.repository) && sha(input.commit),
    'Invalid gate provenance'
  )
  const cwd = resolve(input.checkout)
  const git = (args) => {
    const result = execute('git', args, {
      cwd,
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
      env: gateEnvironment
    })
    requireValue(
      !result.error && result.status === 0,
      'Cannot inspect owner checkout'
    )
    return result.stdout.trim()
  }
  const verify = () => {
    requireValue(
      git(['rev-parse', 'HEAD']) === input.commit,
      'Owner SHA changed'
    )
    requireValue(
      git(['status', '--porcelain', '--untracked-files=normal']) === '',
      'Owner checkout is dirty'
    )
    requireValue(
      git(['remote', 'get-url', 'origin'])
        .replace(/^https:\/\/github.com\//, '')
        .replace(/^git@github.com:/, '')
        .replace(/\.git$/, '') === input.repository,
      'Owner repository mismatch'
    )
  }
  verify()
  const command = ownerGateCommand(json(join(cwd, 'package.json')))
  const result = execute('npm', ['run', command], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    timeout: 3_600_000,
    maxBuffer: 32 * 1024 * 1024,
    env: gateEnvironment
  })
  verify()
  const evidence = {
    ...ADAPTER,
    repository: input.repository,
    commit: input.commit,
    command,
    exitCode: result.status ?? 1,
    signal: result.signal ?? null,
    observedAt: new Date().toISOString()
  }
  requireValue(
    !result.error && result.status === 0,
    'Owner gate failed; no passing evidence emitted'
  )
  return evidence
}

function save(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = path + '.' + randomUUID()
  const fd = openSync(temporary, 'wx', 0o600)
  try {
    writeFileSync(fd, JSON.stringify(value) + '\n')
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(temporary, path)
  const directory = openSync(dirname(path), 'r')
  try {
    fsyncSync(directory)
  } finally {
    closeSync(directory)
  }
}
const inventory = (runtime) =>
  runtime
    .inventory()
    .map((item) => ({
      service: item.Config.Labels['com.docker.compose.service'],
      containerId: item.Id,
      startedAt: item.State?.StartedAt ?? null
    }))
    .sort((a, b) => a.service.localeCompare(b.service))
const expectedEnvironment = (manifest) => ({
  ...manifest.previous,
  applications: [
    ...manifest.previous.applications.filter(
      (item) =>
        !manifest.releases.some(
          (release) => release.applicationId === item.manifest.applicationId
        )
    ),
    ...manifest.releases.map((manifest) => ({
      manifest,
      healthy: true,
      installedAt: 0
    }))
  ]
})

// Call only while holding the host's OS deployment lock (enforced by CLI launcher).
// verifyLease is a trusted online verifier, never a command from the release request.
export async function executeRelease(
  { action, request, manifest: raw, statePath, policy },
  runtime,
  verifyLease,
  options = {}
) {
  requireValue(
    ['deploy', 'reconcile'].includes(action),
    'Invalid effect action'
  )
  const manifest = parseReleaseSet(raw),
    manifestHash = contentHash(manifest)
  requireValue(
    id(request.id) &&
      id(request.leaseId) &&
      Number.isSafeInteger(request.epoch) &&
      request.epoch > 0 &&
      Number.isFinite(request.expiresAt),
    'Invalid fencing envelope'
  )
  requireValue(
    policy?.schemaVersion === 1 &&
      policy.environment === manifest.environment &&
      policy.runId === manifest.runId &&
      policy.actions?.includes(action) &&
      manifest.owners.every((owner) =>
        policy.repositories?.includes(owner.repository)
      ),
    'Run policy does not authorize this effect'
  )
  const state = existsSync(statePath)
    ? json(statePath)
    : { schemaVersion: 1, epoch: 0, leaseId: null, active: null, receipts: {} }
  requireValue(state.schemaVersion === 1, 'Unsupported release state')
  const fence = () => {
    requireValue(
      Date.now() < request.expiresAt &&
        (request.epoch > state.epoch ||
          (request.epoch === state.epoch && state.leaseId === request.leaseId)),
      'Stale release fence'
    )
    const result = verifyLease({
      ...request,
      action,
      runId: manifest.runId,
      environment: manifest.environment,
      releaseSetId: manifest.releaseSetId,
      manifestHash
    })
    requireValue(
      result?.valid === true &&
        result.epoch === request.epoch &&
        result.leaseId === request.leaseId,
      'Release lease verification failed'
    )
  }
  fence()
  state.epoch = request.epoch
  state.leaseId = request.leaseId
  save(statePath, state)
  state.manifests ??= {}
  requireValue(
    !state.manifests[manifest.releaseSetId] ||
      state.manifests[manifest.releaseSetId] === manifestHash,
    'Release-set identity is immutable'
  )
  state.manifests[manifest.releaseSetId] = manifestHash
  save(statePath, state)
  const receipt = state.receipts[request.id]
  if (receipt) {
    requireValue(
      receipt.manifestHash === manifestHash,
      'Idempotency payload mismatch'
    )
    return receipt
  }
  requireValue(
    !state.active ||
      (state.active.id === request.id &&
        state.active.manifestHash === manifestHash),
    'Environment has an unresolved release'
  )
  requireValue(
    action === 'reconcile' ? state.active : !state.active,
    'Interrupted effects require reconcile, never deploy replay'
  )
  const changed = new Set(
    manifest.releases.flatMap((item) =>
      item.artifacts.map((item) => item.service)
    )
  )
  const unchanged = (before) =>
    JSON.stringify(
      inventory(runtime).filter((item) => !changed.has(item.service))
    ) === JSON.stringify(before.filter((item) => !changed.has(item.service)))
  if (!state.active) {
    state.active = {
      id: request.id,
      manifestHash,
      manifest,
      before: inventory(runtime),
      startedAt: new Date().toISOString()
    }
    save(statePath, state)
  }
  const guarded = Object.fromEntries(
    ['observe', 'inventory', 'linksHealthy', 'pull', 'replace']
      .filter((name) => runtime[name])
      .map((name) => [
        name,
        (...args) => {
          fence()
          return runtime[name](...args)
        }
      ])
  )
  let result
  try {
    if (action === 'reconcile') {
      fence()
      const environment = guarded.observe(manifest.previous)
      const healthy =
        unchanged(state.active.before) &&
        (!guarded.linksHealthy || guarded.linksHealthy(environment))
      const status =
        healthy &&
        applicationCompositionMatches(
          environment,
          expectedEnvironment(manifest)
        )
          ? 'released'
          : healthy &&
              applicationCompositionMatches(environment, manifest.previous)
            ? 'failed'
            : 'uncertain'
      result = { status, environment }
    } else {
      const observed = guarded.observe(manifest.previous)
      if (
        applicationCompositionMatches(
          observed,
          expectedEnvironment(manifest)
        ) &&
        applicationCompositionMatches(observed, manifest.previous) &&
        (!guarded.linksHealthy || guarded.linksHealthy(observed))
      )
        result = { status: 'noop', environment: observed }
      else
        result = await deployApplications(
          { previous: manifest.previous, releases: manifest.releases },
          guarded,
          options
        )
    }
    fence()
    // Capture observed state again, including rollback; never manufacture evidence from intent.
    const observed = guarded.observe(manifest.previous)
    const target =
      result.status === 'failed'
        ? manifest.previous
        : expectedEnvironment(manifest)
    if (
      !applicationCompositionMatches(observed, target) ||
      !unchanged(state.active.before) ||
      (guarded.linksHealthy && !guarded.linksHealthy(observed))
    )
      result.status = 'uncertain'
    result = {
      schemaVersion: 1,
      adapterVersion: ADAPTER.version,
      id: request.id,
      releaseSetId: manifest.releaseSetId,
      manifestHash,
      epoch: request.epoch,
      status: result.status,
      observed,
      inventory: inventory(runtime),
      observedAt: new Date().toISOString(),
      recovery:
        result.status === 'failed' ? 'previous-composition-verified' : null
    }
    fence()
  } catch {
    // Lost lease and unknown effects keep the durable environment barrier.
    result = {
      schemaVersion: 1,
      adapterVersion: ADAPTER.version,
      id: request.id,
      releaseSetId: manifest.releaseSetId,
      manifestHash,
      epoch: request.epoch,
      status: 'uncertain',
      observed: null,
      observedAt: new Date().toISOString(),
      recovery: 'reconciliation-required'
    }
  }
  state.active.lastResult = result
  if (result.status !== 'uncertain') {
    state.receipts[request.id] = result
    state.active = null
  }
  save(statePath, state)
  return result
}

export function verifyDeploymentLock(path, lockFd) {
  const lock = statSync(resolve(path)),
    held = fstatSync(lockFd)
  requireValue(
    lock.dev === held.dev && lock.ino === held.ino,
    'Use the deployment lock launcher'
  )
  // fstat alone does not prove a flock. Re-acquire on the same inherited open
  // file description; this succeeds for our own lock and rejects a foreign holder.
  execFileSync(
    'python3',
    ['-c', 'import fcntl; fcntl.flock(3, fcntl.LOCK_EX | fcntl.LOCK_NB)'],
    { stdio: ['ignore', 'ignore', 'pipe', lockFd], timeout: 5000 }
  )
}

// The monitor and child inherit the kernel lock so adapter death cannot overlap
// an in-flight Docker command with another deployment or reconciliation process.
export function runDeploymentCommand(command, args, lockFd) {
  return execFileSync(
    'python3',
    [
      resolve(import.meta.dirname, 'delivery-release-command.py'),
      command,
      ...args
    ],
    {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, SISLEXA_RELEASE_LOCK_FD: '3' },
      stdio: ['ignore', 'pipe', 'pipe', lockFd]
    }
  )
}

export async function main(args = process.argv.slice(2)) {
  const [action, inputPath, configPath] = args
  if (action === 'describe') return ADAPTER
  const input = json(resolve(inputPath))
  if (action === 'gate') return runOwnerGate(input)
  if (action === 'validate') {
    const manifest = parseReleaseSet(input)
    return { schemaVersion: 1, manifestHash: contentHash(manifest), manifest }
  }
  const configFile = resolve(configPath),
    config = json(configFile)
  const deployment = parseDeploymentConfig(
    config.deployment,
    dirname(configFile)
  )
  if (action === 'observe') {
    const runtime = createDockerRuntime(deployment)
    return {
      schemaVersion: 1,
      observed: runtime.observe(input.previous),
      inventory: inventory(runtime),
      observedAt: new Date().toISOString()
    }
  }
  verifyDeploymentLock(
    config.hostLock,
    Number(process.env.SISLEXA_RELEASE_LOCK_FD)
  )
  requireValue(
    input.manifest.environment === deployment.environment,
    'Deployment environment mismatch'
  )
  requireValue(
    Array.isArray(config.verifyLeaseCommand) &&
      config.verifyLeaseCommand.length > 0 &&
      config.verifyLeaseCommand.every((item) => typeof item === 'string'),
    'Missing trusted lease verifier'
  )
  const verifier = (envelope) =>
    JSON.parse(
      execFileSync(
        config.verifyLeaseCommand[0],
        config.verifyLeaseCommand.slice(1),
        {
          input: JSON.stringify(envelope),
          encoding: 'utf8',
          timeout: 5000,
          maxBuffer: 64 * 1024,
          stdio: ['pipe', 'pipe', 'pipe']
        }
      )
    )
  const manifest = parseReleaseSet(input.manifest)
  const runtime = createDockerRuntime(deployment, (args) => {
    const lease = verifier({
      ...input.request,
      action,
      runId: manifest.runId,
      environment: manifest.environment,
      releaseSetId: manifest.releaseSetId,
      manifestHash: contentHash(manifest)
    })
    requireValue(
      Date.now() < input.request.expiresAt &&
        lease.valid === true &&
        lease.epoch === input.request.epoch &&
        lease.leaseId === input.request.leaseId,
      'Docker command lost release authority'
    )
    return runDeploymentCommand(
      'docker',
      args,
      Number(process.env.SISLEXA_RELEASE_LOCK_FD)
    )
  })
  return executeRelease(
    {
      action,
      request: input.request,
      manifest: input.manifest,
      statePath: join(deployment.stateDir, 'delivery-release-v1.json'),
      policy: config.policy
    },
    runtime,
    verifier
  )
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main()
    .then((result) => {
      console.log(JSON.stringify(result))
      if (['uncertain', 'failed'].includes(result.status)) process.exitCode = 2
    })
    .catch(() => {
      console.error(
        'Release adapter rejected the request; no successful release evidence emitted.'
      )
      process.exitCode = 1
    })
