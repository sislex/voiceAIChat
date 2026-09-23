import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'

const POSTGRES_IMAGE = 'postgres:16-alpine'
const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/

function command(program, args) {
  return new Promise((resolveCommand, reject) => {
    const child = spawn(program, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout = []
    const stderr = []
    child.stdout.on('data', chunk => stdout.push(chunk))
    child.stderr.on('data', chunk => stderr.push(chunk))
    child.on('error', reject)
    child.on('close', code => {
      const result = { code: code ?? 1, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') }
      if (result.code === 0) resolveCommand(result)
      else reject(new Error(`${program} exited ${result.code}: ${result.stderr.trim().slice(0, 500)}`))
    })
  })
}

function record(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} must be an object`)
  return value
}

function entries(value, field) {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item)) throw new Error(`${field} must contain non-empty strings`)
  return value
}

function named(value, field) {
  if (typeof value !== 'string' || !NAME.test(value)) throw new Error(`${field} must be a safe identifier`)
  return value
}

function sourcePath(root, value, field) {
  if (typeof value !== 'string' || !value) throw new Error(`${field} must be a path`)
  return isAbsolute(value) ? value : resolve(root, value)
}

export function parseRestoreManifest(value, manifestFile) {
  const input = record(value, 'manifest')
  if (input.version !== 1) throw new Error('manifest.version must be 1')
  const root = dirname(resolve(manifestFile))
  const postgres = (input.postgres ?? []).map((raw, index) => {
    const item = record(raw, `postgres[${index}]`)
    return {
      name: named(item.name, `postgres[${index}].name`),
      archive: sourcePath(root, item.archive, `postgres[${index}].archive`),
      image: item.image === undefined ? POSTGRES_IMAGE : named(item.image, `postgres[${index}].image`),
      expectedTables: entries(item.expectedTables, `postgres[${index}].expectedTables`)
    }
  })
  const sqlite = (input.sqlite ?? []).map((raw, index) => {
    const item = record(raw, `sqlite[${index}]`)
    return {
      name: named(item.name, `sqlite[${index}].name`),
      database: sourcePath(root, item.database, `sqlite[${index}].database`),
      expectedTables: entries(item.expectedTables, `sqlite[${index}].expectedTables`)
    }
  })
  const archives = (input.archives ?? []).map((raw, index) => {
    const item = record(raw, `archives[${index}]`)
    return {
      name: named(item.name, `archives[${index}].name`),
      archive: sourcePath(root, item.archive, `archives[${index}].archive`),
      requiredEntries: entries(item.requiredEntries, `archives[${index}].requiredEntries`)
    }
  })
  if (postgres.length + sqlite.length + archives.length === 0) throw new Error('manifest must contain at least one restore input')
  const names = [...postgres, ...sqlite, ...archives].map(item => item.name)
  if (new Set(names).size !== names.length) throw new Error('restore input names must be unique')
  return { version: 1, postgres, sqlite, archives }
}

export function safeArchiveEntries(lines) {
  const values = lines.split('\n').map(item => item.trim()).filter(Boolean)
  for (const entry of values) {
    if (entry.startsWith('/') || entry.split('/').some(part => part === '..')) throw new Error('archive contains an unsafe path')
  }
  return values
}

async function fingerprint(path) {
  const hash = createHash('sha256')
  const file = await readFile(path)
  hash.update(file)
  return { bytes: file.length, sha256: hash.digest('hex') }
}

function requireExpected(actual, expected, name) {
  for (const value of expected) if (!actual.includes(value)) throw new Error(`${name} is missing required entry ${value}`)
}

async function restorePostgres(item, run) {
  await stat(item.archive)
  const script = `set -eu
export PGDATA=/tmp/restore-pgdata
trap 'pg_ctl -D "$PGDATA" -m fast stop >/dev/null 2>&1 || true' EXIT
pg_restore --list /backup/source.dump >/dev/null
initdb -D "$PGDATA" -U postgres -A trust >/dev/null
pg_ctl -D "$PGDATA" -o "-k /tmp" -w start >/dev/null
createdb -h /tmp -U postgres restored
pg_restore --exit-on-error --no-owner --no-privileges -h /tmp -U postgres -d restored /backup/source.dump
psql -h /tmp -U postgres -d restored -Atc "SELECT schemaname||'.'||tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY 1"`
  const result = await run('docker', [
    'run', '--rm', '--network', 'none', '--user', 'postgres',
    '--mount', `type=bind,src=${resolve(item.archive)},dst=/backup/source.dump,readonly`,
    item.image, 'sh', '-ec', script
  ])
  const tables = result.stdout.split('\n').map(value => value.trim()).filter(Boolean)
  requireExpected(tables, item.expectedTables, item.name)
  return { kind: 'postgres', name: item.name, ...(await fingerprint(item.archive)), tables: tables.length }
}

async function restoreSqlite(item, root) {
  await stat(item.database)
  const restored = join(root, `${item.name}.sqlite`)
  await copyFile(item.database, restored)
  for (const suffix of ['-wal', '-shm']) if (existsSync(item.database + suffix)) await copyFile(item.database + suffix, restored + suffix)
  const database = new DatabaseSync(restored, { readOnly: true })
  try {
    const integrity = database.prepare('PRAGMA integrity_check').get()
    if (!integrity || integrity.integrity_check !== 'ok') throw new Error(`${item.name} failed SQLite integrity_check`)
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name)
    requireExpected(tables, item.expectedTables, item.name)
    return { kind: 'sqlite', name: item.name, ...(await fingerprint(item.database)), tables: tables.length }
  } finally {
    database.close()
  }
}

async function restoreArchive(item, root, run) {
  await stat(item.archive)
  const listing = await run('tar', ['-tf', item.archive])
  const entries = safeArchiveEntries(listing.stdout)
  requireExpected(entries, item.requiredEntries, item.name)
  const target = join(root, item.name)
  await mkdir(target)
  await run('tar', ['-xf', item.archive, '-C', target])
  return { kind: 'archive', name: item.name, ...(await fingerprint(item.archive)), entries: entries.length }
}

export async function runRestoreDrill({ manifestFile, run = command, now = () => new Date() }) {
  const startedAt = now().toISOString()
  const manifest = parseRestoreManifest(JSON.parse(await readFile(manifestFile, 'utf8')), manifestFile)
  const root = await mkdtemp(join(tmpdir(), 'sislexa-restore-drill-'))
  try {
    const results = []
    for (const item of manifest.postgres) results.push(await restorePostgres(item, run))
    for (const item of manifest.sqlite) results.push(await restoreSqlite(item, root))
    for (const item of manifest.archives) results.push(await restoreArchive(item, root, run))
    return { version: 1, ok: true, startedAt, completedAt: now().toISOString(), results }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const manifestFile = process.argv[2]
  if (!manifestFile) {
    console.error('Usage: npm run operations:restore-drill -- /absolute/path/to/restore-manifest.json')
    process.exitCode = 2
  } else {
    try {
      console.log(JSON.stringify(await runRestoreDrill({ manifestFile }), null, 2))
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    }
  }
}
