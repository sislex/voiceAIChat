import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Explicit fixture storage; never redirect HOME or production config defaults. */
export function privateDataDir(prefix: string) {
  const base = process.env.DELIVERY_ATTEMPT_ROOT
    ? join(process.env.DELIVERY_ATTEMPT_ROOT, 'tmp')
    : tmpdir()
  const path = realpathSync(mkdtempSync(join(base, prefix)))
  return { path, remove: () => rmSync(path, { recursive: true, force: true }) }
}
