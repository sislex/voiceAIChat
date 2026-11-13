import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { VoiceChatDb } from '../apps/server/src/db/database.ts'
import { normalizeDump, refreshSeed, withTemporaryDatabase } from './stand-seed.mjs'

const fixture = fileURLToPath(new URL('../fixtures/stand/seed.sql', import.meta.url))
const dump = readFileSync(fixture, 'utf8')
const copyRows = table => {
  const block = dump.match(new RegExp('COPY public\\.' + table + ' \\([^\\n]+ FROM stdin;\\n([\\s\\S]*?)\\\\\\.'))
  assert.ok(block, 'Missing table ' + table)
  return block[1].trim().split('\n').filter(Boolean)
}

test('fixture has only public test identities, no credentials or production addresses', () => {
  assert.doesNotMatch(dump, /89\.125\.|sislexa\.by|(?:sk-(?:proj-)?|gh[pousr]_)[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._-]{16,}|-----BEGIN .*PRIVATE KEY|postgres(?:ql)?:\/\/[^'\s]+/i)
  assert.deepEqual(copyRows('users').map(row => row.split('\t')[0]), ['admin', 'user'])
  for (const table of ['conversations', 'agents', 'sessions', 'integration_tokens', 'identity_sign_in_tickets',
    'application_grants', 'public_client_access', 'public_client_refresh', 'team_tenant_invitations',
    'machine_vpn_networks', 'session_revocations', 'login_enrollments',
    'password_reset_tokens', 'invites', 'email_verifications']) assert.equal(copyRows(table).length, 0, table)
  assert.equal(copyRows('team_tenants').length, 1)
  assert.doesNotMatch(dump, /^-- Dumped |^-- (Started|Completed) on |^\\(?:un)?restrict /m)
})

test('normalizes volatile headers and COPY row order', () => {
  const input = '-- Dumped by pg_dump version 17\n\\restrict random\nCOPY public.x (id) FROM stdin;\nb\na\n\\.\n\\unrestrict random\n'
  assert.equal(normalizeDump(input), 'COPY public.x (id) FROM stdin;\na\nb\n\\.\n')
  assert.equal(normalizeDump('COPY public.x (id, value) FROM stdin;\na\t\n\\.\n'), 'COPY public.x (id, value) FROM stdin;\na\t\n\\.\n')
})

test('restores with psql and reopens Core with working fixture logins', { skip: !process.env.VC_TEST_DB_URL }, async () => {
  await withTemporaryDatabase(process.env.VC_TEST_DB_URL, async url => {
    execFileSync('psql', ['-X', '--dbname', url, '-v', 'ON_ERROR_STOP=1', '-f', fixture], { stdio: 'pipe' })
    const sql = new pg.Client({ connectionString: url })
    await sql.connect()
    const snapshot = async () => (await sql.query('SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = \'public\' ORDER BY table_name, ordinal_position')).rows
    const before = await snapshot()
    const db = new VoiceChatDb(':memory:', { postgres: { url } })
    try {
      await db.ready
      assert.deepEqual(await snapshot(), before, 'Fixture must contain all current Core columns')
      const users = await db.identity.listUsers()
      assert.deepEqual(users.map(u => [u.name, u.role]).sort(), [['admin', 'admin'], ['user', 'developer']])
      for (const [name, role] of [['admin', 'admin'], ['user', 'developer']]) {
        const login = await db.identity.verifyUserPassword(name, '123')
        assert.equal(login?.role, role)
        assert.equal(login?.mustChangePassword, false)
        assert.equal(login?.totpEnabled, false)
        assert.equal(await db.identity.verifyUserPassword(name, 'wrong'), null)
        assert.equal((await db.settings.getSettings(name)).onboarded, true)
        const access = await db.identity.getAccountAccess(name)
        assert.ok(access.tariff.capabilities.includes('chat.use'))
      }
      assert.equal((await sql.query('SELECT count(*)::int AS n FROM conversations')).rows[0].n, 0)
      assert.equal((await sql.query('SELECT count(*)::int AS n FROM team_tenants')).rows[0].n, 1)
    } finally { await db.close(); await sql.end() }
  })
})

test('refresh is reproducible and cleans up temporary databases on failure', { skip: !process.env.VC_TEST_DB_URL }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stand-seed-test-'))
  try {
    const output = join(dir, 'seed.sql')
    await refreshSeed(process.env.VC_TEST_DB_URL, output)
    assert.equal(readFileSync(output, 'utf8'), dump, 'Refresh fixture after changing migrations or seed defaults')
    await refreshSeed(process.env.VC_TEST_DB_URL, output)
    assert.equal(readFileSync(output, 'utf8'), dump)
    let failedUrl
    await assert.rejects(withTemporaryDatabase(process.env.VC_TEST_DB_URL, async url => {
      failedUrl = url
      throw Error('fixture failure')
    }), /fixture failure/)
    const removed = new pg.Client({ connectionString: failedUrl })
    await assert.rejects(removed.connect(), error => error.code === '3D000')
    await removed.end()
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

