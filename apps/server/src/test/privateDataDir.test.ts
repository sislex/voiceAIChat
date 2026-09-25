import { expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildServer } from '../server.js'
import { loadConfig } from '../config.js'
import { VoiceChatDb } from '../db/database.js'
import { privateDataDir } from './privateDataDir.js'

it('isolates real preview reconciliation and removes fixture data after closing Core', async () => {
  const first = privateDataDir('core-preview-')
  const second = privateDataDir('core-preview-')
  expect(first.path).not.toBe(second.path)
  if (process.platform !== 'win32') expect(statSync(first.path).mode & 0o777).toBe(0o700)
  const db = new VoiceChatDb(':memory:')
  let app: Awaited<ReturnType<typeof buildServer>> | undefined
  try {
    const foreignStore = join(second.path, 'feature-previews.json')
    writeFileSync(foreignStore, 'separate fixture')
    app = await buildServer({ config: loadConfig({ VC_DATA_DIR: first.path }), db, sessionSecret: randomUUID() })
    await app.ready()
    expect(JSON.parse(readFileSync(join(first.path, 'feature-previews.json'), 'utf8'))).toEqual({ environments: [], idempotency: {} })
    expect(readFileSync(foreignStore, 'utf8')).toBe('separate fixture')
  } finally {
    await app?.close()
    await db.close()
    first.remove()
    second.remove()
  }
  expect(existsSync(first.path)).toBe(false)
  expect(existsSync(second.path)).toBe(false)
})
