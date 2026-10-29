#!/usr/bin/env node
// Isolated local Sislexa development stand: every application service runs from its own
// working copy in development mode (tsx watch / Vite HMR) with its own ports, Postgres
// database, data, logs, secrets and process state. Only the LLM Runner is external and
// comes from an explicit private configuration file.
//
//   npm run dev:stand            start or reuse the stand (idempotent)
//   npm run dev:stand:run        start and supervise until SIGTERM/SIGINT
//   npm run dev:stand:status     state of this stand's processes and endpoints
//   npm run dev:stand:stop       stop only this stand's processes (data is kept)
//
// Configuration (environment variables, all optional except the runner file):
//   SISLEXA_STAND_NAME          stand name, default "local" (database sislexa_stand_<name>)
//   SISLEXA_STAND_HOME          stand directory, default ~/.sislexa/stands/<name>
//   SISLEXA_STAND_SOURCES       directory with the owner clones (voiceAIChat, sislexa-core-ui, …), default shared root or ~/sislexa-dev
//   SISLEXA_STAND_CORE_SOURCE   prepared Core checkout (no Core worktree or dependency installation)
//   SISLEXA_STAND_REF           revision for new working copies, default origin/dev
//   SISLEXA_STAND_PORT_BASE     service port base, default 31000 (Core = base + 787)
//   SISLEXA_STAND_UI_PORT       UI port, default 35273
//   SISLEXA_STAND_PG            Postgres server URL without database, default postgres://$USER@127.0.0.1:5432
//   SISLEXA_STAND_SEED          pg_dump (custom format) restored once into a new database
//   SISLEXA_STAND_USERS_PASSWORD  test password set for every user after seeding (not a secret)
//   SISLEXA_STAND_RUNNER_FILE   private env file (mode 600) with VC_LLM_RUNNER_CLAUDE_URL,
//                               VC_LLM_RUNNER_CODEX_URL and VC_LLM_RUNNER_TOKEN,
//                               default ~/.config/sislexa/dev-stand/runner.env
//   SISLEXA_STAND_SHARE         root of a running dev-mode instance (e.g. ~/sislexa-dev with env/, run.sh).
//                               The stand then runs only Core, Make and Core UI from its working copies and
//                               uses that instance's database, secrets, session secret, LLM Runner and other
//                               services. The mode is remembered in <home>/mode.json; an empty value switches
//                               back to the isolated stand. Stop the stand before switching.
import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomBytes, scryptSync } from 'node:crypto'
import { closeSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { homedir, userInfo } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const env = process.env
const NAME = env.SISLEXA_STAND_NAME || 'local'
if (!/^[a-z0-9][a-z0-9-]{0,30}$/.test(NAME)) fail('SISLEXA_STAND_NAME must be lowercase letters, digits and dashes')
const HOME = resolve(env.SISLEXA_STAND_HOME || join(homedir(), '.sislexa', 'stands', NAME))
const SOURCE_KEYS = { voiceAIChat: 'SISLEXA_STAND_CORE_SOURCE', 'sislexa-core-ui': 'SISLEXA_STAND_CORE_UI_SOURCE', make: 'SISLEXA_STAND_MAKE_SOURCE' }
const preparedSource = repo => env[SOURCE_KEYS[repo]] ? resolve(env[SOURCE_KEYS[repo]]) : null
const sourceRoot = repo => preparedSource(repo) || join(dirs.src, repo)
const REF = env.SISLEXA_STAND_REF || 'origin/dev'
const BASE = Number(env.SISLEXA_STAND_PORT_BASE || 31000)
const UI_PORT = Number(env.SISLEXA_STAND_UI_PORT || 35273)
const PG = (env.SISLEXA_STAND_PG || `postgres://${userInfo().username}@127.0.0.1:5432`).replace(/\/+$/, '')
const DB_NAME = 'sislexa_stand_' + NAME.replace(/-/g, '_')
const DB_URL = `${PG}/${DB_NAME}`
const RUNNER_FILE = resolve(env.SISLEXA_STAND_RUNNER_FILE || join(homedir(), '.config', 'sislexa', 'dev-stand', 'runner.env'))
const SELF_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dirs = { src: join(HOME, 'src'), data: join(HOME, 'data'), logs: join(HOME, 'logs'), run: join(HOME, 'run'), components: join(HOME, 'components'), private: join(HOME, 'private') }
const MODE_FILE = join(HOME, 'mode.json')
const SAVED_SHARE = existsSync(MODE_FILE) ? JSON.parse(readFileSync(MODE_FILE, 'utf8')).share ?? null : null
const SHARE = env.SISLEXA_STAND_SHARE === undefined ? SAVED_SHARE : env.SISLEXA_STAND_SHARE ? resolve(env.SISLEXA_STAND_SHARE) : null
const SOURCES = resolve(env.SISLEXA_STAND_SOURCES || SHARE || join(homedir(), 'sislexa-dev'))
// Shared mode keeps its data and component configuration apart from the isolated stand's.
const shareDirs = { data: join(dirs.data, 'shared'), components: join(HOME, 'components-shared') }

const port = n => BASE + n
const P = {
  core: port(787), make: port(788), kanban: port(789), tts: port(791), stt: port(792), browser: port(793), automation: port(794),
  reader: port(795), imageStudio: port(796), playwrightReader: port(797), identity: port(798), billing: port(800), analytics: port(801),
  ui: UI_PORT, playwrightReaderUi: UI_PORT + 8, webReaderUi: UI_PORT + 9, imageStudioUi: UI_PORT + 10
}
const url = p => `http://127.0.0.1:${p}`
// API/data versions published by each component image; dev processes must report them too.
const VERSIONS = {
  core: ['1.1.0', '1.0.0'], make: ['1.1.0', '1.0.0'], reader: ['1.1.0', '1.0.0'], 'playwright-reader': ['1.1.0', '1.0.0'], 'image-studio': ['1.1.0', '1.0.0'],
  tts: ['1.1.0', '1.0.0'], stt: ['1.1.0', '1.0.0'], billing: ['1.2.0', '1.0.0'], analytics: ['1.2.0', '1.0.0'],
  'web-reader-ui': ['1.0.0', '1.0.0'], 'playwright-reader-ui': ['1.0.0', '1.0.0'], 'image-studio-ui': ['1.0.0', '1.0.0']
}

const REPOS = SHARE ? ['voiceAIChat', 'sislexa-core-ui', 'make']
  : ['voiceAIChat', 'sislexa-core-ui', 'sislexa-kanban', 'make', 'identity', 'billing', 'analytics', 'webreader', 'playwrightreader', 'image-studio', 'voice']

function services(secrets, runner) {
  const D = name => join(dirs.data, name)
  const C = id => join(dirs.components, id, 'config.json')
  const tsx = file => ['npx', 'tsx', 'watch', file]
  const common = { NODE_ENV: 'development', VC_INTERNAL_TOKEN: secrets.internal, VC_MCP_SECRET: secrets.mcp }
  return [
    { id: 'identity', repo: 'identity', cmd: tsx('apps/server/src/index.ts'), port: P.identity, health: '/v1/health',
      env: { PORT: P.identity, SISLEXA_COMPONENT_CONFIG: C('identity'), IDENTITY_DATA_DIR: D('identity'), IDENTITY_DATABASE_URL: DB_URL,
        IDENTITY_SESSION_SECRET_FILE: join(dirs.data, 'core', 'session.secret'), IDENTITY_PUBLIC_URL: url(P.ui), VC_HIBP_CHECK: '0' } },
    { id: 'billing', repo: 'billing', cmd: tsx('src/main.ts'), port: P.billing, version: 'billing', env: { PORT: P.billing, SISLEXA_COMPONENT_CONFIG: C('billing'), BILLING_DATA_DIR: D('billing') } },
    { id: 'analytics', repo: 'analytics', cmd: tsx('src/main.ts'), port: P.analytics, version: 'analytics', env: { PORT: P.analytics, SISLEXA_COMPONENT_CONFIG: C('analytics'), ANALYTICS_DATA_DIR: D('analytics') } },
    { id: 'core', repo: 'voiceAIChat', cmd: ['npm', 'run', '-w', '@voicechat/server', 'dev'], port: P.core, health: '/api/health', version: 'core',
      env: { PORT: P.core, SISLEXA_COMPONENT_CONFIG: C('core'), VC_DATA_DIR: D('core'), VC_DB_URL: DB_URL, VC_CORE_ID: 'localhost', VC_PUBLIC_URL: url(P.ui),
        VC_APPLICATION_ID: 'core', VC_APPLICATION_VERSION: env.SISLEXA_STAND_CORE_VERSION || '0.1.489', VC_RELEASE_VERSION: env.SISLEXA_STAND_CORE_VERSION || '0.1.489',
        VC_APPLICATIONS: 'chat,make,projects,web-reader,playwright-reader,image-studio,identity', VC_CHAT_TEXT_ONLY: 'false', VC_CHAT_REQUIRE_BILLING: 'false',
        VC_DELEGATED_CHAT_ENABLED: 'false', VC_KB_OWNER_MODULES: '1', VC_ADMIN_MODE: 'embedded', VC_MACHINES_MODE: 'embedded',
        VC_KANBAN_MODE: 'remote', VC_KANBAN_URL: url(P.kanban), VC_KANBAN_MCP_PUBLIC_BASE: url(P.kanban),
        VC_MAKE_MODE: 'remote', VC_MAKE_URL: url(P.make), VC_MAKE_MCP_PUBLIC_BASE: url(P.make),
        VC_READER_MODE: 'remote', VC_READER_URL: url(P.reader), VC_READER_MCP_PUBLIC_BASE: url(P.reader),
        VC_PLAYWRIGHT_READER_MODE: 'remote', VC_PLAYWRIGHT_READER_URL: url(P.playwrightReader),
        VC_IMAGE_STUDIO_MODE: 'remote', VC_IMAGE_STUDIO_URL: url(P.imageStudio), VC_MCP_PUBLIC_BASE: url(P.core),
        VC_BROWSER_RUNNER_URL: url(P.browser), VC_BROWSER_RUNNER_TOKEN: secrets.browser, VC_BROWSER_PREVIEW_BASE: url(P.core),
        VC_TTS_RUNNER_URL: url(P.tts), VC_TTS_RUNNER_TOKEN: secrets.tts, VC_STT_RUNNER_URL: url(P.stt), VC_STT_RUNNER_TOKEN: secrets.stt,
        VC_VPN_SECRET_KEY: secrets.vpn, VC_AGENT_OFFLINE_ALERT_MIN: '0',
        VC_STAND_PROXY_PORTS: `${port(810)}-${port(814)}`,
        VC_APPLICATION_FRONTENDS: JSON.stringify({ 'playwright-reader-ui': url(P.playwrightReaderUi), 'web-reader-ui': url(P.webReaderUi), 'image-studio-ui': url(P.imageStudioUi) }),
        ...runner } },
    { id: 'kanban', repo: 'sislexa-kanban', cmd: tsx('apps/server/src/kanban/standalone/index.ts'), port: P.kanban, health: '/v1/health',
      env: { PORT: P.kanban, VC_DATA_DIR: D('kanban'), VC_DB_URL: DB_URL, VC_CORE_URL: url(P.core), VC_PUBLIC_URL: url(P.ui),
        VC_MCP_PUBLIC_BASE: url(P.core), VC_KANBAN_MCP_PUBLIC_BASE: url(P.kanban), VC_MAKE_URL: url(P.make), VC_MAKE_MCP_PUBLIC_BASE: url(P.make),
        VC_READER_MODE: 'embedded', VC_READER_URL: url(P.reader), VC_READER_MCP_PUBLIC_BASE: url(P.reader), VC_BROWSER_RUNNER_URL: url(P.browser),
        VC_BROWSER_RUNNER_TOKEN: secrets.browser, VC_ENVIRONMENT_SECRET_KEY: secrets.environment, ...runner } },
    { id: 'make', repo: 'make', cmd: ['npx', 'tsx', 'watch', '--ignore', 'packages/make-app', 'apps/make/src/standalone/index.ts'], port: P.make, version: 'make',
      env: { PORT: P.make, SISLEXA_COMPONENT_CONFIG: C('make'), VC_DATA_DIR: D('make'), VC_CORE_URL: url(P.core) } },
    { id: 'web-recorder-build', repo: 'webreader', cwd: 'apps/web-recorder', cmd: ['npx', 'vite', 'build', '--watch'] },
    { id: 'reader', repo: 'webreader', cmd: tsx('apps/web-reader/src/standalone/index.ts'), port: P.reader, version: 'reader',
      env: { PORT: P.reader, SISLEXA_COMPONENT_CONFIG: C('web-reader'), VC_DATA_DIR: D('reader'), VC_CORE_URL: url(P.core), VC_PLAYWRIGHT_READER_MODE: 'remote', VC_PLAYWRIGHT_READER_URL: url(P.playwrightReader) } },
    { id: 'playwright-reader', repo: 'playwrightreader', cmd: tsx('apps/playwright-reader/src/standalone/index.ts'), port: P.playwrightReader, version: 'playwright-reader',
      env: { PORT: P.playwrightReader, SISLEXA_COMPONENT_CONFIG: C('playwright-reader'), VC_DATA_DIR: D('playwright-reader'), VC_CORE_URL: url(P.core),
        VC_BROWSER_RUNNER_URL: url(P.browser), VC_BROWSER_RUNNER_TOKEN: secrets.browser, VC_BROWSER_PREVIEW_BASE: url(P.core) } },
    { id: 'browser-runner', repo: 'playwrightreader', cmd: tsx('apps/browser-runner/src/index.ts'), port: P.browser,
      env: { PORT: P.browser, VC_BROWSER_DATA_DIR: D('browser'), VC_BROWSER_RUNNER_TOKEN: secrets.browser } },
    { id: 'image-studio', repo: 'image-studio', cmd: tsx('apps/image-studio/src/standalone/index.ts'), port: P.imageStudio, version: 'image-studio',
      env: { PORT: P.imageStudio, SISLEXA_COMPONENT_CONFIG: C('image-studio'), VC_DATA_DIR: D('image-studio'), VC_CORE_URL: url(P.core) } },
    { id: 'tts', repo: 'voice', cmd: tsx('apps/tts-runner/src/index.ts'), port: P.tts, version: 'tts',
      env: { PORT: P.tts, SISLEXA_COMPONENT_CONFIG: C('tts-runner'), VC_DATA_DIR: D('tts'), VC_TTS_DATA_DIR: D('tts'), VC_TTS_TEMP_DIR: join(D('tts'), 'tmp'), VC_TTS_RUNNER_TOKEN: secrets.tts } },
    { id: 'stt', repo: 'voice', cmd: tsx('apps/stt-runner/src/index.ts'), port: P.stt, version: 'stt',
      env: { PORT: P.stt, SISLEXA_COMPONENT_CONFIG: C('stt-runner'), VC_DATA_DIR: D('stt'), VC_STT_TEMP_DIR: join(D('stt'), 'tmp'), VC_STT_RUNNER_TOKEN: secrets.stt } },
    { id: 'automation', repo: 'voiceAIChat', cmd: tsx('apps/automation-runner/src/index.ts'), port: P.automation,
      env: { PORT: P.automation, VC_AUTOMATION_DATA_DIR: D('automation'), VC_DATA_DIR: D('automation'), VC_AUTOMATION_RUNNER_TOKEN: secrets.automation } },
    ...[['web-reader-ui', 'webreader', 'packages/web-reader-app', P.webReaderUi], ['playwright-reader-ui', 'playwrightreader', 'packages/playwright-reader-app', P.playwrightReaderUi],
      ['image-studio-ui', 'image-studio', 'packages/image-studio-app', P.imageStudioUi]].flatMap(([id, repo, pkg, p]) => [
      { id: id + '-build', repo, cwd: pkg, cmd: ['npm', 'run', 'dev'], frontend: id, waitFor: join(pkg, 'dist', 'manifest.json') },
      { id, repo, cmd: ['node', '--import', 'tsx', 'scripts/application-frontend-server.mjs'], port: p, version: id, frontend: id,
        env: { PORT: p, VC_DATA_DIR: D(id), VC_APPLICATION_ID: id } }
    ]),
    { id: 'core-ui', repo: 'sislexa-core-ui', cmd: ['npm', 'run', 'dev'], port: P.ui, health: '/', env: coreUiEnv() }
  ].map(s => ({ ...s, env: { ...common, HOST: '127.0.0.1', ...s.env } }))
}

// Shared mode: Core, Make and Core UI of the stand on the shared instance's database and services.
function sharedServices(shared) {
  const D = name => join(shareDirs.data, name)
  const C = id => join(shareDirs.components, id, 'config.json')
  const common = { NODE_ENV: 'development', ...shared.secrets }
  return [
    { id: 'core', repo: 'voiceAIChat', cmd: ['npm', 'run', '-w', '@voicechat/server', 'dev'], port: P.core, health: '/api/health', version: 'core',
      env: { ...shared.core, ...(preparedSource('make') ? { VC_APPLICATION_FRONTENDS: JSON.stringify({ ...JSON.parse(shared.core.VC_APPLICATION_FRONTENDS || '{}'), 'make-ui': url(port(802)) }) } : {}), PORT: P.core, SISLEXA_COMPONENT_CONFIG: C('core'), VC_DATA_DIR: D('core'), VC_PUBLIC_URL: url(P.ui),
        VC_MAKE_URL: url(P.make), VC_MAKE_MCP_PUBLIC_BASE: url(P.make), VC_MCP_PUBLIC_BASE: url(P.core), VC_BROWSER_PREVIEW_BASE: url(P.core),
        // Machines connect to the shared instance's Core; this Core must not raise offline alerts for them.
        VC_AGENT_OFFLINE_ALERT_MIN: '0', VC_STAND_PROXY_PORTS: `${port(810)}-${port(814)}` } },
    ...(preparedSource('make') ? [
      { id: 'make-ui-build', repo: 'make', cwd: 'packages/make-app', cmd: ['npm', 'run', 'dev'], frontend: 'make-ui', waitFor: 'packages/make-app/dist/manifest.json', env: {} },
      { id: 'make-ui', repo: 'make', cmd: ['node', 'scripts/application-frontend-server.mjs'], frontend: 'make-ui', port: port(802),
        env: { PORT: port(802), VC_APPLICATION_ID: 'make-ui', VC_DATA_DIR: null } }
    ] : []),
    { id: 'make', repo: 'make', cmd: ['npx', 'tsx', 'watch', '--ignore', 'packages/make-app', 'apps/make/src/standalone/index.ts'], port: P.make, version: 'make',
      env: { ...shared.make, PORT: P.make, SISLEXA_COMPONENT_CONFIG: C('make'), VC_DATA_DIR: D('make'), VC_CORE_URL: url(P.core) } },
    { id: 'core-ui', repo: 'sislexa-core-ui', cmd: ['npm', 'run', 'dev'], port: P.ui, health: '/', env: coreUiEnv() }
  ].map(s => ({ ...s, env: { ...common, HOST: '127.0.0.1', ...s.env } }))
}
const standServices = (secrets, runner, shared) => SHARE ? sharedServices(shared ?? { core: {}, make: {}, secrets: {} }) : services(secrets, runner)

let shutdownRun
let runStopping = false
const supervised = new Set()
// Core UI is this stand's front door: its Vite proxies /api straight to the stand Core. A Kanban
// devProcess passes SISLEXA_STAND_URL (the UI port itself), which would make Vite proxy to itself;
// a null value removes the variable from the child environment.
function coreUiEnv() { return { VC_API_PORT: P.core, VC_WEB_PORT: P.ui, SISLEXA_STAND_URL: null } }

function fail(message) {
  if (process.argv[2] === 'run') throw new Error(message)
  console.error('dev-stand: ' + message); process.exit(1)
}
function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts })
  if (r.status !== 0 && !opts.allowFail) fail(`${cmd} ${args.slice(0, 3).join(' ')} failed: ${(r.stderr || r.stdout || '').trim().split('\n').slice(-3).join(' | ')}`)
  return r
}
const pidFile = id => join(dirs.run, id + '.pid')
function alive(pid) { try { process.kill(pid, 0); return true } catch { return false } }
function runningPid(id) {
  try { const pid = Number(readFileSync(pidFile(id), 'utf8').trim()); return pid && alive(pid) ? pid : null } catch { return null }
}
function portOpen(p) {
  return new Promise(done => { const s = connect(p, '127.0.0.1'); s.once('connect', () => { s.destroy(); done(true) }); s.once('error', () => done(false)) })
}
async function waitHttp(p, path, ms, isAlive = () => true) {
  const until = Date.now() + ms
  while (Date.now() < until && isAlive()) {
    try { const r = await fetch(url(p) + path, { signal: AbortSignal.timeout(3000) }); if (r.status < 500) return r.status } catch {}
    await new Promise(r => setTimeout(r, 1000))
  }
  return null
}

function loadSecrets() {
  const file = join(dirs.private, 'secrets.json')
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'))
  const hex = n => randomBytes(n).toString('hex')
  const secrets = { internal: hex(32), mcp: hex(32), environment: hex(32), vpn: randomBytes(32).toString('base64'), browser: hex(24), tts: hex(24), stt: hex(24), automation: hex(24) }
  writeFileSync(file, JSON.stringify(secrets) + '\n', { mode: 0o600, flag: 'wx' })
  writeFileSync(join(dirs.private, 'session.secret'), hex(32) + '\n', { mode: 0o600, flag: 'wx' })
  return secrets
}

// Core reads its session secret from VC_DATA_DIR/session.secret; Identity must sign with the same one.
function prepareSessionSecret() {
  const target = join(dirs.data, 'core', 'session.secret')
  mkdirSync(dirname(target), { recursive: true })
  if (!existsSync(target)) writeFileSync(target, readFileSync(join(dirs.private, 'session.secret')), { mode: 0o600 })
}

function readEnvFile(file) {
  return Object.fromEntries(readFileSync(file, 'utf8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => [l.slice(0, l.indexOf('=')).replace(/^export\s+/, ''), l.slice(l.indexOf('=') + 1).replace(/^(['"])(.*)\1$/, '$2')]))
}

// The shared instance's process environment as its launcher builds it: env/secrets.env, then env/<service>.env.
function loadShared() {
  const file = name => join(SHARE, 'env', name + '.env')
  for (const name of ['secrets', 'core', 'make']) if (!existsSync(file(name))) fail(`shared instance file not found: ${file(name)} (SISLEXA_STAND_SHARE)`)
  const shared = { secrets: readEnvFile(file('secrets')), core: readEnvFile(file('core')), make: readEnvFile(file('make')) }
  for (const key of ['VC_DB_URL', 'VC_DATA_DIR', 'SISLEXA_COMPONENT_CONFIG', 'VC_MAKE_URL']) if (!shared.core[key]) fail(`${file('core')} is missing ${key}`)
  if (!shared.make.VC_CORE_URL) fail(`${file('make')} is missing VC_CORE_URL`)
  return shared
}

// Same component identities and keys as the shared instance, so its Identity, Kanban and services trust
// this Core; only the Core <-> Make links point at the stand's processes.
function prepareSharedComponents(shared) {
  const source = dirname(dirname(shared.core.SISLEXA_COMPONENT_CONFIG))
  rmSync(shareDirs.components, { recursive: true, force: true })
  // Credentials require owner-only modes on every directory; cpSync does not keep directory modes.
  sh('cp', ['-Rp', source, shareDirs.components])
  const rewrite = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) rewrite(path)
      else if (entry.name.endsWith('.json')) writeFileSync(path, readFileSync(path, 'utf8').split(source).join(shareDirs.components))
    }
  }
  rewrite(shareDirs.components)
  for (const [id, target, origin] of [['core', 'make', P.make], ['make', 'core', P.core]]) {
    const file = join(shareDirs.components, id, 'config.json')
    const config = JSON.parse(readFileSync(file, 'utf8'))
    for (const dependency of config.dependencies ?? []) if (dependency.applicationId === target) dependency.url = url(origin)
    writeFileSync(file, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 })
  }
  const secret = join(shared.core.VC_DATA_DIR, 'session.secret')
  if (!existsSync(secret)) fail(`shared session secret not found: ${secret}`)
  mkdirSync(join(shareDirs.data, 'core'), { recursive: true })
  writeFileSync(join(shareDirs.data, 'core', 'session.secret'), readFileSync(secret), { mode: 0o600 })
}

function loadRunner() {
  if (!existsSync(RUNNER_FILE)) fail(`LLM Runner configuration not found: ${RUNNER_FILE}\n  Create it (mode 600) with VC_LLM_RUNNER_CLAUDE_URL, VC_LLM_RUNNER_CODEX_URL and VC_LLM_RUNNER_TOKEN.`)
  if ((statSync(RUNNER_FILE).mode & 0o077) !== 0) fail(`${RUNNER_FILE} must not be readable by group or others (chmod 600)`)
  const values = readEnvFile(RUNNER_FILE)
  const keys = ['VC_LLM_RUNNER_CLAUDE_URL', 'VC_LLM_RUNNER_CODEX_URL', 'VC_LLM_RUNNER_TOKEN']
  const missing = keys.filter(k => !values[k])
  if (missing.length) fail(`${RUNNER_FILE} is missing ${missing.join(', ')}`)
  for (const k of keys.slice(0, 2)) if (!/^https?:\/\/[^\s/]+/.test(values[k])) fail(`${k} must be an http(s) URL`)
  return Object.fromEntries(keys.map(k => [k, values[k]]))
}

function lockHash(dir) { try { return createHash('sha256').update(readFileSync(join(dir, 'package-lock.json'))).digest('hex') } catch { return null } }
function nodeModuleDirs(root, rel = '') {
  const found = []
  for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === '.git') continue
    const child = rel ? join(rel, entry.name) : entry.name
    if (entry.name === 'node_modules') found.push(child)
    else if (!['dist', 'coverage', '.vite'].includes(entry.name) && child.split('/').length < 4) found.push(...nodeModuleDirs(root, child))
  }
  return found
}

function prepareSources() {
  for (const repo of REPOS) {
    // Kanban has already prepared this conversation's checkout and dependencies.
    const prepared = preparedSource(repo)
    if (prepared) {
      if (!existsSync(join(prepared, '.git')) || !existsSync(join(prepared, 'node_modules')))
        fail(`${SOURCE_KEYS[repo]} must be a prepared ${repo} working copy`)
      continue
    }
    const target = sourceRoot(repo)
    const origin = join(SOURCES, repo)
    if (!existsSync(join(target, '.git'))) {
      if (!existsSync(join(origin, '.git'))) fail(`owner clone not found: ${origin} (set SISLEXA_STAND_SOURCES)`)
      sh('git', ['-C', origin, 'worktree', 'add', '-B', `stand/${NAME}`, target, REF])
      console.log(`  source ${repo}: new working copy on stand/${NAME} from ${REF}`)
    }
    if (!existsSync(join(target, 'node_modules'))) {
      if (lockHash(target) && lockHash(target) === lockHash(origin) && existsSync(join(origin, 'node_modules'))) {
        // Same lockfile: clone the owner clone's installed modules (APFS clonefile, no network).
        for (const rel of nodeModuleDirs(origin)) {
          if (!existsSync(join(target, dirname(rel)))) continue
          const r = spawnSync('cp', ['-c', '-R', join(origin, rel), join(target, rel)])
          if (r.status !== 0) cpSync(join(origin, rel), join(target, rel), { recursive: true, verbatimSymlinks: true })
        }
        console.log(`  source ${repo}: dependencies cloned from ${origin}`)
      } else {
        console.log(`  source ${repo}: npm ci (lockfile differs from the owner clone)`)
        sh('npm', ['ci', '--prefer-offline', '--no-audit', '--no-fund'], { cwd: target, stdio: 'inherit' })
      }
    }
  }
}

function prepareComponents() {
  if (existsSync(join(dirs.components, 'core', 'config.json'))) return
  rmSync(dirs.components, { recursive: true, force: true })
  const origins = { core: P.core, make: P.make, 'playwright-reader': P.playwrightReader, 'web-reader': P.reader, 'image-studio': P.imageStudio,
    'stt-runner': P.stt, 'tts-runner': P.tts, identity: P.identity, billing: P.billing, analytics: P.analytics }
  const core = sourceRoot('voiceAIChat')
  sh('node', ['--import', 'tsx', 'scripts/component-installation.mjs', '--directory', dirs.components, '--environment', 'stand-' + NAME,
    ...Object.entries(origins).flatMap(([id, p]) => ['--' + id + '-url', url(p)])], { cwd: core })
  // Kanban reaches Core with the internal token; production grants these legacy scopes too.
  const file = join(dirs.components, 'core', 'config.json')
  const config = JSON.parse(readFileSync(file, 'utf8'))
  config.legacyScopes = [...new Set([...(config.legacyScopes ?? []), 'identity.verify', 'kanban.core', 'kanban.events', 'kanban.exec'])]
  writeFileSync(file, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 })
}

function psql(sql, db = DB_NAME) { return sh('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', `${PG}/${db}`, '-c', sql]).stdout.trim() }
function prepareDatabase() {
  const exists = psql(`select 1 from pg_database where datname='${DB_NAME}'`, 'postgres') === '1'
  if (exists) return
  sh('createdb', ['--maintenance-db', `${PG}/postgres`, DB_NAME])
  const seed = env.SISLEXA_STAND_SEED
  if (seed) {
    if (!existsSync(seed)) fail(`SISLEXA_STAND_SEED not found: ${seed}`)
    console.log(`  database ${DB_NAME}: restoring seed`)
    sh('pg_restore', ['--no-owner', '--no-privileges', '-j', '4', '-d', DB_URL, seed], { allowFail: true })
    // A copy never resumes production sessions, queued turns or remote machines' presence.
    psql(`do $$ begin
      if to_regclass('public.sessions') is not null then delete from sessions; end if;
      if to_regclass('public.conversation_turn_queue') is not null then delete from conversation_turn_queue; end if;
      if to_regclass('public.conversation_turn_control') is not null then delete from conversation_turn_control; end if;
      if to_regclass('public.agents') is not null then update agents set last_seen = null; end if;
    end $$`)
    // Conversation history stays out of development stands (owner decision 2026-10-25).
    if (env.SISLEXA_STAND_KEEP_CONVERSATIONS !== '1') psql(`do $$ begin
      if to_regclass('public.conversation_context_events') is not null then delete from conversation_context_events; end if;
      if to_regclass('public.assistant_orchestrations') is not null then delete from assistant_orchestrations; end if;
      if to_regclass('public.conversations') is not null then delete from conversations; end if;
    end $$`)
    const password = env.SISLEXA_STAND_USERS_PASSWORD
    if (password) {
      const salt = randomBytes(16)
      const hash = `scrypt$${salt.toString('hex')}$${scryptSync(password, salt, 32).toString('hex')}`
      psql(`update users set password_hash='${hash}', totp_secret=null, must_change_password=0, failed_logins=0, locked_until=null, lock_reason=null, blocked=0`)
    }
  } else console.log(`  database ${DB_NAME}: empty (set SISLEXA_STAND_SEED to start from a copy)`)
}

function logTail(id) {
  const file = join(dirs.logs, id + '.log')
  let fd
  try {
    const size = statSync(file).size
    const buffer = Buffer.alloc(Math.min(size, 4096))
    fd = openSync(file, 'r')
    readSync(fd, buffer, 0, buffer.length, size - buffer.length)
    return buffer.toString('utf8').split('\n').slice(-20).join('\n')
  } catch { return '' } finally { if (fd !== undefined) closeSync(fd) }
}
function serviceFailure(id, message) {
  return `${id} ${message}; ${join(dirs.logs, id + '.log')}\n${logTail(id)}`
}
function rotateLogs() {
  if (!existsSync(dirs.logs)) return
  for (const file of readdirSync(dirs.logs).filter(f => f.endsWith('.log'))) {
    const path = join(dirs.logs, file)
    if (statSync(path).size <= 8 * 1024 * 1024) continue
    // Keep the same inode: detached services hold O_APPEND descriptors.
    writeFileSync(path + '.1', logTail(file.slice(0, -4)))
    truncateSync(path, 0)
  }
}

function commitOf(dir) { return sh('git', ['-C', dir, 'rev-parse', 'HEAD']).stdout.trim() }
function versionOf(dir) { try { return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version } catch { return undefined } }

async function startService(s) {
  if (runStopping) throw new Error('stand is stopping')
  const root = sourceRoot(s.repo)
  const stateFile = join(dirs.run, s.id + '.source.json')
  // Include routing: attaching/detaching Make must also restart Core's frontend proxy.
  const signature = JSON.stringify({ root, config: createHash('sha256').update(JSON.stringify({ cmd: s.cmd, env: s.env })).digest('hex') })
  let previous
  try { previous = readFileSync(stateFile, 'utf8') } catch {}
  if (runningPid(s.id) && previous !== signature) await stopService(s.id)
  if (runningPid(s.id)) {
    if (s.id === 'core' || s.id === 'core-ui') supervised.add(s.id)
    return 'running'
  }
  if (s.port && await portOpen(s.port)) fail(`port ${s.port} for ${s.id} is used by another process; change SISLEXA_STAND_PORT_BASE / SISLEXA_STAND_UI_PORT`)
  if (runStopping) throw new Error('stand is stopping')
  const cwd = s.cwd ? join(root, s.cwd) : root
  const [api, data] = VERSIONS[s.version ?? s.frontend] ?? []
  const meta = { VC_APPLICATION_COMMIT: commitOf(root), VC_RELEASE_COMMIT: commitOf(root),
    ...(s.env.VC_APPLICATION_VERSION ? {} : { VC_APPLICATION_VERSION: versionOf(s.frontend ? join(root, s.cwd ?? `packages/${s.frontend.replace(/-ui$/, '')}-app`) : root) ?? '0.0.0' }),
    ...(api ? { VC_APPLICATION_API_VERSION: api, VC_APPLICATION_DATA_VERSION: data } : {}) }
  if (s.frontend && !s.cwd) {
    const file = join(root, 'packages', s.frontend.replace(/-ui$/, '') + '-app', 'dist', 'manifest.json')
    const manifest = JSON.parse(readFileSync(file, 'utf8'))
    for (const key of ['version', 'commit', 'apiVersion'])
      if (typeof manifest[key] !== 'string' || !manifest[key]) fail(`invalid frontend metadata ${key}: ${file}`)
    Object.assign(meta, { VC_APPLICATION_VERSION: manifest.version, VC_APPLICATION_COMMIT: manifest.commit,
      VC_RELEASE_VERSION: manifest.version, VC_RELEASE_COMMIT: manifest.commit,
      VC_APPLICATION_API_VERSION: manifest.apiVersion })
  }
  for (const [key, value] of Object.entries(s.env)) if (/_DIR$/.test(key) && typeof value === 'string' && value.startsWith(dirs.data)) mkdirSync(value, { recursive: true })
  if (s.waitFor) rmSync(join(root, s.waitFor), { force: true })
  rotateLogs()
  const out = openSync(join(dirs.logs, s.id + '.log'), 'a')
  const child = spawn(s.cmd[0], s.cmd.slice(1), { cwd, detached: true, stdio: ['ignore', out, out],
    env: Object.fromEntries(Object.entries({ ...process.env, ...s.env, ...meta }).filter(([, v]) => v !== null).map(([k, v]) => [k, String(v)])) })
  closeSync(out)
  child.once('error', error => {
    console.error(`dev-stand: ${s.id}: ${error.message}`)
    if (shutdownRun) void shutdownRun(1)
  })
  if (!child.pid) fail(`could not spawn ${s.id}`)
  writeFileSync(pidFile(s.id), String(child.pid) + '\n')
  writeFileSync(stateFile, signature, { mode: 0o600 })
  if (s.id === 'core' || s.id === 'core-ui') supervised.add(s.id)
  child.unref()
  if (s.waitFor) {
    const until = Date.now() + 180_000
    while (!existsSync(join(root, s.waitFor)) && child.exitCode === null && child.signalCode === null && Date.now() < until) await new Promise(r => setTimeout(r, 1000))
    if (!existsSync(join(root, s.waitFor))) fail(serviceFailure(s.id, `did not produce ${s.waitFor}`))
  } else if (s.port) {
    if (await waitHttp(s.port, s.health ?? '/', 180_000, () => child.exitCode === null && child.signalCode === null) === null) fail(serviceFailure(s.id, `did not answer on ${url(s.port)}`))
  }
  return 'started'
}

async function start() {
  // The component installer creates its directory itself and refuses an existing one.
  for (const d of Object.values(dirs)) if (d !== dirs.components) mkdirSync(d, { recursive: true, mode: d === dirs.private ? 0o700 : 0o755 })
  if (SHARE !== SAVED_SHARE && readdirSync(dirs.run).some(f => runningPid(f.replace(/\.pid$/, ''))))
    fail(`the stand runs in ${SAVED_SHARE ? 'shared mode with ' + SAVED_SHARE : 'isolated mode'}; run npm run dev:stand:stop before switching`)
  writeFileSync(MODE_FILE, JSON.stringify({ share: SHARE }) + '\n')
  if (SHARE) return startShared()
  const runner = loadRunner()
  const secrets = loadSecrets()
  console.log(`dev-stand ${NAME} → ${HOME}`)
  prepareSources()
  prepareComponents()
  prepareDatabase()
  prepareSessionSecret()
  for (const s of services(secrets, runner)) console.log(`  ${s.id.padEnd(26)} ${await startService(s)}${s.port ? '  ' + url(s.port) : ''}`)
  console.log(`\nUI: ${url(P.ui)}   Core: ${url(P.core)}   database: ${DB_NAME}\nStatus: npm run dev:stand:status   Stop: npm run dev:stand:stop`)
}

async function startShared() {
  const shared = loadShared()
  console.log(`dev-stand ${NAME} → ${HOME}, shared with ${SHARE}`)
  prepareSources()
  prepareSharedComponents(shared)
  const list = sharedServices(shared)
  for (const file of readdirSync(dirs.run).filter(f => f.endsWith('.pid')))
    if (!list.some(s => file === s.id + '.pid')) await stopService(file.slice(0, -4))
  for (const s of list) console.log(`  ${s.id.padEnd(26)} ${await startService(s)}${s.port ? '  ' + url(s.port) : ''}`)
  const database = new URL(shared.core.VC_DB_URL).pathname.slice(1)
  console.log(`\nUI: ${url(P.ui)}   Core: ${url(P.core)}   database: ${database} (shared with ${SHARE})\nStatus: npm run dev:stand:status   Stop: npm run dev:stand:stop`)
}

async function status() {
  if (!existsSync(dirs.run)) { console.log(`dev-stand ${NAME}: not created (${HOME})`); return }
  console.log(`dev-stand ${NAME} (${HOME}), ${SHARE ? 'shared with ' + SHARE : 'database ' + DB_NAME}`)
  let up = 0
  const list = standServices({}, {})
  for (const s of list) {
    const pid = runningPid(s.id)
    let endpoint = ''
    if (s.port) endpoint = (await portOpen(s.port)) ? `listening ${url(s.port)}` : `not listening ${url(s.port)}`
    if (pid) up++
    console.log(`  ${s.id.padEnd(26)} ${pid ? 'up pid ' + pid : 'down'}  ${endpoint}`)
  }
  console.log(`${up}/${list.length} processes up`)
  if (up && up < list.length) process.exitCode = 1
}

async function stopService(id) {
    supervised.delete(id)
    // A dead npm leader can leave watchers in its process group.
    let pid
    try { pid = Number(readFileSync(pidFile(id), 'utf8').trim()) } catch {}
    if (!Number.isInteger(pid) || pid <= 0) { rmSync(pidFile(id), { force: true }); return }
    const groupAlive = () => alive(-pid) || alive(pid)
    try { process.kill(-pid, 'SIGTERM') } catch { try { process.kill(pid, 'SIGTERM') } catch {} }
    const until = Date.now() + 10_000
    while (groupAlive() && Date.now() < until) await new Promise(r => setTimeout(r, 200))
    if (groupAlive()) try { process.kill(-pid, 'SIGKILL') } catch {}
    rmSync(pidFile(id), { force: true })
    rmSync(join(dirs.run, id + '.source.json'), { force: true })
    console.log(`  ${id} stopped`)
}

async function stop() {
  // Include services removed from the current configuration (e.g. detached Make UI).
  if (existsSync(dirs.run)) for (const file of readdirSync(dirs.run).filter(f => f.endsWith('.pid')).reverse())
    await stopService(file.slice(0, -4))
  console.log(`dev-stand ${NAME}: stopped; data kept in ${HOME}${SHARE ? '' : ' and database ' + DB_NAME}`)
}

async function run() {
  // Stay attached to the agent; detached service groups are owned by this supervisor.
  let monitor
  const logMonitor = setInterval(rotateLogs, 5000)
  logMonitor.unref()
  shutdownRun = async code => {
    if (runStopping) return
    runStopping = true
    clearInterval(monitor)
    clearInterval(logMonitor)
    try { await stop() } finally { process.exit(code) }
  }
  process.on('SIGTERM', () => { void shutdownRun(0) })
  process.on('SIGINT', () => { void shutdownRun(0) })
  monitor = setInterval(() => {
    for (const id of supervised) if (!runningPid(id)) {
      console.error(`dev-stand: ${id} exited`)
      void shutdownRun(1)
      break
    }
  }, 250)
  try { await start() } catch (error) {
    console.error('dev-stand: ' + error.message)
    await shutdownRun(1)
  }
}

const command = process.argv[2] ?? 'start'
if (command === 'run') await run()
else if (command === 'start') await start()
else if (command === 'status') await status()
else if (command === 'stop') await stop()
else fail(`unknown command ${command} (start | run | status | stop)`)
