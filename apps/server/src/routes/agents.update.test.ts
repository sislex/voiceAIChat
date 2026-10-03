import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { detachedUnixUpdate } from './agents.js'

describe('agent update command', () => {
  it('starts the installer in its own session on hosts with and without setsid', async () => {
    const home = mkdtempSync(join(tmpdir(), 'agent-update-'))
    try {
      const marker = join(home, 'session')
      // The child reports whether it leads its own session (sid === pid).
      const command = `python3 -c "import os; open('${marker}','w').write(str(os.getsid(0)==os.getpid()))"`
      const output = execFileSync('/bin/sh', ['-c', detachedUnixUpdate(command)], { env: { ...process.env, HOME: home }, encoding: 'utf8' })
      expect(output.trim()).toBe('update-started')
      for (let i = 0; i < 50 && !readMarker(marker); i++) await new Promise(resolve => setTimeout(resolve, 100))
      expect(readMarker(marker)).toBe('True')
    } finally { rmSync(home, { recursive: true, force: true }) }
  })
  it('falls back to perl when setsid is missing', () => {
    expect(detachedUnixUpdate('true')).toMatch(/command -v setsid .*perl -MPOSIX -e 'POSIX::setsid\(\); exec @ARGV' nohup bash -lc/)
  })
})

function readMarker(path: string): string | undefined {
  try { return readFileSync(path, 'utf8') } catch { return undefined }
}
