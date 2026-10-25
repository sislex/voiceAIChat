#!/usr/bin/env node
// Isolated local Sislexa development stand: every application service runs from its own
// working copy in development mode (tsx watch / Vite HMR) with its own ports, Postgres
// database, data, logs, secrets and process state. Only the LLM Runner is external and
// comes from an explicit private configuration file.
//
//   npm run dev:stand            start or reuse the stand (idempotent)
//   npm run dev:stand:status     state of this stand's processes and endpoints
//   npm run dev:stand:stop       stop only this stand's processes (data is kept)
//
// Configuration (environment variables, all optional except the runner file):
//   SISLEXA_STAND_NAME          stand name, default "local" (database sislexa_stand_<name>)
//   SISLEXA_STAND_HOME          stand directory, default ~/.sislexa/stands/<name>
//   SISLEXA_STAND_SOURCES       directory with the owner clones (voiceAIChat, sislexa-core-ui, …), default ~/sislexa-dev
//   SISLEXA_STAND_REF           revision for new working copies, default origin/dev
//   SISLEXA_STAND_PORT_BASE     service port base, default 31000 (Core = base + 787)
//   SISLEXA_STAND_UI_PORT       UI port, default 35273
//   SISLEXA_STAND_PG            Postgres server URL without database, default postgres://$USER@127.0.0.1:5432
//   SISLEXA_STAND_SEED          pg_dump (custom format) restored once into a new database
//   SISLEXA_STAND_USERS_PASSWORD  test password set for every user after seeding (not a secret)
//   SISLEXA_STAND_RUNNER_FILE   private env file (mode 600) with VC_LLM_RUNNER_CLAUDE_URL,
//                               VC_LLM_RUNNER_CODEX_URL and VC_LLM_RUNNER_TOKEN,
//                               default ~/.config/sislexa/dev-stand/runner.env
import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomBytes, scryptSync } from 'node:crypto'
import { closeSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { homedir, userInfo } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const env = process.env
const NAME = env.SISLEXA_STAND_NAME || 'local'
if (!/^[a-z0-9][a-z0-9-]{0,30}$/.test(NAME)) fail('SISLEXA_STAND_NAME must be lowercase letters, digits and dashes')
const HOME = resolve(env.SISLEXA_STAND_HOME || join(homedir(), '.sislexa', 'stands', NAME))
const SOURCES = resolve(env.SISLEXA_STAND_SOURCES || join(homedir(), 'sislexa-dev'))
const REF = env.SISLEXA_STAND_REF || 'origin/dev'
const BASE = Number(env.SISLEXA_STAND_PORT_BASE || 31000)
const UI_PORT = Number(env.SISLEXA_STAND_UI_PORT || 35273)
const PG = (env.SISLEXA_STAND_PG || `postgres://${userInfo().username}@127.0.0.1:5432`).replace(/\/+$/, '')
const DB_NAME = 'sislexa_stand_' + NAME.replace(/-/g, '_')
const DB_URL = `${PG}/${DB_NAME}`
const RUNNER_FILE = resolve(env.SISLEXA_STAND_RUNNER_FILE || join(homedir(), '.config', 'sislexa', 'dev-stand', 'runner.env'))
const SELF_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dirs = { src: join(HOME, 'src'), data: join(HOME, 'data'), logs: join(HOME, 'logs'), run: join(HOME, 'run'), components: join(HOME, 'components'), private: join(HOME, 'private') }

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

const REPOS = ['voiceAIChat', 'sislexa-core-ui', 'sislexa-kanban', 'make', 'identity', 'billing', 'analytics', 'webreader', 'playwrightreader', 'image-studio', 'voice']

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
    { id: 'core-ui', repo: 'sislexa-core-ui', cmd: ['npm', 'run', 'dev'], port: P.ui, health: '/', env: { VC_API_PORT: P.core, VC_WEB_PORT: P.ui } }
  ].map(s => ({ ...s, env: { ...common, HOST: '127.0.0.1', ...s.env } }))
}

function fail(message) { console.error('dev-stand: ' + message); process.exit(1) }
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
async function waitHttp(p, path, ms) {
  const until = Date.now() + ms
  while (Date.now() < until) {
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

function loadRunner() {
  if (!existsSync(RUNNER_FILE)) fail(`LLM Runner configuration not found: ${RUNNER_FILE}\n  Create it (mode 600) with VC_LLM_RUNNER_CLAUDE_URL, VC_LLM_RUNNER_CODEX_URL and VC_LLM_RUNNER_TOKEN.`)
  if ((statSync(RUNNER_FILE).mode & 0o077) !== 0) fail(`${RUNNER_FILE} must not be readable by group or others (chmod 600)`)
  const values = Object.fromEntries(readFileSync(RUNNER_FILE, 'utf8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^(['"])(.*)\1$/, '$2')]))
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
    const target = join(dirs.src, repo)
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
  const core = join(dirs.src, 'voiceAIChat')
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

function commitOf(dir) { return sh('git', ['-C', dir, 'rev-parse', 'HEAD']).stdout.trim() }
function versionOf(dir) { try { return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version } catch { return undefined } }

async function startService(s) {
  if (runningPid(s.id)) return 'running'
  if (s.port && await portOpen(s.port)) fail(`port ${s.port} for ${s.id} is used by another process; change SISLEXA_STAND_PORT_BASE / SISLEXA_STAND_UI_PORT`)
  const root = join(dirs.src, s.repo)
  const cwd = s.cwd ? join(root, s.cwd) : root
  const [api, data] = VERSIONS[s.version ?? s.frontend] ?? []
  const meta = { VC_APPLICATION_COMMIT: commitOf(root), VC_RELEASE_COMMIT: commitOf(root),
    ...(s.env.VC_APPLICATION_VERSION ? {} : { VC_APPLICATION_VERSION: versionOf(s.frontend ? join(root, s.cwd ?? `packages/${s.frontend.replace(/-ui$/, '')}-app`) : root) ?? '0.0.0' }),
    ...(api ? { VC_APPLICATION_API_VERSION: api, VC_APPLICATION_DATA_VERSION: data } : {}) }
  if (s.frontend && !s.cwd) meta.VC_APPLICATION_VERSION = versionOf(join(root, 'packages', s.frontend.replace(/-ui$/, '') + '-app')) ?? meta.VC_APPLICATION_VERSION
  for (const [key, value] of Object.entries(s.env)) if (/_DIR$/.test(key) && typeof value === 'string' && value.startsWith(dirs.data)) mkdirSync(value, { recursive: true })
  if (s.waitFor) rmSync(join(root, s.waitFor), { force: true })
  const out = openSync(join(dirs.logs, s.id + '.log'), 'a')
  const child = spawn(s.cmd[0], s.cmd.slice(1), { cwd, detached: true, stdio: ['ignore', out, out],
    env: { ...process.env, ...Object.fromEntries(Object.entries({ ...s.env, ...meta }).map(([k, v]) => [k, String(v)])) } })
  closeSync(out)
  writeFileSync(pidFile(s.id), String(child.pid) + '\n')
  child.unref()
  if (s.waitFor) {
    const until = Date.now() + 180_000
    while (!existsSync(join(root, s.waitFor)) && Date.now() < until) await new Promise(r => setTimeout(r, 1000))
    if (!existsSync(join(root, s.waitFor))) fail(`${s.id} did not produce ${s.waitFor}; see ${join(dirs.logs, s.id + '.log')}`)
  } else if (s.port) {
    if (await waitHttp(s.port, s.health ?? '/', 180_000) === null) fail(`${s.id} did not answer on ${url(s.port)}; see ${join(dirs.logs, s.id + '.log')}`)
  }
  return 'started'
}

async function start() {
  // The component installer creates its directory itself and refuses an existing one.
  for (const d of Object.values(dirs)) if (d !== dirs.components) mkdirSync(d, { recursive: true, mode: d === dirs.private ? 0o700 : 0o755 })
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

async function status() {
  if (!existsSync(dirs.run)) { console.log(`dev-stand ${NAME}: not created (${HOME})`); return }
  console.log(`dev-stand ${NAME} (${HOME}), database ${DB_NAME}`)
  let up = 0
  const list = services({}, {})
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

async function stop() {
  const list = services({}, {}).reverse()
  for (const s of list) {
    const pid = runningPid(s.id)
    if (!pid) { rmSync(pidFile(s.id), { force: true }); continue }
    try { process.kill(-pid, 'SIGTERM') } catch { try { process.kill(pid, 'SIGTERM') } catch {} }
    const until = Date.now() + 10_000
    while (alive(pid) && Date.now() < until) await new Promise(r => setTimeout(r, 200))
    if (alive(pid)) try { process.kill(-pid, 'SIGKILL') } catch {}
    rmSync(pidFile(s.id), { force: true })
    console.log(`  ${s.id} stopped`)
  }
  console.log(`dev-stand ${NAME}: stopped; data kept in ${HOME} and database ${DB_NAME}`)
}

const command = process.argv[2] ?? 'start'
if (command === 'start') await start()
else if (command === 'status') await status()
else if (command === 'stop') await stop()
else fail(`unknown command ${command} (start | status | stop)`)
