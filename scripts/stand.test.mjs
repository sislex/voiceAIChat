import test from 'node:test'
import { scryptSync } from 'node:crypto'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parseEnv, modelConfig, clonePlan, selectedFull, doctorCommands, servicePort, basicServices, selectServices, hashStandPassword, main, doctorModels, modelApiWarning, prebuildNeeded, portableRunner, UNCONFIGURED_RUNNER_URL } from './stand.mjs'
import { walkFiles } from './test-files.mjs'
import { selectAffected } from './affected-check.mjs'

test('stand passwords use Identity scrypt wire format with a fresh salt', () => {
  const hash = hashStandPassword('123')
  const [scheme, salt, digest] = hash.split(String.fromCharCode(36))
  assert.equal(scheme, 'scrypt')
  assert.equal(salt.length, 32)
  assert.equal(digest, scryptSync('123', Buffer.from(salt, 'hex'), 32).toString('hex'))
  assert.notEqual(hashStandPassword('123'), hash)
})
test('dotenv accepts export, CRLF, quotes, comments and literal shell syntax', () => {
  assert.deepEqual(parseEnv('# hi\r\nexport A="x # y" # comment\r\nB=abc # comment\nC=\nD=$(no-execution)'), { A: 'x # y', B: 'abc', C: '', D: '$(no-execution)' })
  assert.throws(() => parseEnv('BAD LINE'), /line 1/)
  assert.throws(() => parseEnv('A="unclosed'), /quoted/)
})
test('model settings are optional, validated and never echoed in errors', () => {
  assert.deepEqual(modelConfig({}), {})
  assert.throws(() => modelConfig({ SISLEXA_MODEL_API_URL: 'file:///private' }), /HTTP/)
  assert.throws(() => modelConfig({ SISLEXA_MODEL_API_URL: 'https://example.org' }), /TOKEN/)
  assert.throws(() => modelConfig({ VC_LLM_RUNNER_TOKEN: 'secret whitespace' }), error => !error.message.includes('secret'))
})
test('model API overrides direct runners and forces text-only execution without local billing', () => {
  const config = modelConfig({ SISLEXA_MODEL_API_URL: 'https://core.test/api/model-runner/',
    SISLEXA_MODEL_API_TOKEN: 'workspace-token', VC_LLM_RUNNER_CLAUDE_URL: 'http://local:8080' })
  assert.equal(config.VC_LLM_RUNNER_CLAUDE_URL, 'https://core.test/api/model-runner')
  assert.equal(config.VC_LLM_RUNNER_CODEX_URL, config.VC_LLM_RUNNER_CLAUDE_URL)
  assert.equal(config.VC_LLM_RUNNER_TOKEN, 'workspace-token')
  assert.equal(config.VC_CHAT_MODEL_API, 'true')
  assert.equal(config.VC_CHAT_TEXT_ONLY, 'true')
  assert.equal(config.VC_CHAT_REQUIRE_BILLING, 'false')
  assert.throws(() => modelConfig({ SISLEXA_MODEL_API_TOKEN: 'token' }), /URL/)
  assert.throws(() => modelConfig({ SISLEXA_MODEL_API_URL: 'https://core.test/?token=secret', SISLEXA_MODEL_API_TOKEN: 'token' }), /query/)
})
test('doctor probes the prefixed model catalog, handles auth/balance and never echoes secrets', async () => {
  const config = { SISLEXA_MODEL_API_URL: 'https://core.test/api/model-runner/', SISLEXA_MODEL_API_TOKEN: 'private-token' }
  await doctorModels(config, async (url, options) => {
    assert.equal(url, 'https://core.test/api/model-runner/v1/models')
    assert.equal(options.headers.authorization, 'Bearer private-token')
    assert.equal(options.redirect, 'error')
    return Response.json({ models: [{ id: 'model' }] })
  })
  for (const [status, message] of [[401, /токен недействителен/], [402, /недостаточно средств/], [403, /доступ токена/], [500, /HTTP 500/]]) {
    await assert.rejects(doctorModels(config, async () => new Response('', { status })), message)
  }
  await assert.rejects(doctorModels(config, async () => { throw Error('private-token') }), e => !e.message.includes('private-token'))
  await assert.rejects(doctorModels(config, async () => Response.json({ models: [] })), /нет доступных моделей/)
  await assert.rejects(doctorModels(config, async () => new Response('<html>')), /ожидался JSON/)
  await doctorModels({}, async () => { throw Error('must not probe') })
})
test('status forwards API credentials to the launcher and warns without a network request', async () => {
  const root = mkdtempSync(join(tmpdir(), 'stand-api-')), calls = [], warnings = []
  const warn = console.warn
  console.warn = value => warnings.push(value)
  try {
    mkdirSync(join(root, '.stand'))
    writeFileSync(join(root, '.stand/.env'), 'SISLEXA_MODEL_API_URL=https://core.test/api/model-runner\nSISLEXA_MODEL_API_TOKEN=private-token')
    await main(['status'], root, { env: {}, execute: (...args) => calls.push(args) })
    assert.equal(calls[0][2].env.VC_LLM_RUNNER_TOKEN, 'private-token')
    assert.equal(calls[0][2].env.VC_CHAT_MODEL_API, 'true')
    assert.ok(warnings.includes(modelApiWarning))
    assert.ok(!warnings.join('').includes('private-token'))
  } finally { console.warn = warn; rmSync(root, { recursive: true, force: true }) }
})
test('doctor returns actionable failures without network', () => {
  const errors = doctorCommands('20.1.0', () => false)
  assert.match(errors.join('\n'), /nvm install 22/)
  assert.match(errors.join('\n'), /gh auth login/)
  assert.match(errors.join('\n'), /postgresql-client/)
  assert.deepEqual(doctorCommands('22.0.0', () => true), [])
})
test('doctor CLI exits nonzero with repair commands when tools are absent', () => {
  const result = spawnSync(process.execPath, [join(import.meta.dirname, 'stand.mjs'), 'create'], { encoding: 'utf8', env: { PATH: '' } })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /gh auth login/)
  assert.match(result.stderr, /postgresql-client/)
})
test('clone plan uses owner repositories under .stand and never clones Core', () => {
  const basic = clonePlan('/tmp/core')
  assert.ok(basic.every(item => item.path.startsWith('/tmp/core/.stand/repos/') && item.source === 'sislex/' + item.repo))
  assert.ok(!basic.some(item => item.repo === 'voiceAIChat'))
  assert.ok(basic.some(item => item.repo === 'make'))
  assert.ok(clonePlan('/tmp/core', true).length > basic.length)
})
test('all full-profile service aliases retain their port ownership on repeated create', () => {
  assert.equal(servicePort('browser-runner', 40000, 43000), 40793)
  assert.equal(servicePort('image-studio', 40000, 43000), 40796)
  assert.equal(servicePort('playwright-reader', 40000, 43000), 40797)
  assert.equal(servicePort('make-ui', 40000, 43000), 40802)
  assert.equal(servicePort('web-reader-ui', 40000, 43000), 43009)
})
test('basic services contain only the main apps and required managed dependencies', () => {
  const all = [...basicServices, 'reader', 'browser-runner', 'tts'].map(id => ({ id }))
  assert.deepEqual(selectServices(all, false).map(s => s.id), basicServices)
  assert.deepEqual(selectServices(all, true), all)
})
test('service profile persists and accepts explicit full override', () => {
  assert.equal(selectedFull([], {}), false)
  assert.equal(selectedFull(['--full'], {}), true)
  assert.equal(selectedFull([], {}, { full: true }), true)
  assert.equal(selectedFull([], { SISLEXA_STAND_FULL: '0' }, { full: true }), false)
})
test('destroy refuses before reading malformed env or deleting files, CLI exits nonzero', async () => {
  const root = mkdtempSync(join(tmpdir(), 'stand-test-'))
  try {
    mkdirSync(join(root, '.stand'))
    writeFileSync(join(root, '.stand/.env'), 'malformed')
    await assert.rejects(main(['destroy'], root), /--yes/)
    assert.equal(readFileSync(join(root, '.stand/.env'), 'utf8'), 'malformed')
    const cli = spawnSync(process.execPath, [join(import.meta.dirname, 'stand.mjs'), 'destroy'], { encoding: 'utf8' })
    assert.equal(cli.status, 1)
    assert.match(cli.stderr, /--yes/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
test('create twice reuses clones/dependencies; update pulls dev; destroy preserves only env', async () => {
  const root = mkdtempSync(join(tmpdir(), 'stand-lifecycle-')), calls = []
  const runtime = {
    env: {},
    available: async () => true,
    spawnSync: () => ({ status: 0, stdout: 'dev\n' }),
    execute: (cmd, args, options = {}) => {
      calls.push({ cmd, args, options })
      if (cmd === 'gh') {
        const target = args[3]
        mkdirSync(join(target, '.git'), { recursive: true })
        writeFileSync(join(target, 'package-lock.json'), '{}')
      }
      if (cmd === 'npm') mkdirSync(join(options.cwd, 'node_modules'), { recursive: true })
    }
  }
  try {
    writeFileSync(join(root, '.env.stand.example'), 'SISLEXA_STAND_PG=postgres://test@localhost:5432\nSISLEXA_STAND_PORT_BASE=40000\nSISLEXA_STAND_UI_PORT=43000')
    writeFileSync(join(root, 'package-lock.json'), '{}')
    await main(['create', '--full'], root, runtime)
    assert.equal(JSON.parse(readFileSync(join(root, '.stand/settings.json'), 'utf8')).full, true)
    assert.equal(statSync(join(root, '.stand/.env')).mode & 0o777, 0o600)
    assert.equal(calls.length, 0)
    await main(['create'], root, runtime)
    const clones = calls.filter(c => c.cmd === 'gh').length
    assert.equal(clones, clonePlan(root, true).length)
    assert.ok(calls.filter(c => c.cmd === 'gh').every(c => c.args.slice(-2).join(' ') === '--branch dev'))
    const ci = () => calls.filter(c => c.cmd === 'npm' && c.args[0] === 'ci').length
    const installs = ci()
    // A fresh Identity clone has no built login/account pages; its server refuses to start without them.
    const identityBuilds = () => calls.filter(c => c.cmd === 'npm' && c.args.join(' ') === 'run build:ui' && c.options.cwd.endsWith('/.stand/repos/identity')).length
    assert.equal(identityBuilds(), 1)
    await main(['create'], root, runtime)
    assert.equal(calls.filter(c => c.cmd === 'gh').length, clones)
    assert.equal(ci(), installs)
    const launches = calls.filter(c => c.cmd === process.execPath && c.args[1] === 'start')
    assert.equal(launches.length, 2)
    assert.equal(launches[0].options.env.SISLEXA_STAND_CORE_SOURCE, root)
    assert.equal(launches[0].options.env.SISLEXA_STAND_USERS_PASSWORD, '123')
    await main(['update'], root, runtime)
    assert.equal(calls.filter(c => c.cmd === 'git' && c.args.join(' ') === 'pull --ff-only origin dev').length, clones + 1)
    await main(['destroy', '--yes'], root, runtime)
    assert.ok(existsSync(join(root, '.stand/.env')))
    assert.ok(!existsSync(join(root, '.stand/repos')))
    assert.equal(calls.filter(c => c.cmd === 'dropdb').length, 1)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('gate tree walk and affected selection exclude nested stand tests', () => {
  const root = mkdtempSync(join(tmpdir(), 'stand-gate-'))
  try {
    mkdirSync(join(root, '.stand/repos/x'), { recursive: true })
    writeFileSync(join(root, '.stand/repos/x/a.test.ts'), 'throw Error("must not run")')
    writeFileSync(join(root, 'real.test.ts'), '')
    assert.deepEqual(walkFiles(root), [join(root, 'real.test.ts')])
    assert.deepEqual(selectAffected(['.stand/repos/x/a.test.ts']).packages, [])
  } finally { rmSync(root, { recursive: true, force: true }) }
})


test('owner prebuild runs for a fresh or updated Identity clone and is skipped once its pages exist', () => {
  const built = () => true, missing = () => false
  assert.equal(prebuildNeeded('identity', '/stand/identity', { exists: missing }), 'build:ui')
  assert.equal(prebuildNeeded('identity', '/stand/identity', { exists: built }), null)
  assert.equal(prebuildNeeded('identity', '/stand/identity', { installed: true, exists: built }), 'build:ui')
  assert.equal(prebuildNeeded('make', '/stand/make', { exists: missing }), null)
})

test('a stand without models still gets runner settings so every service can start', () => {
  const bare = portableRunner({})
  assert.equal(bare.configured, false)
  assert.deepEqual(bare.values, { VC_LLM_RUNNER_CLAUDE_URL: UNCONFIGURED_RUNNER_URL, VC_LLM_RUNNER_CODEX_URL: UNCONFIGURED_RUNNER_URL, VC_LLM_RUNNER_TOKEN: 'models-not-configured' })
  const direct = portableRunner({ VC_LLM_RUNNER_CLAUDE_URL: 'http://runner:8790', VC_LLM_RUNNER_TOKEN: 't' })
  assert.equal(direct.configured, true)
  assert.equal(direct.values.VC_LLM_RUNNER_CLAUDE_URL, 'http://runner:8790')
})
