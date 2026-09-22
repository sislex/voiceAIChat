import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { readCoreUserFile, userFilesDirectory } from './userFiles.js'

const roots: string[] = []
afterEach(() => { for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true }) })
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'core-user-files-')); roots.push(dir)
  const legacy = join(dir, 'cli-users', Buffer.from('alice').toString('base64url'))
  const write = (path: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, 'output'); return path }
  return { dir, legacy, write }
}
describe('Core output ownership after runner extraction', () => {
  it('reads new outputs and existing generated images without creating profiles', () => {
    const { dir, legacy, write } = fixture()
    expect(readCoreUserFile('/missing', dir, 'alice')).toEqual({ ok: false, reason: 'not-found' })
    expect(existsSync(legacy)).toBe(false)
    for (const path of [join(userFilesDirectory(dir, 'alice'), 'retouch.png'), join(legacy, 'result.png'), join(legacy, '.generated_images', 'out.png'), join(legacy, '.codex', 'generated_images', 'out.png')]) {
      expect(readCoreUserFile(write(path), dir, 'alice').ok).toBe(true)
      expect(readCoreUserFile(path, dir, 'bob').ok).toBe(false)
    }
  })
  it('rejects credentials and symlinks into credentials or another user directory', () => {
    const { dir, legacy, write } = fixture()
    const secret = write(join(legacy, '.codex', 'auth.json'))
    const foreign = write(join(userFilesDirectory(dir, 'bob'), 'out.png'))
    const visible = join(legacy, 'visible.json'); symlinkSync(secret, visible)
    const escape = join(userFilesDirectory(dir, 'alice'), 'escape.png')
    mkdirSync(dirname(escape), { recursive: true }); symlinkSync(foreign, escape)
    for (const path of [secret, visible, escape, write(join(legacy, '.claude', '.credentials.json'))]) {
      expect(readCoreUserFile(path, dir, 'alice')).toEqual({ ok: false, reason: 'not-found' })
    }
  })
})
