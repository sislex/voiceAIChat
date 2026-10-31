import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { loadConfig, packageDirectories } from './config.mjs'
const core = resolve(import.meta.dirname, '../..')
const cli = join(import.meta.dirname, 'cli.mjs')
function run(cwd, command, args, status = 0) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', env: { ...process.env, VC_KB_MACHINE: 'test' } })
  assert.equal(result.status, status, `${command} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`)
  return result.stdout
}
function temp(t) {
  const root = mkdtempSync(join(process.env.DELIVERY_ATTEMPT_ROOT ? join(process.env.DELIVERY_ATTEMPT_ROOT, 'tmp') : tmpdir(), 'kb-tools-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}
function write(root, path, body) {
  mkdirSync(resolve(root, path, '..'), { recursive: true })
  writeFileSync(join(root, path), body)
}
const topic = '---\ntitle: Widget\nupdated: 2000-01-01\nareas:\n  - source.txt\n---\n# Widget\nWidget frobnication instructions.\n'
for (const defaults of [false, true]) test(`every subcommand: ${defaults ? 'Core without config' : 'configured module'}`, t => {
  const root = temp(t)
  if (defaults) {
    cpSync(join(core, 'docs/kb'), join(root, 'docs/kb'), { recursive: true })
    cpSync(join(core, 'AGENTS.md'), join(root, 'AGENTS.md'))
  } else write(root, 'kb.config.json', JSON.stringify({ kbDir: 'knowledge', packageGlobs: [], indexTitle: 'Module KB', logDir: 'journal', indexPath: 'navigation/INDEX.md', generatedIndexPath: 'output/search' }))
  const kb = defaults ? 'docs/kb' : 'knowledge'
  const index = defaults ? 'docs/kb/README.md' : 'navigation/INDEX.md'
  const out = defaults ? 'generated/kb' : 'output/search'
  write(root, `${kb}/widget.md`, topic.replace('areas:', 'checked: \nareas:'))
  write(root, 'source.txt', 'hello')
  run(root, 'git', ['init', '-q'])
  run(root, 'git', ['add', '.'])
  run(root, 'git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture'])
  const kbRun = (...args) => run(root, process.execPath, [cli, ...args])
  kbRun('touch', 'widget')
  assert.match(readFileSync(join(root, kb, 'widget.md'), 'utf8'), /checked: [a-f0-9]+/)
  assert.match(readFileSync(join(root, kb, 'widget.md'), 'utf8'), /\nareas:\n  - source.txt/ )
  kbRun('log', 'session')
  kbRun('index')
  assert.match(readFileSync(join(root, index), 'utf8'), defaults ? /База знаний voiceAIChat/ : /Module KB/)
  kbRun('check')
  if (!defaults) kbRun('check', '--strict')
  kbRun()
  kbRun('prepare')
  kbRun('verify')
  const documents = JSON.parse(readFileSync(join(root, out, 'documents.json'), 'utf8'))
  assert.ok(documents.some(d => d.title === 'Widget'))
  assert.ok(!documents.some(d => d.sourcePath === index || d.title === 'session'))
  for (const command of ['search', 'context']) {
    const hits = JSON.parse(kbRun(command, 'frobnication', '--json'))
    assert.equal(hits[0].documentId, 'widget')
    assert.deepEqual(JSON.parse(kbRun(command, 'zzzznomatchzzzz', '--json')), [])
  }
  write(root, 'source.txt', 'changed')
  assert.match(kbRun('impact'), /widget.md —/)
  run(root, process.execPath, [cli, 'unknown'], 1)
  if (!defaults) {
    write(root, `${kb}/broken.md`, '---\nupdated: 2026-01-01\n---\n[bad](missing.md)')
    run(root, process.execPath, [cli, 'check', '--strict'], 1)
    run(root, process.execPath, [cli, 'verify'], 1)
  }
})
for (const kb of ['docs/kb', 'knowledge/nested topics']) {
  for (const scenario of ['same-commit update', 'later code-only commit', 'touch-only commit']) {
    test(`freshness: ${scenario} (${kb})`, t => {
      const root = temp(t)
      if (kb !== 'docs/kb') write(root, 'kb.config.json', JSON.stringify({ kbDir: kb, packageGlobs: [] }))
      write(root, `${kb}/widget.md`, topic)
      write(root, 'source.txt', 'initial')
      run(root, 'git', ['init', '-q'])
      const commit = message => {
        run(root, 'git', ['add', '.'])
        run(root, 'git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', message])
      }
      const kbRun = (...args) => run(root, process.execPath, [cli, ...args])
      commit('fixture')
      kbRun('touch', 'widget')
      commit('initial check')
      if (scenario !== 'touch-only commit') write(root, 'source.txt', 'updated with topic')
      kbRun('touch', 'widget')
      commit(scenario)
      if (scenario === 'later code-only commit') {
        write(root, 'source.txt', 'later code change')
        // Updating another topic must not hide changes to this topic's areas.
        write(root, `${kb}/other.md`, '---\ntitle: Other\nupdated: 2000-01-01\n---\n# Other\n')
        commit('later source change')
        const output = run(root, process.execPath, [cli, 'check', '--strict'], 1)
        assert.match(output, /1 коммит\(ов\) в areas после проверенного SHA:/)
        assert.match(output, /later source change/)
      } else {
        kbRun('check', '--strict')
      }
    })
  }
}
test('package globs, empty list, validation and nested invocation', t => {
  const root = temp(t)
  write(root, 'kb.config.json', JSON.stringify({ packageGlobs: ['modules/**'] }))
  write(root, 'modules/group/a/package.json', '{}')
  assert.ok(packageDirectories(root, ['modules/**']).includes('modules/group/a'))
  assert.deepEqual(packageDirectories(root, []), [])
  assert.equal(loadConfig(join(root, 'modules/group/a')).root, root)
  assert.match(run(root, process.execPath, [cli, 'check', '--strict'], 1), /modules\/group\/a/)
  write(root, 'kb.config.json', '{"kbDir":"knowledge","packageGlobs":[]}')
  const minimal = loadConfig(root)
  assert.equal(minimal.logDir, 'knowledge/log')
  assert.equal(minimal.indexPath, 'knowledge/README.md')
  run(root, process.execPath, [cli, 'check', '--strict'])
  for (const generatedIndexPath of ['.', 'knowledge']) {
    write(root, 'kb.config.json', JSON.stringify({ kbDir: 'knowledge', generatedIndexPath }))
    run(root, process.execPath, [cli, 'prepare'], 1)
  }
  write(root, 'kb.config.json', '{"kbDir":"../outside"}')
  run(root, process.execPath, [cli, 'check'], 1)
})

test('strict stale-topic list preserves the workflow parser footer delimiter', t => {
  const root = temp(t)
  write(root, 'kb.config.json', JSON.stringify({ packageGlobs: [] }))
  for (const name of ['alpha', 'nested/beta', 'zeta'])
    write(root, 'docs/kb/' + name + '.md', topic)
  write(root, 'source.txt', 'before')
  run(root, 'git', ['init', '-q'])
  run(root, 'git', ['add', '.'])
  run(root, 'git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'baseline'])
  for (const name of ['alpha', 'nested/beta', 'zeta'])
    run(root, process.execPath, [cli, 'touch', name])
  // Commit the reconciliation separately: a topic touched in the same commit as the code is fresh.
  run(root, 'git', ['add', '.'])
  run(root, 'git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'reconcile'])
  write(root, 'source.txt', 'after')
  run(root, 'git', ['add', '.'])
  run(root, 'git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'source change'])
  const output = run(root, process.execPath, [cli, 'check', '--strict'], 1)
  // Keep the parser used by owner/merge workflows unchanged in this regression.
  const plain = output.replace(/\x1b\[[0-9;]*m/g, '')
  const section = plain.split(/требуют сверки с кодом \(\d+\):/)[1] ?? ''
  const topics = [...new Set(section.split(/после сверки:/)[0].split(/\r?\n/).flatMap(line =>
    line.match(/^\s+(\S.*?\.md) — /)?.[1] ?? []))]
  assert.deepEqual(topics, ['alpha.md', 'nested/beta.md', 'zeta.md'])
  assert.match(plain, /source change/)
})

test('owner archive runs outside Core with no runtime dependencies', t => {
  const output = temp(t)
  run(core, process.execPath, ['scripts/kb-tools-release.mjs', output])
  const integrity = JSON.parse(readFileSync(join(output, 'integrity.json'), 'utf8'))
  const row = integrity.packages[0]
  assert.equal(row.name, '@sislexa/kb-tools')
  run(output, 'tar', ['-xzf', row.filename])
  const manifest = JSON.parse(readFileSync(join(output, 'package/package.json'), 'utf8'))
  assert.equal(manifest.dependencies, undefined)
  assert.ok(existsSync(join(output, 'package', manifest.bin['sislexa-kb'])))
  const repo = join(output, 'module')
  write(repo, 'kb.config.json', '{"packageGlobs":[]}')
  run(repo, join(output, 'package/cli.mjs'), ['check', '--strict'])
})
