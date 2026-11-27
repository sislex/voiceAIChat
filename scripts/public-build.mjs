#!/usr/bin/env node
// Public minimal Sislexa: sign-up/sign-in (Identity), billing with a daily user limit, chat
// (Chat/Required only) and file storage. One composition, two ways to run it:
//
//   npm run public:install -- [--mode docker|dev] [--state DIR] [--domain D] [--url URL] ...
//   npm run public:docker                 # Compose project from deploy/public (builds images)
//   npm run public:docker -- --from-dev   # live test stand: dev checkouts mounted under tsx watch (seconds, no image builds)
//   npm run public:docker -- --from-dev --build  # the same stand with images built from the checkouts
//   npm run public:update                 # fast-forward all checkouts to origin/dev; the live stand follows
//   npm run public:docker -- --pinned     # back to the published releases
//   npm run public:docker:down            # stop it and remove its volumes
//   npm run public:dev                    # the same services from working copies, no Docker (foreground)
//   npm run public:dev -- --detach        # same in the background; npm run public:dev:stop stops it
//
// Both modes use the same defaults (models, daily limit, storage quota) from DEFAULTS below.
// Secrets live only in the private state directory and are never printed.
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const composeFile = join(repository, 'deploy/public/docker-compose.yml')

export const DEFAULTS = {
  PUBLIC_CHAT_MODELS: 'codex:gpt-5.6-terra,codex:gpt-5.6-luna',
  PUBLIC_DAILY_USER_MICRO_USD: '100000',
  PUBLIC_TIME_ZONE: 'Europe/Minsk',
  PUBLIC_STORAGE_QUOTA_BYTES: String(50 * 1024 * 1024),
  PUBLIC_STORAGE_CAPACITY_BYTES: String(20 * 1000 ** 3),
  PUBLIC_MAIL_FROM: 'Sislexa <no-reply@sislexa.by>'
}
/** Development ports; Docker publishes only Caddy. */
export const DEV_PORTS = { core: 29787, ui: 29273, identity: 29798, billing: 29800, storage: 29899, node: 29895 }
const SIGNUP_ROLE = 'developer'
const TARIFF_CAPABILITIES = ['chat.use']

const secret = () => randomBytes(32).toString('base64url')
const writePrivate = (file, value) => { writeFileSync(file, value, { mode: 0o600, flag: 'wx' }); chmodSync(file, 0o600) }
export function parseEnv(text) {
  const values = {}
  for (const line of text.split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  return values
}
const quote = value => /^[A-Za-z0-9_@.:/,+=<>-]*$/.test(value) && !value.includes(' ') ? value : `'${value.replaceAll("'", "'\\''")}'`
export function renderEnv(values) {
  return Object.entries(values).map(([key, value]) => `${key}=${quote(String(value))}`).join('\n') + '\n'
}

function options(args) {
  const result = {}
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('--')) throw Error(`Unexpected argument ${args[i]}`)
    result[args[i].slice(2)] = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : 'true'
  }
  return result
}
const defaultState = mode => join(repository, '.public', mode)
/** Peers check Core's release version; a working copy reports the newest release branch. */
export function coreVersion() {
  const ref = spawnSync('git', ['-C', repository, 'for-each-ref', '--sort=-v:refname', '--format=%(refname:short)', 'refs/remotes/origin/release/0.1.*'], { encoding: 'utf8' }).stdout.split('\n')[0] ?? ''
  return /release\/(\d+\.\d+\.\d+)$/.exec(ref)?.[1] ?? '0.1.315'
}
const gitCommit = dir => spawnSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim()

/** Creates the private state: settings, secrets, component tokens and storage credentials. */
export async function install(opts = {}) {
  const mode = opts.mode ?? 'docker'
  if (!['docker', 'dev'].includes(mode)) throw Error('Mode is docker or dev')
  const state = resolve(opts.state ?? defaultState(mode))
  if (existsSync(join(state, '.env'))) throw Error(`State already exists: ${state}`)
  const domain = opts.domain ?? 'localhost'
  // A real domain is served over HTTPS with Let's Encrypt; a local Docker test uses plain HTTP on
  // localhost (Core) and 127.0.0.1 (storage UI), which Core accepts as loopback application URLs. Dev mode follows the
  // same split: cookies ignore ports, so a Core UI on 127.0.0.1 would share `vc_session` with every other local stand
  // that signs sessions with a different secret and sign them out in turn.
  const local = domain === 'localhost'
  const httpsPort = opts['https-port'] ?? (local ? '29443' : '443')
  const httpPort = opts['http-port'] ?? (local ? '29080' : '80')
  const portSuffix = (port, standard) => port === standard ? '' : ':' + port
  const url = opts.url ?? (mode === 'dev' ? `http://localhost:${DEV_PORTS.ui}` : local ? `http://localhost${portSuffix(httpPort, '80')}` : `https://${domain}${portSuffix(httpsPort, '443')}`)
  const storageUrl = mode === 'dev' ? `http://127.0.0.1:${DEV_PORTS.storage}` : local ? `http://127.0.0.1${portSuffix(httpPort, '80')}` : `https://files.${domain}${portSuffix(httpsPort, '443')}`
  const tls = opts.tls ?? (local ? '' : `admin@${domain}`)
  const runnerToken = opts['runner-token-file'] ? readFileSync(opts['runner-token-file'], 'utf8').trim() : (opts['runner-token'] ?? '')
  mkdirSync(state, { recursive: true, mode: 0o700 })
  chmodSync(state, 0o700)
  const { initializeComponents } = await import(pathToFileURL(join(repository, 'scripts/component-installation.mjs')).href)
  const origins = mode === 'docker'
    ? { core: 'http://voicechat:8787', identity: 'http://identity:8798', billing: 'http://billing:8800' }
    : { core: `http://127.0.0.1:${DEV_PORTS.core}`, identity: `http://127.0.0.1:${DEV_PORTS.identity}`, billing: `http://127.0.0.1:${DEV_PORTS.billing}` }
  await initializeComponents({ directory: join(state, 'components'), environmentId: 'public', origins, container: mode === 'docker', applications: ['core', 'identity', 'billing'] })
  for (const id of ['core', 'identity', 'billing']) mkdirSync(join(state, 'components', id, 'provider'), { recursive: true, mode: 0o700 })
  const storage = join(state, 'storage')
  mkdirSync(storage, { mode: 0o700 })
  const appToken = secret()
  writePrivate(join(storage, 'app.token'), appToken + '\n')
  writePrivate(join(storage, 'core-service.token'), secret() + '\n')
  writePrivate(join(storage, 'node.token'), secret() + '\n')
  // Storage introspects personal tokens through Identity with Core's identity credential; it reads
  // Core's outgoing file directly, so a rotated token needs no copy.
  // Identity signs sessions and Core verifies them: both read the same session secret.
  writePrivate(join(state, 'identity-session.secret'), randomBytes(32).toString('hex'))
  const values = {
    PUBLIC_MODE: mode,
    PUBLIC_DOMAIN: domain,
    PUBLIC_URL: url,
    PUBLIC_STORAGE_URL: storageUrl,
    PUBLIC_SITE: local ? 'http://localhost' : domain,
    PUBLIC_WWW_SITE: local ? 'http://www.localhost' : `www.${domain}`,
    PUBLIC_FILES_SITE: local ? 'http://127.0.0.1' : `files.${domain}`,
    PUBLIC_TLS_LINE: tls ? `tls ${tls}` : '',
    PUBLIC_HTTP_PORT: httpPort,
    PUBLIC_HTTPS_PORT: httpsPort,
    PUBLIC_STATE_DIR: state,
    PUBLIC_CORE_VERSION: coreVersion(),
    PUBLIC_STORAGE_SOURCE: resolve(opts['storage-source'] ?? join(dirname(repository), 'storage')),
    PUBLIC_CORE_COMMIT: gitCommit(repository),
    ...DEFAULTS,
    ...(opts.models ? { PUBLIC_CHAT_MODELS: opts.models } : {}),
    ...(opts['daily-micro-usd'] ? { PUBLIC_DAILY_USER_MICRO_USD: opts['daily-micro-usd'] } : {}),
    ...(opts['quota-bytes'] ? { PUBLIC_STORAGE_QUOTA_BYTES: opts['quota-bytes'] } : {}),
    PUBLIC_RUNNER_URL: opts['runner-url'] ?? (mode === 'docker' ? 'http://host.docker.internal:28790' : 'http://127.0.0.1:28790'),
    PUBLIC_RUNNER_TOKEN: runnerToken,
    PUBLIC_SMTP_URL: opts['smtp-url'] ?? '',
    PUBLIC_PG_PASSWORD: secret(),
    PUBLIC_ADMIN_PASSWORD: opts['admin-password'] ?? secret(),
    PUBLIC_INTERNAL_TOKEN: secret(),
    PUBLIC_MCP_SECRET: secret(),
    PUBLIC_STORAGE_APP_TOKEN: appToken
  }
  writePrivate(join(state, '.env'), renderEnv(values))
  return { state, mode, url }
}

const load = state => parseEnv(readFileSync(join(state, '.env'), 'utf8'))
const composeFromDev = join(dirname(composeFile), 'compose.from-dev.yml')
/** Compose for one installation; a --from-dev stand adds the overlay and its environment overrides. */
const compose = (state, project, args, extra = {}) => {
  const dev = existsSync(join(state, 'from-dev.json')) ? JSON.parse(readFileSync(join(state, 'from-dev.json'), 'utf8')) : null
  const files = dev ? ['-f', composeFile, '-f', composeFromDev, ...(dev.mode === 'live' ? ['-f', join(state, 'compose.live.yml')] : [])] : ['-f', composeFile]
  return spawnSync('docker', ['compose', '-p', project, ...files, '--env-file', join(state, '.env'), ...args], { stdio: 'inherit', ...extra, env: { ...process.env, ...(dev?.env ?? {}), ...(extra.env ?? {}) } })
}
const run = (cmd, args, cwd) => {
  const result = spawnSync(cmd, args, { cwd, stdio: 'inherit' })
  if (result.status !== 0) throw Error(`${cmd} ${args.join(' ')} failed in ${cwd}`)
}
const packageVersion = dir => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version

/**
 * Test stand from working copies: Core UI bundle, Identity, Billing and storage images are built from
 * the dev checkouts under the workspace (default ~/sislexa-dev); Core is this checkout as usual.
 * The choice is remembered in the state directory so later public:docker runs keep it until
 * `--pinned` switches back to published releases.
 */
/**
 * Core UI bundles the Identity login, profile and admin card from its pinned `@sislexa/identity`
 * archive, so Identity UI fixes in dev would not reach a --from-dev stand until a release and a
 * pin. The build temporarily swaps every installed copy of the package for a pack of the dev
 * working copy and restores the pinned copies afterwards, also when the build fails.
 */
export function withDevIdentityPackage(uiDir, identityDir, build) {
  const work = mkdtempSync(join(tmpdir(), 'public-identity-'))
  const targets = [join(uiDir, 'node_modules', '@sislexa', 'identity'),
    ...readdirSync(join(uiDir, 'packages')).map(name => join(uiDir, 'packages', name, 'node_modules', '@sislexa', 'identity'))]
    .filter(path => existsSync(join(path, 'package.json')))
  const swapped = []
  try {
    const [packed] = JSON.parse(spawnSync('npm', ['pack', '--pack-destination', work, '--json'], { cwd: identityDir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).stdout || '[]')
    if (!packed?.filename) throw Error('npm pack of the Identity working copy failed')
    run('tar', ['-xzf', join(work, packed.filename), '-C', work], work)
    targets.forEach((target, index) => {
      const saved = join(work, `pinned-${index}`)
      renameSync(target, saved)
      swapped.push([target, saved])
      cpSync(join(work, 'package'), target, { recursive: true })
    })
    build()
  } finally {
    for (const [target, saved] of swapped) { rmSync(target, { recursive: true, force: true }); renameSync(saved, target) }
    rmSync(work, { recursive: true, force: true })
  }
}

const sha = data => createHash('sha256').update(data).digest('hex')
const fileHash = file => (existsSync(file) ? sha(readFileSync(file)) : '')
/** Hash of the lock file an image was installed from; empty when the image does not exist. */
function imageLockHash(image) {
  const result = spawnSync('docker', ['run', '--rm', '--entrypoint', 'cat', image, '/app/package-lock.json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return result.status === 0 ? sha(result.stdout) : ''
}

/** Runs a service from mounted sources and restarts it when a source file changes. */
export const LIVE_RUN_SCRIPT = `#!/bin/sh
# live-run CWD ENTRY PATHS(colon separated) [node flags...]
cwd=$1; entry=$2; paths=$(echo "$3" | tr : ' '); shift 3
cd "$cwd" || exit 1
mark=$(mktemp); pid=
trap '[ -n "$pid" ] && kill "$pid" 2>/dev/null; wait; exit 0' TERM INT
while :; do
  touch "$mark"
  node "$@" --import tsx "$entry" &
  pid=$!
  while kill -0 "$pid" 2>/dev/null; do
    sleep 1
    if [ -n "$(find $paths -type f -newer "$mark" -print -quit 2>/dev/null)" ]; then
      echo "[live] source changed, restarting"; kill "$pid"; break
    fi
  done
  wait "$pid" 2>/dev/null
  sleep 1
done
`

/**
 * Compose overlay of the live stand: every service keeps its image (Node modules, build output)
 * and runs the sources of the working copy under `tsx watch`, so a merged commit restarts the
 * service in seconds. Only existing `src` directories are mounted; nothing is written back.
 */
export function liveOverlay(dirs, has = existsSync, list = readdirSync) {
  const sources = (root, rels) => [...rels, ...(has(join(root, 'packages')) ? list(join(root, 'packages')).map(name => `packages/${name}`) : []).map(dir => dir + '/src')]
    .filter(rel => has(join(root, rel)))
  // The supervisor (LIVE_RUN_SCRIPT) polls the mounted sources and restarts the service only after
  // the old process has exited: a component's SQLite token registry must not have two writers,
  // which `tsx watch` and `node --watch` could not guarantee in a container.
  const service = (name, root, rels, cwd, entry, flags = []) => {
    const mounted = sources(root, rels)
    return [
      `  ${name}:`,
      `    command: ${JSON.stringify(['/usr/local/bin/live-run', cwd, entry, mounted.map(rel => '/app/' + rel).join(':'), ...flags])}`,
      '    volumes:',
      '      - ' + JSON.stringify(`${dirs.script}:/usr/local/bin/live-run:ro`),
      ...mounted.map(rel => '      - ' + JSON.stringify(`${join(root, rel)}:/app/${rel}:ro`))
    ]
  }
  const lines = [
    '# Generated by npm run public:docker -- --from-dev (live mode): sources of the working copies under a restart supervisor.',
    'services:',
    ...service('voicechat', dirs.core, ['apps/server/src'], '/app/apps/server', 'src/index.ts', ['--max-old-space-size=768']),
    ...service('storage-node', dirs.core, ['packages/file-storage/src'], '/app', 'packages/file-storage/src/node/main.ts'),
    ...service('identity', dirs.identity, ['apps/server/src'], '/app', 'apps/server/src/index.ts'),
    ...service('billing', dirs.billing, ['src'], '/app', 'src/main.ts'),
    ...service('storage', dirs.storage, ['apps/service/src'], '/app/apps/service', 'src/main.ts')
  ]
  return lines.join('\n') + '\n'
}

const liveLocks = dirs => ({
  core: ['sislexa-public-core', dirs.core], identity: ['sislexa-public-identity:dev', dirs.identity],
  billing: ['sislexa-public-billing:dev', dirs.billing], storage: ['sislexa-public-storage:dev', dirs.storage]
})

function prepareFromDev(state, opts) {
  const root = resolve(opts.workspace ?? join(homedir(), 'sislexa-dev'))
  const dirs = { ui: join(root, 'sislexa-core-ui'), identity: join(root, 'identity'), billing: join(root, 'billing'), storage: join(root, 'storage') }
  for (const [name, dir] of Object.entries(dirs)) if (!existsSync(join(dir, 'package.json'))) throw Error(`--from-dev needs the ${name} working copy at ${dir}`)
  const live = !opts.build
  const bundle = join(state, 'core-ui-dev')
  const previous = existsSync(join(state, 'from-dev.json')) ? JSON.parse(readFileSync(join(state, 'from-dev.json'), 'utf8')) : null
  const commits = Object.fromEntries(Object.entries(dirs).map(([k, d]) => [k, gitCommit(d)]))
  // Live mode rebuilds the UI bundle only when the Core UI or Identity commit moved (about 15 s).
  if (!live || !existsSync(join(bundle, 'index.html')) || previous?.commits?.ui !== commits.ui || previous?.commits?.identity !== commits.identity) {
    console.log('[public:docker] building Core UI from ' + dirs.ui + ' with the Identity UI package from ' + dirs.identity)
    withDevIdentityPackage(dirs.ui, dirs.identity, () => run('npm', ['run', '-w', '@voicechat/web', 'build'], dirs.ui))
    rmSync(bundle, { recursive: true, force: true })
    cpSync(join(dirs.ui, 'apps', 'web', 'dist'), bundle, { recursive: true })
  }
  const image = (name, dir) => {
    const tag = `sislexa-public-${name}:dev`
    console.log(`[public:docker] building ${tag} from ${dir}`)
    run('docker', ['build', '-t', tag, '--build-arg', `APPLICATION_VERSION=${packageVersion(dir)}`, '--build-arg', `APPLICATION_COMMIT=${gitCommit(dir)}`, dir], dir)
    return tag
  }
  const stale = []
  if (live) {
    const all = { ...dirs, core: repository }
    for (const [name, [tag, dir]] of Object.entries(liveLocks(all))) if (imageLockHash(tag) !== fileHash(join(dir, 'package-lock.json'))) stale.push(name)
    if (stale.length) console.log('[public:docker] lock files changed or images missing, rebuilding: ' + stale.join(', '))
  }
  const rebuild = name => !live || stale.includes(name)
  const env = {
    PUBLIC_CORE_UI_DIR: bundle,
    PUBLIC_IDENTITY_IMAGE: rebuild('identity') ? image('identity', dirs.identity) : 'sislexa-public-identity:dev',
    PUBLIC_BILLING_IMAGE: rebuild('billing') ? image('billing', dirs.billing) : 'sislexa-public-billing:dev',
    PUBLIC_STORAGE_SOURCE: dirs.storage
  }
  if (live) {
    const script = join(state, 'live-run.sh')
    writeFileSync(script, LIVE_RUN_SCRIPT, { mode: 0o755 })
    chmodSync(script, 0o755)
    writeFileSync(join(state, 'compose.live.yml'), liveOverlay({ core: repository, identity: dirs.identity, billing: dirs.billing, storage: dirs.storage, script }))
  }
  writeFileSync(join(state, 'from-dev.json'), JSON.stringify({ mode: live ? 'live' : 'build', workspace: root, commits, env, rebuild: stale }, null, 2) + '\n')
  return { live, stale }
}

/** Settings Identity reads from Core's app_config and the tariff every personal tenant gets. */
export const CONFIGURE_SQL = [
  `INSERT INTO app_config(key, value) VALUES ('signup.enabled', '1') ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
  `INSERT INTO app_config(key, value) VALUES ('signup.role', '${SIGNUP_ROLE}') ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
  `UPDATE tariff_plans SET capabilities = '${JSON.stringify(TARIFF_CAPABILITIES)}' WHERE id = 'standard'`
]

async function waitHealthy(url, attempts = 90) {
  for (let i = 0; i < attempts; i++) {
    try { if ((await fetch(url, { signal: AbortSignal.timeout(3000) })).ok) return } catch { /* starting */ }
    await new Promise(r => setTimeout(r, 2000))
  }
  throw Error(`Not healthy: ${url}`)
}

async function docker(opts) {
  const state = resolve(opts.state ?? defaultState('docker'))
  const project = opts.project ?? 'sislexa-public'
  if (!existsSync(join(state, '.env'))) await install({ ...opts, mode: 'docker', state })
  const env = load(state)
  if (opts.pinned) rmSync(join(state, 'from-dev.json'), { force: true })
  const prepared = opts['from-dev'] ? prepareFromDev(state, opts) : null
  // Live stand: containers keep their images and only start/restart; a changed lock file rebuilds the image first.
  const live = prepared ? prepared.live : existsSync(join(state, 'from-dev.json')) && JSON.parse(readFileSync(join(state, 'from-dev.json'), 'utf8')).mode === 'live'
  const build = !live ? ['--build'] : []
  if (prepared?.live && prepared.stale.includes('core') && compose(state, project, ['build', 'voicechat', 'storage-node']).status !== 0) throw Error('Core image build failed')
  if (prepared?.live && prepared.stale.includes('storage') && compose(state, project, ['build', 'storage']).status !== 0) throw Error('Storage image build failed')
  if (compose(state, project, ['up', '-d', ...build, '--remove-orphans']).status !== 0) throw Error('docker compose up failed')
  await waitHealthy(`http://127.0.0.1:${env.PUBLIC_HTTP_PORT}/healthz`).catch(() => {})
  for (let i = 0; i < 60; i++) {
    const ready = compose(state, project, ['exec', '-T', 'postgres', 'psql', '-U', 'sislexa', '-d', 'sislexa', '-tAc', "SELECT count(*) FROM information_schema.tables WHERE table_name IN ('app_config','tariff_plans')"], { stdio: 'pipe', encoding: 'utf8' })
    if (ready.stdout?.trim() === '2') break
    await new Promise(r => setTimeout(r, 2000))
  }
  for (const sql of CONFIGURE_SQL) {
    if (compose(state, project, ['exec', '-T', 'postgres', 'psql', '-U', 'sislexa', '-d', 'sislexa', '-qc', sql]).status !== 0) throw Error('Configuration failed')
  }
  console.log(`Public build is up: ${env.PUBLIC_URL} (Compose project ${project}, state ${state})`)
}

/**
 * Brings a live stand up to date: fast-forwards the working copies to origin/dev, installs
 * dependencies of a copy whose lock file moved, refreshes the Core UI bundle when needed and waits
 * until the stand answers. The `tsx watch` containers restart themselves on the new sources.
 */
async function update(opts) {
  const started = Date.now()
  const state = resolve(opts.state ?? defaultState('docker'))
  const project = opts.project ?? 'sislexa-public'
  const dev = existsSync(join(state, 'from-dev.json')) ? JSON.parse(readFileSync(join(state, 'from-dev.json'), 'utf8')) : null
  if (dev?.mode !== 'live') throw Error('public:update works on a live stand; start it with npm run public:docker -- --from-dev')
  const env = load(state)
  const root = dev.workspace
  const copies = { core: repository, ui: join(root, 'sislexa-core-ui'), identity: join(root, 'identity'), billing: join(root, 'billing'), storage: join(root, 'storage') }
  const git = (dir, ...args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' })
  let moved = 0
  for (const [name, dir] of Object.entries(copies)) {
    if (git(dir, 'fetch', '-q', 'origin').status !== 0) throw Error(`git fetch failed in ${name} (${dir})`)
    const before = gitCommit(dir)
    const merged = git(dir, 'merge', '--ff-only', '-q', 'origin/dev')
    if (merged.status !== 0) throw Error(`${name} cannot fast-forward to origin/dev: ${(merged.stderr || merged.stdout).trim().split('\n')[0]}`)
    const after = gitCommit(dir)
    if (before === after) { console.log(`[public:update] ${name}: up to date ${after.slice(0, 8)}`); continue }
    moved++
    console.log(`[public:update] ${name}: ${before.slice(0, 8)} -> ${after.slice(0, 8)}`)
    if (git(dir, 'diff', '--name-only', before, after, '--', 'package-lock.json').stdout.trim()) {
      console.log(`[public:update] ${name}: lock file changed, npm install`)
      run('npm', ['install', '--no-audit', '--no-fund'], dir)
    }
  }
  const prepared = prepareFromDev(state, { ...opts, workspace: root })
  if (prepared.stale.includes('core') && compose(state, project, ['build', 'voicechat', 'storage-node']).status !== 0) throw Error('Core image build failed')
  if (prepared.stale.includes('storage') && compose(state, project, ['build', 'storage']).status !== 0) throw Error('Storage image build failed')
  if (compose(state, project, ['up', '-d', '--remove-orphans'], { stdio: 'pipe' }).status !== 0) throw Error('docker compose up failed')
  // Give tsx watch time to notice the new files before the first probe.
  if (moved) await new Promise(r => setTimeout(r, 3000))
  await waitHealthy(`http://127.0.0.1:${env.PUBLIC_HTTP_PORT}/healthz`, 60)
  console.log(`[public:update] ${env.PUBLIC_URL} answers; ${moved} copies moved; ${((Date.now() - started) / 1000).toFixed(1)} s`)
}

/** Sets the daily limit per user: the saved .env and Billing's stored policy change together. */
export function dailyLimitPolicyScript(limitMicroUsd, timeZone) {
  return "const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(process.argv[1]);" +
    "db.exec('CREATE TABLE IF NOT EXISTS daily_admission_policy (id INTEGER PRIMARY KEY CHECK(id = 1), value TEXT NOT NULL)');" +
    "db.prepare('INSERT INTO daily_admission_policy (id, value) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value')" +
    ".run(" + JSON.stringify(JSON.stringify({ limitMicroUsd, timeZone })) + "); db.close()"
}
function limit(opts) {
  const mode = opts.mode ?? 'docker'
  const state = resolve(opts.state ?? defaultState(mode))
  const usd = Number(opts.usd)
  if (!Number.isFinite(usd) || usd < 0) throw Error('Daily limit: --usd <dollars>, for example --usd 0.25')
  const env = load(state)
  const micro = Math.round(usd * 1_000_000), timeZone = opts['time-zone'] ?? env.PUBLIC_TIME_ZONE
  writeFileSync(join(state, '.env'), renderEnv({ ...env, PUBLIC_DAILY_USER_MICRO_USD: String(micro), PUBLIC_TIME_ZONE: timeZone }), { mode: 0o600 })
  chmodSync(join(state, '.env'), 0o600)
  const script = dailyLimitPolicyScript(micro, timeZone)
  if (mode === 'docker') {
    const project = opts.project ?? 'sislexa-public'
    // Billing images without BILLING_DAILY_POLICY_REPLACE refuse a changed policy, so the stored one changes first.
    if (compose(state, project, ['exec', '-T', 'billing', 'node', '-e', script, '/data/billing.sqlite']).status !== 0) throw Error('Billing policy update failed')
    if (compose(state, project, ['up', '-d', '--no-deps', 'billing']).status !== 0) throw Error('Billing restart failed')
  } else {
    const file = join(state, 'data', 'billing', 'billing.sqlite')
    if (existsSync(file) && spawnSync(process.execPath, ['-e', script, file], { stdio: 'inherit' }).status !== 0) throw Error('Billing policy update failed')
    console.log('Restart npm run public:dev to apply the new limit.')
  }
  console.log('Daily limit per user: $' + usd + ' (' + micro + ' micro-USD), ' + timeZone)
}

function dockerDown(opts) {
  const state = resolve(opts.state ?? defaultState('docker'))
  const project = opts.project ?? 'sislexa-public'
  compose(state, project, ['down', '-v', '--remove-orphans'])
}

/** Runs the same services from working copies; SQLite replaces Postgres. */
const devPidFile = state => join(state, 'dev.pid')
const alive = pid => { try { process.kill(pid, 0); return true } catch { return false } }
/** Background dev mode: the supervisor runs in its own session, so closing the terminal does not stop it. */
async function devDetached(opts) {
  const state = resolve(opts.state ?? defaultState('dev'))
  mkdirSync(state, { recursive: true })
  const pidFile = devPidFile(state)
  if (existsSync(pidFile) && alive(Number(readFileSync(pidFile, 'utf8')))) throw Error('Dev build is already running; npm run public:dev:stop stops it')
  const args = process.argv.slice(2).filter(arg => arg !== '--detach')
  const out = openSync(join(state, 'dev-supervisor.log'), 'a')
  const child = spawn(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), ...args], { detached: true, stdio: ['ignore', out, out], env: process.env })
  child.unref()
  writeFileSync(pidFile, String(child.pid))
  const env = existsSync(join(state, '.env')) ? load(state) : null
  const url = env?.PUBLIC_URL ?? `http://localhost:${DEV_PORTS.ui}`
  for (let i = 0; i < 180 && alive(child.pid); i++) {
    if (await fetch(url, { signal: AbortSignal.timeout(2000) }).then(r => r.ok).catch(() => false)) break
    await new Promise(r => setTimeout(r, 1000))
  }
  if (!alive(child.pid)) throw Error('Dev build stopped while starting; see ' + join(state, 'dev-supervisor.log'))
  console.log(`Public build (dev) runs in the background: ${url}; stop with npm run public:dev:stop`)
}
function devStop(opts) {
  const state = resolve(opts.state ?? defaultState('dev'))
  const pidFile = devPidFile(state)
  const pid = existsSync(pidFile) ? Number(readFileSync(pidFile, 'utf8')) : 0
  if (pid && alive(pid)) { process.kill(pid, 'SIGTERM'); console.log('Dev build stopped') } else console.log('Dev build is not running')
  rmSync(pidFile, { force: true })
}

async function dev(opts) {
  if (opts.detach) return devDetached(opts)
  const state = resolve(opts.state ?? defaultState('dev'))
  if (!existsSync(join(state, '.env'))) await install({ ...opts, mode: 'dev', state })
  const env = load(state)
  const root = resolve(opts.workspace ?? join(homedir(), 'sislexa-dev'))
  const dirs = {
    identity: opts['identity-dir'] ?? join(root, 'identity'),
    billing: opts['billing-dir'] ?? join(root, 'billing'),
    storage: opts['storage-dir'] ?? join(root, 'storage'),
    ui: opts['core-ui-dir'] ?? join(root, 'sislexa-core-ui')
  }
  for (const [name, dir] of Object.entries(dirs)) if (!existsSync(join(dir, 'package.json'))) throw Error(`Working copy for ${name} not found: ${dir}`)
  const data = join(state, 'data'), logs = join(state, 'logs')
  mkdirSync(data, { recursive: true }); mkdirSync(logs, { recursive: true })
  mkdirSync(join(data, 'core'), { recursive: true })
  copyFileSync(join(state, 'identity-session.secret'), join(data, 'core', 'session.secret'))
  chmodSync(join(data, 'core', 'session.secret'), 0o600)
  const components = join(state, 'components'), storage = join(state, 'storage'), p = DEV_PORTS
  const nodes = JSON.stringify([{ id: 'node-1', url: `http://127.0.0.1:${p.node}`, tokenFile: join(storage, 'node.token') }])
  const services = [
    { name: 'storage-node', cwd: repository, cmd: ['npm', 'run', 'start', '-w', '@sislexa/file-storage'], env: {
      HOST: '127.0.0.1', PORT: String(p.node), VC_FILE_STORAGE_NODE_ID: 'node-1', VC_FILE_STORAGE_DIR: join(data, 'blobs'),
      VC_FILE_STORAGE_CAPACITY_BYTES: env.PUBLIC_STORAGE_CAPACITY_BYTES, VC_FILE_STORAGE_TOKEN_FILE: join(storage, 'node.token') } },
    { name: 'identity', cwd: dirs.identity, cmd: ['npx', 'tsx', 'apps/server/src/index.ts'], env: {
      HOST: '127.0.0.1', PORT: String(p.identity), SISLEXA_COMPONENT_CONFIG: join(components, 'identity/config.json'),
      IDENTITY_DATA_DIR: join(data, 'identity'), IDENTITY_SESSION_SECRET_FILE: join(state, 'identity-session.secret'),
      IDENTITY_PUBLIC_URL: env.PUBLIC_URL, IDENTITY_ADMIN_PASSWORD: env.PUBLIC_ADMIN_PASSWORD, VC_HIBP_CHECK: '0',
      VC_SMTP_URL: env.PUBLIC_SMTP_URL ?? '', VC_MAIL_FROM: env.PUBLIC_MAIL_FROM ?? '' } },
    { name: 'billing', cwd: dirs.billing, cmd: ['npx', 'tsx', 'src/main.ts'], env: {
      HOST: '127.0.0.1', PORT: String(p.billing), BILLING_DATA_DIR: join(data, 'billing'),
      BILLING_DAILY_USER_MICRO_USD: env.PUBLIC_DAILY_USER_MICRO_USD, BILLING_DAILY_USER_TIME_ZONE: env.PUBLIC_TIME_ZONE,
      BILLING_DAILY_POLICY_REPLACE: '1', SISLEXA_COMPONENT_CONFIG: join(components, 'billing/config.json') } },
    // The storage design is edited in a working copy: the web bundle is rebuilt on every change and served from
    // apps/web/dist by the service, which itself restarts when its sources change (tsx watch).
    { name: 'storage-web', cwd: join(dirs.storage, 'apps/web'), cmd: ['npx', 'vite', 'build', '--watch'], env: {} },
    { name: 'storage', cwd: join(dirs.storage, 'apps/service'), cmd: ['npx', 'tsx', 'watch', 'src/main.ts'], env: {
      HOST: '127.0.0.1', PORT: String(p.storage),
      // The storage UI works in a preview frame (Make) without the Core sign-in; PUBLIC_STORAGE_DEV_USER= (empty) turns it off.
      STORAGE_DEV_USER: env.PUBLIC_STORAGE_DEV_USER ?? 'admin', STORAGE_DB_URL: `sqlite:${join(data, 'storage.sqlite')}`, STORAGE_NODES: nodes,
      STORAGE_DEFAULT_QUOTA_BYTES: env.PUBLIC_STORAGE_QUOTA_BYTES, STORAGE_AUTH_MODE: 'legacy', STORAGE_CORE_ID: env.PUBLIC_DOMAIN,
      STORAGE_CORE_URL: `http://127.0.0.1:${p.core}`, STORAGE_CORE_PUBLIC_URL: env.PUBLIC_URL, STORAGE_IDENTITY_URL: `http://127.0.0.1:${p.identity}`,
      VC_APPLICATION_STORAGE_TOKEN_FILE: join(storage, 'app.token'), STORAGE_CORE_SERVICE_TOKEN_FILE: join(storage, 'core-service.token'),
      STORAGE_IDENTITY_TOKEN_FILE: join(components, 'core/outgoing/identity.token') } },
    { name: 'core', cwd: join(repository, 'apps/server'), cmd: ['npx', 'tsx', 'src/index.ts'], env: {
      HOST: '127.0.0.1', PORT: String(p.core), VC_DATA_DIR: join(data, 'core'), VC_CORE_ID: env.PUBLIC_DOMAIN, TZ: env.PUBLIC_TIME_ZONE ?? 'Europe/Minsk',
      VC_PUBLIC_URL: env.PUBLIC_URL, PUBLIC_URL: env.PUBLIC_URL, SISLEXA_COMPONENT_CONFIG: join(components, 'core/config.json'),
      VC_APPLICATIONS: `chat,identity,storage=http://127.0.0.1:${p.storage}`, VC_APPLICATION_STORAGE_TOKEN: env.PUBLIC_STORAGE_APP_TOKEN,
      VC_CHAT_MODELS: env.PUBLIC_CHAT_MODELS, VC_CHAT_TEXT_ONLY: 'true', VC_CHAT_REQUIRE_BILLING: 'true', VC_KANBAN_MODE: 'off',
      VC_DEFAULT_ASSISTANT_MODE: 'chat', VC_KB_ROOT: join(repository, 'deploy/public/kb'),
      VC_TTS_RUNNER_URL: '', VC_STT_RUNNER_URL: '', VC_FILE_STORAGE_MODE: 'remote', VC_FILE_STORAGE_URL: `http://127.0.0.1:${p.storage}`,
      VC_FILE_STORAGE_SERVICE_TOKEN_FILE: join(storage, 'core-service.token'), VC_FILE_STORAGE_NODES: nodes,
      VC_FILE_STORAGE_DEFAULT_QUOTA_BYTES: env.PUBLIC_STORAGE_QUOTA_BYTES,
      VC_LLM_RUNNER_CLAUDE_URL: env.PUBLIC_RUNNER_URL, VC_LLM_RUNNER_CODEX_URL: env.PUBLIC_RUNNER_URL, VC_LLM_RUNNER_TOKEN: env.PUBLIC_RUNNER_TOKEN,
      VC_INTERNAL_TOKEN: env.PUBLIC_INTERNAL_TOKEN, VC_MCP_SECRET: env.PUBLIC_MCP_SECRET, VC_MCP_PUBLIC_BASE: `http://127.0.0.1:${p.core}`,
      VC_SMTP_URL: env.PUBLIC_SMTP_URL ?? '', VC_MAIL_FROM: env.PUBLIC_MAIL_FROM ?? '' } },
    { name: 'core-ui', cwd: dirs.ui, cmd: ['npm', 'run', 'dev'], env: { VC_API_PORT: String(p.core), VC_WEB_PORT: String(p.ui) } }
  ]
  // Component peers verify each other's release metadata, as the stand's run.sh exports it.
  const meta = (dir, apiVersion) => {
    const commit = gitCommit(dir)
    const version = dir === repository ? coreVersion() : JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version
    return { VC_APPLICATION_COMMIT: commit, VC_RELEASE_COMMIT: commit, VC_APPLICATION_VERSION: version, VC_APPLICATION_API_VERSION: apiVersion, VC_APPLICATION_DATA_VERSION: '1.0.0' }
  }
  const versions = { identity: meta(dirs.identity, '1.5.0'), billing: meta(dirs.billing, '1.2.0'), core: meta(repository, '1.1.0') }
  for (const service of services) if (versions[service.name]) Object.assign(service.env, versions[service.name])
  // A fresh working copy has no web bundle yet and the service refuses to start without it.
  if (!existsSync(join(dirs.storage, 'apps/web/dist/index.html'))) {
    const built = spawnSync('npx', ['vite', 'build'], { cwd: join(dirs.storage, 'apps/web'), stdio: 'inherit' })
    if (built.status !== 0) throw Error('Storage web build failed')
  }
  const children = []
  // Each service runs in its own process group, so npm and the servers it starts stop together.
  const stop = () => { for (const child of children) try { process.kill(-child.pid, 'SIGTERM') } catch { try { child.kill('SIGTERM') } catch { /* gone */ } } }
  process.on('SIGINT', () => { stop(); process.exit(0) })
  process.on('SIGTERM', () => { stop(); process.exit(0) })
  for (const service of services) {
    const log = join(logs, service.name + '.log')
    const child = spawn(service.cmd[0], service.cmd.slice(1), { cwd: service.cwd, env: { ...process.env, ...service.env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
    const sink = (await import('node:fs')).createWriteStream(log, { flags: 'a' })
    child.stdout.pipe(sink); child.stderr.pipe(sink)
    child.on('exit', code => console.log(`[public:dev] ${service.name} exited with ${code}; log ${log}`))
    children.push(child)
    if (service.name === 'core') await waitHealthy(`http://127.0.0.1:${p.core}/api/health`)
    if (service.name === 'identity') await waitHealthy(`http://127.0.0.1:${p.identity}/v1/health`)
  }
  configureDev(join(data, 'core'))
  console.log(`Public build (dev) is up: ${env.PUBLIC_URL}; logs ${logs}; Ctrl+C stops it`)
}

/** Dev mode keeps Core and Identity on SQLite files in the state directory. */
function configureDev(coreData) {
  const script = `
const { DatabaseSync } = require('node:sqlite')
const { readdirSync, existsSync } = require('node:fs')
const sql = JSON.parse(process.argv[1])
const db = new DatabaseSync(process.argv[2] + '/voicechat.db')
for (const s of sql.slice(0, 2)) db.exec(s)
const identityDir = process.argv[3]
for (const f of existsSync(identityDir) ? readdirSync(identityDir).filter(f => f.endsWith('.db') || f.endsWith('.sqlite')) : []) {
  const idb = new DatabaseSync(identityDir + '/' + f)
  try { idb.exec(sql[2]) } catch {}
  idb.close()
}
try { db.exec(sql[2]) } catch {}
db.close()`
  spawnSync(process.execPath, ['-e', script, JSON.stringify(CONFIGURE_SQL), coreData, join(coreData, '..', 'identity')], { stdio: 'inherit' })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, ...rest] = process.argv.slice(2)
  const opts = options(rest)
  const run = { install: () => install(opts).then(r => console.log(`State ${r.state} (${r.mode}), ${r.url}`)), docker: () => docker(opts), update: () => update(opts), 'docker-down': () => dockerDown(opts), dev: () => dev(opts), 'dev-stop': () => devStop(opts), limit: () => limit(opts) }[command]
  if (!run) { console.error('Usage: node scripts/public-build.mjs install|docker|update|docker-down|dev|dev-stop|limit [options]'); process.exit(2) }
  Promise.resolve(run()).catch(error => { console.error(`public-build: ${error.message}`); process.exitCode = 1 })
}
