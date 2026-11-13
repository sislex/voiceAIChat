import { spawnSync } from 'node:child_process'
import { createHash, randomBytes, scryptSync } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { STAND_BASE_PORT_OFFSETS as offsets } from './dev-stand-local-ports.mjs'

export function hashStandPassword(password) {
  const salt = randomBytes(16)
  return ['scrypt', salt.toString('hex'), scryptSync(password, salt, 32).toString('hex')].join(String.fromCharCode(36))
}
export const basicRepos = ['identity', 'sislexa-core-ui', 'sislexa-kanban', 'make', 'billing', 'analytics']
export const basicServices = ['identity', 'billing', 'analytics', 'core', 'kanban', 'make', 'make-ui', 'make-ui-build', 'core-ui']
export const selectServices = (services, full) => services.filter(service => full || basicServices.includes(service.id))
export const fullRepos = [...basicRepos, 'webreader', 'playwrightreader', 'image-studio', 'voice']
export function clonePlan(root, full = false) {
  return (full ? fullRepos : basicRepos).map(repo => ({ repo, source: 'sislex/' + repo, path: join(root, '.stand/repos', repo) }))
}
export function parseEnv(text) {
  const result = {}
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const match = /^(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!match) throw Error('Invalid .env line ' + (index + 1))
    let value = match[2]
    if (/^['"]/.test(value)) {
      const end = value.lastIndexOf(value[0])
      if (!end || !/^\s*(?:#.*)?$/.test(value.slice(end + 1))) throw Error('Invalid quoted .env line ' + (index + 1))
      value = value.slice(1, end)
    } else value = value.replace(/\s+#.*$/, '').trim()
    result[match[1]] = value
  }
  return result
}
export function modelConfig(env) {
  const keys = ['SISLEXA_MODEL_API_URL', 'SISLEXA_MODEL_API_TOKEN', 'VC_LLM_RUNNER_CLAUDE_URL', 'VC_LLM_RUNNER_CODEX_URL', 'VC_LLM_RUNNER_TOKEN']
  const values = Object.fromEntries(keys.filter(k => env[k]).map(k => [k, env[k]]))
  for (const [key, value] of Object.entries(values)) {
    if (key.endsWith('_URL')) {
      let url
      try { url = new URL(value) } catch {}
      if (!url || /\s/.test(value) || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error(key + ': set an HTTP(S) URL without credentials in .stand/.env')
    } else if (/\s/.test(value)) throw Error(key + ': token must not contain whitespace; edit .stand/.env')
  }
  if (values.SISLEXA_MODEL_API_TOKEN && !values.SISLEXA_MODEL_API_URL) throw Error('Set SISLEXA_MODEL_API_URL in .stand/.env')
  if (values.SISLEXA_MODEL_API_URL && !values.SISLEXA_MODEL_API_TOKEN) throw Error('Set SISLEXA_MODEL_API_TOKEN in .stand/.env')
  if (values.SISLEXA_MODEL_API_URL) {
    const url = new URL(values.SISLEXA_MODEL_API_URL)
    if (url.search || url.hash) throw Error('SISLEXA_MODEL_API_URL: query and fragment are not supported')
    const base = values.SISLEXA_MODEL_API_URL.replace(/\/+$/, '')
    return { ...values, VC_LLM_RUNNER_CLAUDE_URL: base, VC_LLM_RUNNER_CODEX_URL: base,
      VC_LLM_RUNNER_TOKEN: values.SISLEXA_MODEL_API_TOKEN, VC_CHAT_TEXT_ONLY: 'true',
      VC_CHAT_MODEL_API: 'true', VC_CHAT_REQUIRE_BILLING: 'false' }
  }
  if ((values.VC_LLM_RUNNER_CLAUDE_URL || values.VC_LLM_RUNNER_CODEX_URL) && !values.VC_LLM_RUNNER_TOKEN) throw Error('Set VC_LLM_RUNNER_TOKEN in .stand/.env')
  return values
}
export const modelApiWarning = 'Стенд: модели через API прод-Core. Инструменты моделей (Make, KB, Kanban MCP) отключены. Расход списывается с баланса пользователя токена.'
export async function doctorModels(models, fetchImpl = fetch) {
  if (!models.SISLEXA_MODEL_API_URL) return
  let response
  try {
    response = await fetchImpl(models.SISLEXA_MODEL_API_URL.replace(/\/+$/, '') + '/v1/models', {
      headers: { authorization: 'Bearer ' + models.SISLEXA_MODEL_API_TOKEN },
      redirect: 'error', signal: AbortSignal.timeout(10_000)
    })
  } catch { throw Error('API моделей недоступен. Проверьте SISLEXA_MODEL_API_URL в .stand/.env и соединение с прод-Core.') }
  if (response.status === 401) throw Error('API моделей: 401 — токен недействителен или отозван. Замените SISLEXA_MODEL_API_TOKEN в .stand/.env.')
  if (response.status === 402) throw Error('API моделей: 402 — недостаточно средств. Пополните баланс пользователя токена на проде.')
  if (!response.ok) throw Error('API моделей: HTTP ' + response.status + '. Проверьте доступ токена к моделям.')
  let body
  try { body = await response.json() } catch { throw Error('API моделей: ожидался JSON каталога. Проверьте SISLEXA_MODEL_API_URL.') }
  if (!Array.isArray(body?.models) || !body.models.length) throw Error('API моделей: нет доступных моделей. Проверьте адрес API и права пользователя токена.')
}
export const selectedFull = (args, env, saved = {}) => args.includes('--full') || env.SISLEXA_STAND_FULL === '1' || (env.SISLEXA_STAND_FULL === undefined && saved.full === true)
export function doctorCommands(version = process.versions.node, probe = (cmd, args) => spawnSync(cmd, args, { stdio: 'ignore' }).status === 0) {
  const errors = []
  if (Number(version.split('.')[0]) < 22) errors.push('Node 22+ required. Fix: nvm install 22 && nvm use 22')
  for (const [cmd, args, hint] of [
    ['git', ['--version'], 'Install git: brew install git / sudo apt-get install git'],
    ['gh', ['auth', 'status'], 'Install gh, then run: gh auth login && gh auth setup-git'],
    ['psql', ['--version'], 'Install PostgreSQL clients: brew install libpq (add bin to PATH) / sudo apt-get install postgresql-client'],
    ['createdb', ['--version'], 'Install PostgreSQL clients and add their bin directory to PATH'],
    ['dropdb', ['--version'], 'Install PostgreSQL clients and add their bin directory to PATH']
  ]) if (!probe(cmd, args)) errors.push(hint)
  return errors
}
function runCommand(cmd, args, options = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...options })
  if (r.error || r.status !== 0) throw Error(cmd + ' failed; fix the diagnostic above and retry (exit ' + (r.status ?? 1) + ')')
  return r
}
export function servicePort(id, base, ui) {
  const frontends = { 'core-ui': ui, 'web-reader-ui': ui + 9, 'playwright-reader-ui': ui + 8, 'image-studio-ui': ui + 10 }
  const aliases = { 'make-ui': 'makeUi', 'browser-runner': 'browser', 'image-studio': 'imageStudio', 'playwright-reader': 'playwrightReader' }
  return frontends[id] ?? base + offsets[aliases[id] || id]
}
async function available(port) {
  return new Promise(done => {
    const server = createServer()
    server.once('error', () => done(false))
    server.listen(port, '127.0.0.1', () => server.close(() => done(true)))
  })
}
export async function main(args = process.argv.slice(2), root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, ''), runtime = {}) {
  const execute = runtime.execute || runCommand
  const probe = runtime.spawnSync || spawnSync
  const portAvailable = runtime.available || available
  const environment = runtime.env || process.env
  const [command = 'create', ...flags] = args
  if (!['create', 'start', 'stop', 'status', 'update', 'destroy'].includes(command) || flags.some(f => !['--full', '--yes'].includes(f))) throw Error('Usage: stand create|start|stop|status|update|destroy [--full] [--yes]')
  if (command === 'destroy' && !flags.includes('--yes')) throw Error('stand:destroy requires --yes; nothing was changed')
  const home = join(root, '.stand'), envFile = join(home, '.env'), stateFile = join(home, 'settings.json')
  const saved = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {}
  const values = existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : {}
  const config = { ...values, ...Object.fromEntries(Object.entries(environment).filter(([key]) => /^(SISLEXA_STAND_|SISLEXA_MODEL_|VC_LLM_RUNNER_)/.test(key))) }
  const full = selectedFull(flags, config, saved)
  const name = config.SISLEXA_STAND_NAME || saved.name || 'local-' + createHash('sha256').update(root).digest('hex').slice(0, 10)
  if (!/^[a-z0-9][a-z0-9-]{0,30}$/.test(name)) throw Error('Set SISLEXA_STAND_NAME to lowercase letters, digits and dashes')
  if (saved.name && name !== saved.name) throw Error('Restore SISLEXA_STAND_NAME before restarting or destroying this stand')
  const models = modelConfig(config)
  if (models.SISLEXA_MODEL_API_URL) console.warn(modelApiWarning)
  if (!models.VC_LLM_RUNNER_CLAUDE_URL && !models.VC_LLM_RUNNER_CODEX_URL) console.warn('модели не настроены')
  const base = Number(config.SISLEXA_STAND_PORT_BASE || 28000), ui = Number(config.SISLEXA_STAND_UI_PORT || 25273)
  if (![base, ui].every(n => Number.isInteger(n) && n >= 1024) || base + 899 > 65535 || ui + 10 > 65535) throw Error('Set valid SISLEXA_STAND_PORT_BASE / SISLEXA_STAND_UI_PORT in .stand/.env')
  const pgFile = join(home, 'private/postgres.json')
  let pgState = existsSync(pgFile) ? JSON.parse(readFileSync(pgFile, 'utf8')) : null
  let pg = pgState?.url || config.SISLEXA_STAND_PG
  const pgReady = url => probe('psql', ['-X', url + '/postgres', '-c', 'select 1'], { stdio: 'ignore', timeout: 3000, env: { ...process.env, PGCONNECT_TIMEOUT: '2' } }).status === 0
  const waitPg = async () => {
    for (let i = 0; i < (pgState ? 30 : 1); i++) {
      if (pgReady(pg)) return
      await new Promise(done => setTimeout(done, 1000))
    }
    throw Error('Postgres connection failed. Fix SISLEXA_STAND_PG in .stand/.env; check: psql "$SISLEXA_STAND_PG/postgres" -c "select 1"')
  }
  if (pg) {
    const u = new URL(pg)
    if (!['postgres:', 'postgresql:'].includes(u.protocol) || !['', '/'].includes(u.pathname) || u.search || u.hash) throw Error('SISLEXA_STAND_PG must be a PostgreSQL server URL without database/query; edit .stand/.env')
    pg = pg.replace(/\/$/, '')
  }
  const childEnv = () => ({
    ...environment, ...config, ...models,
    SISLEXA_STAND_PORTABLE: '1', SISLEXA_STAND_FULL: full ? '1' : '0',
    SISLEXA_STAND_HOME: home, SISLEXA_STAND_NAME: name, SISLEXA_STAND_SHARE: '',
    SISLEXA_STAND_CORE_SOURCE: root, SISLEXA_STAND_CORE_UI_SOURCE: '', SISLEXA_STAND_MAKE_SOURCE: '',
    SISLEXA_STAND_PORT_BASE: String(base), SISLEXA_STAND_UI_PORT: String(ui),
    SISLEXA_STAND_PG: pg || '', SISLEXA_STAND_USERS_PASSWORD: config.SISLEXA_STAND_USERS_PASSWORD || '123',
    SISLEXA_STAND_SEED: existsSync(join(root, 'fixtures/stand/seed.sql')) ? join(root, 'fixtures/stand/seed.sql') : ''
  })
  const launch = action => execute(process.execPath, [join(root, 'scripts/dev-stand-local.mjs'), action], { cwd: root, env: childEnv() })
  const container = 'sislexa-stand-' + name
  if (command === 'status' || command === 'stop') {
    launch(command)
    if (command === 'stop' && pgState) execute('docker', ['stop', container])
    return
  }
  if (command === 'destroy') {
    if (!existsSync(home)) return
    launch('stop')
    if (pgState) execute('docker', ['start', container])
    if (pg) await waitPg()
    if (pg) execute('dropdb', ['--if-exists', '--maintenance-db', pg + '/postgres', 'sislexa_stand_' + name.replaceAll('-', '_')])
    if (pgState) {
      // Linux bind mounts retain the container's UID; restore ownership before removal.
      execute('docker', ['exec', '--user', '0', container, 'chown', '-R', String(process.getuid()) + ':' + String(process.getgid()), '/var/lib/postgresql/data'])
      execute('docker', ['rm', '-f', container])
    }
    for (const entry of readdirSync(home)) if (entry !== '.env') rmSync(join(home, entry), { recursive: true, force: true })
    return
  }
  const errors = doctorCommands(process.versions.node, (cmd, args) => probe(cmd, args, { stdio: 'ignore' }).status === 0)
  if (errors.length) throw Error(errors.join('\n'))
  mkdirSync(home, { recursive: true })
  if (!existsSync(envFile)) {
    writeFileSync(envFile, readFileSync(join(root, '.env.stand.example')), { mode: 0o600, flag: 'wx' })
    writeFileSync(stateFile, JSON.stringify({ name, full }) + '\n')
    console.log('Created .stand/.env (600). Fill SISLEXA_STAND_PG or leave empty for Docker; review ports and optional models. Then run npm run stand:create again.')
    return
  }
  chmodSync(envFile, 0o600)
  await doctorModels(models, runtime.fetch)
  if (command === 'update') launch('stop')
  const servicePorts = Object.entries(offsets).filter(([id]) => full || ['core','make','makeUi','kanban','identity','billing','analytics'].includes(id))
  const ports = [ui, ...servicePorts.map(([, n]) => base + n), ...(full ? [ui + 8, ui + 9, ui + 10] : [])]
  if (new Set(ports).size !== ports.length) throw Error('Stand ports overlap; edit SISLEXA_STAND_PORT_BASE / SISLEXA_STAND_UI_PORT')
  for (const port of ports) {
    if (await portAvailable(port)) continue
    const owned = existsSync(join(home, 'run')) && readdirSync(join(home, 'run')).filter(f => f.endsWith('.pid')).some(file => {
      const id = file.slice(0, -4)
      if (!existsSync(join(home, 'run', id + '.source.json'))) return false
      try { process.kill(Number(readFileSync(join(home, 'run', file), 'utf8')), 0) } catch { return false }
      return port === servicePort(id, base, ui)
    })
    if (!owned) throw Error('Port ' + port + ' is occupied. Edit SISLEXA_STAND_PORT_BASE / SISLEXA_STAND_UI_PORT in .stand/.env')
  }
  writeFileSync(stateFile, JSON.stringify({ name, full }) + '\n')
  mkdirSync(join(home, 'private'), { recursive: true, mode: 0o700 })
  if (pg && !pgState && !pgReady(pg)) {
    console.warn('Configured PostgreSQL is unavailable; trying an isolated Docker database. Fix SISLEXA_STAND_PG or start Docker.')
    pg = undefined
  }
  if (!pg) {
    if (probe('docker', ['info'], { stdio: 'ignore' }).status !== 0) throw Error('Set SISLEXA_STAND_PG in .stand/.env or start Docker: docker info')
    const password = randomBytes(24).toString('hex'), pgPort = base + 899
    if (!await portAvailable(pgPort)) throw Error('Docker Postgres port occupied; change SISLEXA_STAND_PORT_BASE in .stand/.env')
    pg = 'postgres://postgres:' + password + '@127.0.0.1:' + pgPort
    pgState = { url: pg }
    mkdirSync(join(home, 'data/pg'), { recursive: true })
    execute('docker', ['run', '-d', '--name', container, '-e', 'POSTGRES_PASSWORD=' + password, '-p', '127.0.0.1:' + pgPort + ':5432', '-v', join(home, 'data/pg') + ':/var/lib/postgresql/data', 'postgres:17'])
    writeFileSync(pgFile, JSON.stringify(pgState), { mode: 0o600 })
  } else if (pgState) execute('docker', ['start', container])
  await waitPg()
  const owners = clonePlan(root, command === 'update' || full).filter(item => full || basicRepos.includes(item.repo) || existsSync(join(item.path, '.git')))
  for (const item of [{ repo: 'voiceAIChat', path: root }, ...owners]) {
    if (item.source && !existsSync(join(item.path, '.git'))) execute('gh', ['repo', 'clone', item.source, item.path, '--', '--branch', 'dev'])
    if (command === 'update') {
      const branch = probe('git', ['branch', '--show-current'], { cwd: item.path, encoding: 'utf8' }).stdout?.trim()
      if (branch !== 'dev') throw Error(item.repo + ': switch to dev before stand:update: git -C "' + item.path + '" switch dev')
      execute('git', ['pull', '--ff-only', 'origin', 'dev'], { cwd: item.path })
    }
    const hash = createHash('sha256').update(readFileSync(join(item.path, 'package-lock.json'))).digest('hex'), stamp = join(home, item.repo + '.deps')
    if (!existsSync(join(item.path, 'node_modules')) || !existsSync(stamp) || readFileSync(stamp, 'utf8') !== hash) {
      execute('npm', ['ci'], { cwd: item.path })
      writeFileSync(stamp, hash)
    }
  }
  execute('npx', ['--no-install', 'playwright', 'install', 'chromium'], { cwd: full ? join(home, 'repos/playwrightreader') : root })
  writeFileSync(stateFile, JSON.stringify({ name, full }) + '\n')
  try { launch('start') } catch (error) { launch('stop'); throw error }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error('stand: ' + error.message); process.exitCode = 1 })

