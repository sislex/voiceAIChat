import { describe, expect, it } from 'vitest'
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { userFilesDirectory } from '../userFiles.js'
import { setupRestHarness } from './restHarness.js'

describe('public text-only file boundaries', () => {
  const harness = setupRestHarness({ env: {
    VC_CHAT_TEXT_ONLY: 'true',
    VC_LLM_RUNNER_CODEX_URL: 'http://127.0.0.1:1',
    VC_LLM_RUNNER_TOKEN: 'fixture'
  } })
  function write(directory: string, name: string) {
    mkdirSync(directory, { recursive: true })
    const path = join(directory, name)
    writeFileSync(path, 'fixture-data')
    return path
  }
  const read = (path: string) => harness.inj({ method: 'GET', url: '/api/files/read?path=' + encodeURIComponent(path) })

  it('reads only user-owned Core outputs without consulting runner filesystem APIs', async () => {
    const own = write(userFilesDirectory(harness.dataDir, harness.U), 'own.txt')
    const foreign = write(userFilesDirectory(harness.dataDir, 'someone-else'), 'private.txt')
    expect((await read(own)).statusCode).toBe(200)
    expect((await read(foreign)).statusCode).toBe(404)
  })

  it('does not turn a saved workdir or shared uploads into filesystem grants', async () => {
    const settings = await harness.db.settings.getSettings(harness.U)
    const changed = await harness.inj({ method: 'PUT', url: '/api/settings', payload: { ...settings, workdir: harness.dataDir } })
    expect(changed.statusCode).toBe(200)
    expect((await read(write(harness.dataDir, 'private-config.json'))).statusCode).toBe(404)
    expect((await read(write(join(harness.dataDir, 'uploads'), 'another-users-upload.txt'))).statusCode).toBe(404)
  })

  it('rejects a symlink from the owned output directory into private installation files', async () => {
    const secret = write(harness.dataDir, 'installation-secret.txt')
    const owned = userFilesDirectory(harness.dataDir, harness.U)
    mkdirSync(owned, { recursive: true })
    const link = join(owned, 'linked.txt')
    symlinkSync(secret, link)
    expect((await read(link)).statusCode).toBe(404)
  })
})
