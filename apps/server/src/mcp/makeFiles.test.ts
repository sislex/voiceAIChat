import { describe, it, expect } from 'vitest'
import { exec as shellExec } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtempSync, realpathSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MachinesService } from '../machines/service.js'
import { checkedBytes, confinedPath, makeFilePath, MAKE_FILE_MAX_BYTES } from './makeFiles.js'

describe('Make file boundary', () => {
  it('executes real path validation, rejecting traversal, symlinks and metadata', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'make-boundary-')))
    const registry = { exec: async (_agent: string, command: string) => {
      try { return { exitCode: 0, output: (await promisify(shellExec)(command)).stdout } }
      catch (error) { return { exitCode: 1, output: String(error) } }
    } } as unknown as MachinesService
    try {
      symlinkSync(tmpdir(), join(root, 'escape'))
      expect(await confinedPath(registry, 'a', root, 'new.png')).toBe(join(root, 'new.png'))
      for (const path of ['../outside', '/etc/passwd', 'escape/file', '.git/config'])
        await expect(confinedPath(registry, 'a', root, path)).rejects.toThrow()
      await expect(confinedPath(registry, 'a', undefined, 'a')).rejects.toThrow()
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  it('rejects incomplete or oversized bytes and invalid Make paths', () => {
    expect(() => checkedBytes(undefined)).toThrow('Incomplete')
    expect(() => checkedBytes('YQ==', true)).toThrow('Incomplete')
    expect(() => checkedBytes(Buffer.alloc(MAKE_FILE_MAX_BYTES + 1).toString('base64'))).toThrow('10 MiB')
    expect(checkedBytes('AAH/')).toBe('AAH/')
    for (const path of ['../x', '/x', 'C:/x', '.make/settings.json', '.git/config', 'a//b'])
      expect(() => makeFilePath(path)).toThrow()
  })
})
