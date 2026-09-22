// Publish committed Core contracts without UI source or owner-internal tests.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
const root = resolve(import.meta.dirname, '..')
const value = flag => process.argv.includes(flag) ? process.argv[process.argv.indexOf(flag) + 1] : undefined
const version = value('--version')
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw Error('Expected --version x.y.z')
const ref = value('--commit') ?? 'HEAD'
if (ref !== 'HEAD' && !/^[a-f0-9]{40}$/.test(ref)) throw Error('Expected a full commit SHA')
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
const commit = git('rev-parse', ref).trim()
const source = JSON.parse(git('show', `${commit}:packages/shared/package.json`))
const lock = JSON.parse(git('show', `${commit}:package-lock.json`))
const output = join(root, 'artifacts/core-contracts', version)
rmSync(output, { recursive: true, force: true }); mkdirSync(output, { recursive: true })
for (const path of git('ls-tree', '-r', '--name-only', commit, 'packages/shared/src').trim().split('\n')) {
  if (/\.(test|stories)\./.test(path) || !path.endsWith('.ts')) continue
  const target = join(output, path.replace('packages/shared/', ''))
  mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, git('show', `${commit}:${path}`))
}
const peerDependencies = {}
for (const name of Object.keys(source.dependencies)) {
  const version = lock.packages['node_modules/' + name]?.version
  if (!version) throw Error('Missing immutable peer version: ' + name)
  peerDependencies[name] = version
}
writeFileSync(join(output, 'package.json'), JSON.stringify({
  name: '@voicechat/shared', version, type: 'module', main: './src/index.ts', types: './src/index.ts',
  exports: { '.': './src/index.ts', './*.js': './src/*.ts', './*': './src/*.ts', './release-source.json': './release-source.json' },
  files: ['src', 'release-source.json'], peerDependencies
}, null, 2) + '\n')
writeFileSync(join(output, 'release-source.json'), JSON.stringify({ repository: 'https://github.com/sislex/voiceAIChat', commit, version }, null, 2) + '\n')
execFileSync('npm', ['pack', '--ignore-scripts', '--pack-destination', output], { cwd: output, stdio: 'inherit' })
