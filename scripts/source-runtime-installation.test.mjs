import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repository = dirname(dirname(fileURLToPath(import.meta.url)))
const helper = join(repository, 'scripts/prod/source-runtime.py')
const installer = readFileSync(join(repository, 'scripts/prod/install.sh'), 'utf8')
const template = installer.match(/cat >\/usr\/local\/bin\/voicechat-deploy <<'EOF'\n([\s\S]*?)\nEOF/)[1]
const fixtureScript = `#!/usr/bin/env python3
import json, os, pathlib, subprocess, sys, time
here = pathlib.Path(__file__).parent
if os.environ.get('DETACH') == '1' and os.environ.get('FIXTURE_CHILD') != '1':
    child = subprocess.Popen([sys.executable, __file__, *sys.argv[1:]],
        env={**os.environ, 'FIXTURE_CHILD': '1'}, start_new_session=True,
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print(json.dumps({'pid': child.pid, 'runtime': str(here)}))
    sys.exit(0)
if os.environ.get('FIXTURE_CHILD') == '1':
    pathlib.Path(os.environ['READY']).write_text('ready')
    deadline = time.monotonic() + 10
    while not pathlib.Path(os.environ['CONTINUE']).exists():
        if time.monotonic() > deadline: sys.exit(90)
        time.sleep(.01)
companion = here / 'source-recovery.py'
result = json.dumps({'runtime': str(here), 'helper': companion.read_bytes().hex() if companion.exists() else None,
    'argv': sys.argv[1:], 'repo': os.environ['VC_REPO_DIR'],
    'version': os.environ['VC_RELEASE_VERSION'], 'source': os.environ['VC_RELEASE_VERSION_SOURCE']})
if os.environ.get('FIXTURE_CHILD') == '1': pathlib.Path(os.environ['OUT']).write_text(result)
else: print(result)
`
const quote = value => `'${value.replaceAll("'", "'\\''")}'`

function setup(t, { companion = Buffer.from('# companion\r\n\x00exact bytes\xff', 'latin1'), mode = 0o644 } = {}) {
  // Use the assigned attempt, or this checkout, never the host installation.
  const base = process.env.DELIVERY_ATTEMPT_ROOT ? join(process.env.DELIVERY_ATTEMPT_ROOT, 'tmp') : repository
  const root = realpathSync(mkdtempSync(join(base, 'source-runtime-test-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const source = join(root, 'checkout with spaces', 'scripts', 'prod')
  const store = join(root, 'store')
  mkdirSync(source, { recursive: true }); mkdirSync(store)
  writeFileSync(join(source, 'deploy.sh'), fixtureScript, { mode: 0o755 })
  if (companion !== null) writeFileSync(join(source, 'source-recovery.py'), companion, { mode })
  copyFileSync(helper, join(store, 'source-runtime.py'))
  const repo = dirname(dirname(source))
  const config = join(root, 'production.env')
  writeFileSync(config, `VC_REPO_DIR=${quote(repo)}\n`)
  const wrapper = join(root, 'voicechat-deploy')
  writeFileSync(wrapper, template.replaceAll('/etc/voicechat/production.env', config)
    .replaceAll('/usr/local/lib/voicechat', store), { mode: 0o755 })
  // Fixtures need only system Bash/Python; do not search user credential/tool paths.
  const env = { ...process.env, PATH: '/usr/bin:/bin', TMPDIR: root, VC_SOURCE_RECOVERY_REQUIRED: '0',
    VC_RELEASE_VERSION: '1.2.3 test', VC_RELEASE_VERSION_SOURCE: 'protected release', DETACH: '0' }
  const run = (args = [], extra = {}) => spawnSync('bash', [wrapper, ...args], { env: { ...env, ...extra }, encoding: 'utf8', timeout: 15000 })
  return { root, source, store, wrapper, repo, env, run }
}
function success(result) {
  assert.equal(result.status, 0, result.stderr || String(result.error))
  return JSON.parse(result.stdout)
}
function rejected(result) {
  assert.equal(result.status, 78, result.stderr)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /source runtime rejected/)
}
function asyncRun(f, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', [f.wrapper, ...args], { env: f.env, timeout: 15000 })
    let stdout = '', stderr = ''
    child.stdout.on('data', value => { stdout += value }); child.stderr.on('data', value => { stderr += value })
    child.on('error', reject)
    child.on('close', status => resolve({ status, stdout, stderr }))
  })
}
async function until(path) {
  for (let i = 0; i < 500; i++) {
    if (existsSync(path)) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.fail(`Timed out waiting for ${path}`)
}

test('generated wrapper preserves exact paired bytes, modes, metadata and argv', t => {
  const f = setup(t)
  const args = ['--release-version', 'space and $literal', '', '--operation-id', 'id-1']
  const result = success(f.run(args))
  assert.deepEqual(result.argv, args)
  assert.equal(result.repo, f.repo)
  assert.equal(result.version, f.env.VC_RELEASE_VERSION)
  assert.equal(result.source, f.env.VC_RELEASE_VERSION_SOURCE)
  for (const name of ['deploy.sh', 'source-recovery.py']) {
    assert.deepEqual(readFileSync(join(result.runtime, name)), readFileSync(join(f.source, name)))
    assert.equal(statSync(join(result.runtime, name)).mode & 0o777, name === 'deploy.sh' ? 0o755 : 0o644)
  }
  const manifest = readFileSync(join(result.runtime, 'manifest.json'))
  assert.equal(result.runtime, join(f.store, `source-${createHash('sha256').update(manifest).digest('hex')}`))
  assert.equal(success(f.run()).runtime, result.runtime)
  assert.equal(statSync(result.runtime).mode & 0o022, 0)
})

test('helper changes, executable mode and absence have distinct identities', t => {
  const f = setup(t, { companion: null })
  const legacy = success(f.run())
  assert.equal(legacy.helper, null)
  assert.equal(JSON.parse(readFileSync(join(legacy.runtime, 'manifest.json'))).files['source-recovery.py'], null)
  const path = join(f.source, 'source-recovery.py')
  writeFileSync(path, '', { mode: 0o644 })
  const empty = success(f.run())
  writeFileSync(path, '# changed\n')
  const changed = success(f.run())
  chmodSync(path, 0o755)
  const executable = success(f.run())
  assert.equal(new Set([legacy.runtime, empty.runtime, changed.runtime, executable.runtime]).size, 4)
  assert.equal(statSync(join(executable.runtime, 'source-recovery.py')).mode & 0o777, 0o755)
  assert.equal(readFileSync(join(empty.runtime, 'source-recovery.py')).length, 0)
})

test('v2 source requests cannot launch a legacy runtime without its companion', t => {
  const f = setup(t, { companion: null })
  success(f.run()) // Existing legacy runtime must not bypass the v2 requirement.
  rejected(f.run(['--source-request', '/protected/request.json']))
  writeFileSync(join(f.source, 'source-recovery.py'), '# reviewed companion\n')
  assert.deepEqual(success(f.run(['--source-request', '/protected/request.json'])).argv,
    ['--source-request', '/protected/request.json'])
})

test('required missing helper fails before launching, legacy requests still run', t => {
  const f = setup(t, { companion: null })
  const result = f.run([], { VC_SOURCE_RECOVERY_REQUIRED: '1' })
  rejected(result)
  assert.match(result.stderr, /required companion source-recovery.py is absent/)
  assert.deepEqual(readdirSync(f.store), ['source-runtime.py'])
  success(f.run())
  rejected(f.run([], { VC_SOURCE_RECOVERY_REQUIRED: 'invalid' }))
  writeFileSync(join(f.source, 'source-recovery.py'), '# required companion\n')
  success(f.run([], { VC_SOURCE_RECOVERY_REQUIRED: '1' }))
})

test('concurrent creation and replay produce one complete runtime', async t => {
  const f = setup(t)
  const first = (await Promise.all(Array.from({ length: 12 }, () => asyncRun(f)))).map(success)
  const replay = (await Promise.all(Array.from({ length: 12 }, () => asyncRun(f)))).map(success)
  assert.equal(new Set([...first, ...replay].map(result => result.runtime)).size, 1)
  assert.deepEqual(readdirSync(f.store).sort(), [first[0].runtime.split('/').at(-1), 'source-runtime.py'].sort())
})

test('tampered, symlinked, partial and unsafe runtimes are rejected without repair', async t => {
  const attacks = {
    bytes: (runtime) => writeFileSync(join(runtime, 'source-recovery.py'), 'corrupt'),
    manifest: (runtime) => { chmodSync(join(runtime, 'manifest.json'), 0o644); writeFileSync(join(runtime, 'manifest.json'), '{}'); chmodSync(join(runtime, 'manifest.json'), 0o444) },
    partial: (runtime) => rmSync(join(runtime, 'source-recovery.py')),
    empty: (runtime) => { rmSync(runtime, { recursive: true }); mkdirSync(runtime) },
    symlinkFile: (runtime, f) => { rmSync(join(runtime, 'source-recovery.py')); symlinkSync(join(f.source, 'source-recovery.py'), join(runtime, 'source-recovery.py')) },
    symlinkDirectory: (runtime, f) => { rmSync(runtime, { recursive: true }); symlinkSync(f.source, runtime) },
    mode: (runtime) => chmodSync(join(runtime, 'deploy.sh'), 0o777),
    directoryMode: (runtime) => chmodSync(runtime, 0o777),
    extra: (runtime) => writeFileSync(join(runtime, 'unexpected'), 'partial'),
  }
  for (const [name, attack] of Object.entries(attacks)) await t.test(name, t => {
    const f = setup(t)
    const { runtime } = success(f.run())
    attack(runtime, f)
    rejected(f.run()); rejected(f.run())
    if (name === 'bytes') assert.equal(readFileSync(join(runtime, 'source-recovery.py'), 'utf8'), 'corrupt')
    if (name === 'empty') assert.deepEqual(readdirSync(runtime), [])
  })
})

test('symlinked sources and runtime store are rejected', t => {
  const f = setup(t)
  const sourceHelper = join(f.source, 'source-recovery.py')
  rmSync(sourceHelper); symlinkSync(join(f.root, 'missing'), sourceHelper)
  rejected(f.run())
  rmSync(sourceHelper)
  const storeAlias = join(f.root, 'alias'); symlinkSync(f.store, storeAlias)
  writeFileSync(f.wrapper, readFileSync(f.wrapper, 'utf8').replaceAll(f.store, storeAlias))
  rejected(f.run())
})

test('copied hash mismatch aborts publication (actual helper process with write fault)', t => {
  const f = setup(t)
  const driver = `import importlib.util, pathlib, sys
spec = importlib.util.spec_from_file_location('runtime', sys.argv[1])
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
original = module.verify
def corrupt(path, pair, manifest):
    if path.name.startswith('.source-'):
        (path / 'source-recovery.py').write_bytes(b'bad copy')
    original(path, pair, manifest)
module.verify = corrupt
try: module.pin(pathlib.Path(sys.argv[2]), pathlib.Path(sys.argv[3]), False)
except ValueError as error:
    print(str(error), file=sys.stderr); sys.exit(78)
`
  const result = spawnSync('python3', ['-B', '-c', driver, helper, f.source, f.store], { env: f.env, encoding: 'utf8' })
  assert.equal(result.status, 78, result.stderr)
  assert.match(result.stderr, /copied hash mismatch/)
  assert.deepEqual(readdirSync(f.store), ['source-runtime.py'])
})

test('detached operation keeps selected deploy and companion across checkout updates', async t => {
  const f = setup(t)
  const ready = join(f.root, 'ready'), proceed = join(f.root, 'continue'), out = join(f.root, 'out')
  const launch = success(f.run(['literal arg'], { DETACH: '1', READY: ready, CONTINUE: proceed, OUT: out }))
  t.after(() => { try { process.kill(launch.pid, 'SIGTERM') } catch {} })
  await until(ready)
  const oldHelper = readFileSync(join(f.source, 'source-recovery.py')).toString('hex')
  writeFileSync(join(f.source, 'deploy.sh'), fixtureScript + '\n# new launcher\n')
  writeFileSync(join(f.source, 'source-recovery.py'), '# new companion\n')
  const next = success(f.run())
  assert.notEqual(next.runtime, launch.runtime)
  writeFileSync(proceed, 'continue')
  await until(out)
  const detached = JSON.parse(readFileSync(out, 'utf8'))
  assert.equal(detached.runtime, launch.runtime)
  assert.equal(detached.helper, oldHelper)
  assert.deepEqual(detached.argv, ['literal arg'])
  assert.equal(readFileSync(join(launch.runtime, 'deploy.sh'), 'utf8'), fixtureScript)
})
