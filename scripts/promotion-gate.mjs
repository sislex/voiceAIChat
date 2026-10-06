// Promotion entry point: attest only the committed tree that actually passed gate:all.
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { markFullGate } from './mark-full-gate.mjs'

const root = resolve(import.meta.dirname, '..')
export function promotionGate(invoke = (command, args) => execFileSync(command, args, {
  cwd: root, encoding: 'utf8', stdio: command === 'git' ? ['ignore', 'pipe', 'inherit'] : 'inherit'
}), mark = markFullGate) {
  const sha = invoke('git', ['rev-parse', 'HEAD']).trim()
  if (!/^[a-f0-9]{40}$/.test(sha)) throw Error('Expected immutable promotion commit')
  const assertClean = () => {
    if (invoke('git', ['status', '--porcelain']).trim()) throw Error('Promotion requires a clean committed tree')
  }
  assertClean()
  invoke('npm', ['run', 'gate:all'])
  if (invoke('git', ['rev-parse', 'HEAD']).trim() !== sha) throw Error('Promotion HEAD changed during gate:all')
  assertClean()
  return mark(sha)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { promotionGate() } catch (error) { console.error(error.message); process.exitCode = 1 }
}
