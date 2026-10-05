// Owner-side archive target; no installation, publishing or network access.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, join } from 'node:path'
const root = resolve(import.meta.dirname, '..')
const output = resolve(process.argv[2] ?? join(root, 'artifacts/kb-tools'))
mkdirSync(output, { recursive: true })
const [pack] = JSON.parse(execFileSync('npm', ['pack', './packages/kb-tools', '--ignore-scripts', '--json', '--pack-destination', output], { cwd: root, encoding: 'utf8' }))
const bytes = readFileSync(join(output, pack.filename))
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
writeFileSync(join(output, 'integrity.json'), JSON.stringify({ packages: [{ name: pack.name, version: pack.version, filename: pack.filename, commit,
  sha256: createHash('sha256').update(bytes).digest('hex'), integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64') }] }, null, 2) + '\n')
console.log(join(output, pack.filename))
