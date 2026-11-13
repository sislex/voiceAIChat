import { randomUUID, scryptSync } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { userInfo } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { VoiceChatDb } from '../apps/server/src/db/database.ts'

// Only generated names may be created/dropped; never migrate the maintenance database.
export async function withTemporaryDatabase(server, action) {
  const maintenance = new URL(server)
  if (!['postgres:', 'postgresql:'].includes(maintenance.protocol)) throw Error('Expected a PostgreSQL URL')
  maintenance.pathname = '/postgres'
  const admin = new pg.Client({ connectionString: maintenance.href })
  const name = 'stand_seed_' + randomUUID().replaceAll('-', '')
  const target = new URL(maintenance)
  target.pathname = '/' + name
  await admin.connect()
  let created = false
  try {
    await admin.query('CREATE DATABASE "' + name + '" TEMPLATE template0')
    created = true
    return await action(target.href)
  } finally {
    try {
      if (created) await admin.query('DROP DATABASE "' + name + '" WITH (FORCE)')
    } finally { await admin.end() }
  }
}

export function normalizeDump(dump) {
  // pg_dump orders objects; COPY rows need explicit sorting. Recent clients'
  // random restrict keys are unnecessary in this trusted, generated fixture.
  return dump.replace(/^-- Dumped (?:from|by).*\n/gm, '')
    .replace(/^-- (?:Started|Completed) on .*\n/gm, '')
    .replace(/^\\(?:un)?restrict .*\n/gm, '')
    .replace(/(COPY [^\n]+ FROM stdin;\n)([\s\S]*?)(^\\\.\n)/gm,
      (_, header, rows, end) => header + rows.replace(/\n$/, '').split('\n').filter(Boolean).sort().join('\n') + (rows ? '\n' : '') + end)
}

export async function refreshSeed(server, output) {
  await withTemporaryDatabase(server, async url => {
    let sequence = 0
    const db = new VoiceChatDb(':memory:', { postgres: { url },
      now: () => 1704067200000,
      newId: () => '00000000-0000-4000-8000-' + String(++sequence).padStart(12, '0') })
    try {
      await db.ready
      for (const [name, role] of [['admin', 'admin'], ['user', 'developer']]) {
        await db.identity.createUser(name, 'stand-placeholder-password', role)
        await db.settings.saveSettings(name, { ...await db.settings.getSettings(name), onboarded: true })
      }
      await db.identity.createTeamTenant('admin', 'Stand')
    } finally { await db.close() }
    const client = new pg.Client({ connectionString: url })
    await client.connect()
    try {
      for (const name of ['admin', 'user']) {
        // Public fixture-only salt: stable output, never a production credential.
        const salt = Buffer.from(name === 'admin' ? '00000000000000000000000000000001' : '00000000000000000000000000000002', 'hex')
        const hash = ['scrypt', salt.toString('hex'), scryptSync('123', salt, 32).toString('hex')].join(String.fromCharCode(36))
        await client.query('UPDATE users SET password_hash = $1, must_change_password = 0 WHERE name = $2', [hash, name])
      }
    } finally { await client.end() }
    const dump = execFileSync('pg_dump', ['--dbname', url, '--no-owner', '--no-privileges', '--format=plain'],
      { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    mkdirSync(dirname(output), { recursive: true })
    writeFileSync(output + '.tmp', normalizeDump(dump))
    renameSync(output + '.tmp', output)
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url))
  await refreshSeed(process.env.SISLEXA_STAND_PG || 'postgres://' + userInfo().username + '@127.0.0.1:5432',
    resolve(root, 'fixtures/stand/seed.sql'))
  console.log('Refreshed fixtures/stand/seed.sql')
}
