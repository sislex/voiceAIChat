// Promotion calls this only after gate:all succeeds for the exact candidate SHA.
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function markFullGate(sha, invoke = args => execFileSync('git', args, { cwd: resolve(import.meta.dirname, '..'), stdio: 'inherit' }), now = () => new Date()) {
  if (!/^[a-f0-9]{40}$/.test(sha ?? '')) throw Error('Expected a full immutable commit SHA')
  invoke(['cat-file', '-e', `${sha}^{commit}`])
  const tag = `verified/full-gate/${sha}`
  invoke(['tag', '-a', tag, sha, '-m', `gate:all exit 0\n${now().toISOString()}`])
  invoke(['push', 'origin', `refs/tags/${tag}:refs/tags/${tag}`])
  return tag
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw Error('Usage: node scripts/mark-full-gate.mjs <sha>')
    markFullGate(process.argv[2])
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
