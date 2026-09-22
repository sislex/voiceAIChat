import { it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
const script = readFileSync(new URL('../../../../scripts/prod/install.sh', import.meta.url), 'utf8')
it('parses the Core production installer as Bash', () => {
  const result = spawnSync('bash', ['-n'], { input: script, encoding: 'utf8' })
  expect(result.status, result.stderr).toBe(0)
})
it('compiles the production deployment API embedded Python', () => {
  const match = /cat >\/usr\/local\/lib\/voicechat\/deploy-api\.py <<'PY'\n([\s\S]*?)\nPY\n/.exec(script)
  expect(match).not.toBeNull()
  const result = spawnSync('python3', ['-c', 'import sys; compile(sys.stdin.read(), "deploy-api.py", "exec")'], { input: match![1], encoding: 'utf8' })
  expect(result.status, result.stderr).toBe(0)
})
