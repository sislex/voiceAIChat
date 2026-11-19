#!/usr/bin/env node
// Public minimal Sislexa: sign-up/sign-in (Identity), billing with a daily user limit, chat
// (Chat/Required only) and file storage. One composition, two ways to run it:
//
//   npm run public:install -- [--mode docker|dev] [--state DIR] [--domain D] [--url URL] ...
//   npm run public:docker                 # Compose project from deploy/public (builds images)
//   npm run public:docker:down            # stop it and remove its volumes
//   npm run public:dev                    # the same services from working copies, no Docker
//
// Both modes use the same defaults (models, daily limit, storage quota) from DEFAULTS below.
// Secrets live only in the private state directory and are never printed.
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
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
  // localhost (Core) and 127.0.0.1 (storage UI), which Core accepts as loopback application URLs.
  const local = domain === 'localhost'
  const httpsPort = opts['https-port'] ?? (local ? '29443' : '443')
  const httpPort = opts['http-port'] ?? (local ? '29080' : '80')
  const portSuffix = (port, standard) => port === standard ? '' : ':' + port
  const url = opts.url ?? (mode === 'dev' ? `http://127.0.0.1:${DEV_PORTS.ui}` : local ? `http://localhost${portSuffix(httpPort, '80')}` : `https://${domain}${portSuffix(httpsPort, '443')}`)
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
const compose = (state, project, args, extra = {}) => spawnSync('docker', ['compose', '-p', project, '-f', composeFile, '--env-file', join(state, '.env'), ...args], { stdio: 'inherit', ...extra })

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
  if (compose(state, project, ['up', '-d', '--build']).status !== 0) throw Error('docker compose up failed')
  await waitHealthy(`http://127.0.0.1:${env.PUBLIC_HTTP_PORT}/api/health`).catch(() => {})
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
async function dev(opts) {
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
    { name: 'storage', cwd: dirs.storage, cmd: ['npm', 'start', '--workspace', '@sislexa/storage-service'], env: {
      HOST: '127.0.0.1', PORT: String(p.storage), STORAGE_DB_URL: `sqlite:${join(data, 'storage.sqlite')}`, STORAGE_NODES: nodes,
      STORAGE_DEFAULT_QUOTA_BYTES: env.PUBLIC_STORAGE_QUOTA_BYTES, STORAGE_AUTH_MODE: 'legacy', STORAGE_CORE_ID: env.PUBLIC_DOMAIN,
      STORAGE_CORE_URL: `http://127.0.0.1:${p.core}`, STORAGE_CORE_PUBLIC_URL: env.PUBLIC_URL, STORAGE_IDENTITY_URL: `http://127.0.0.1:${p.identity}`,
      VC_APPLICATION_STORAGE_TOKEN_FILE: join(storage, 'app.token'), STORAGE_CORE_SERVICE_TOKEN_FILE: join(storage, 'core-service.token'),
      STORAGE_IDENTITY_TOKEN_FILE: join(components, 'core/outgoing/identity.token') } },
    { name: 'core', cwd: join(repository, 'apps/server'), cmd: ['npx', 'tsx', 'src/index.ts'], env: {
      HOST: '127.0.0.1', PORT: String(p.core), VC_DATA_DIR: join(data, 'core'), VC_CORE_ID: env.PUBLIC_DOMAIN,
      VC_PUBLIC_URL: env.PUBLIC_URL, PUBLIC_URL: env.PUBLIC_URL, SISLEXA_COMPONENT_CONFIG: join(components, 'core/config.json'),
      VC_APPLICATIONS: `chat,identity,storage=http://127.0.0.1:${p.storage}`, VC_APPLICATION_STORAGE_TOKEN: env.PUBLIC_STORAGE_APP_TOKEN,
      VC_CHAT_MODELS: env.PUBLIC_CHAT_MODELS, VC_CHAT_TEXT_ONLY: 'true', VC_CHAT_REQUIRE_BILLING: 'true', VC_KANBAN_MODE: 'off',
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
  const children = []
  const stop = () => { for (const child of children) try { child.kill('SIGTERM') } catch { /* gone */ } }
  process.on('SIGINT', () => { stop(); process.exit(0) })
  process.on('SIGTERM', () => { stop(); process.exit(0) })
  for (const service of services) {
    const log = join(logs, service.name + '.log')
    const child = spawn(service.cmd[0], service.cmd.slice(1), { cwd: service.cwd, env: { ...process.env, ...service.env }, stdio: ['ignore', 'pipe', 'pipe'] })
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
  const run = { install: () => install(opts).then(r => console.log(`State ${r.state} (${r.mode}), ${r.url}`)), docker: () => docker(opts), 'docker-down': () => dockerDown(opts), dev: () => dev(opts), limit: () => limit(opts) }[command]
  if (!run) { console.error('Usage: node scripts/public-build.mjs install|docker|docker-down|dev|limit [options]'); process.exit(2) }
  Promise.resolve(run()).catch(error => { console.error(`public-build: ${error.message}`); process.exitCode = 1 })
}
