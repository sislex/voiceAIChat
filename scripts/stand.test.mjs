import test from 'node:test'
import { scryptSync } from 'node:crypto'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parseEnv, modelConfig, clonePlan, selectedFull, doctorCommands, servicePort, basicServices, selectServices, hashStandPassword, main } from './stand.mjs'
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
    const installs = calls.filter(c => c.cmd === 'npm').length
    await main(['create'], root, runtime)
    assert.equal(calls.filter(c => c.cmd === 'gh').length, clones)
    assert.equal(calls.filter(c => c.cmd === 'npm').length, installs)
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

