import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createPrivateKey } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { oauthMaterial, writeOauthMaterial } from './identity-oauth-init.mjs'

test('creates an ES256 key, the Core client and secrets without overwriting', () => {
  const dir = mkdtempSync(join(tmpdir(), 'identity-oauth-'))
  const first = writeOauthMaterial(dir, 'https://203.0.113.5')
  assert.deepEqual(first.created.sort(), ['component.json', 'core-client.secret', 'oauth-clients.json', 'oauth-key.pem', 'session.secret'])
  assert.equal(first.env[0], 'AUTH_URL=https://203.0.113.5:8443')
  const key = createPrivateKey(readFileSync(join(dir, 'oauth-key.pem'), 'utf8'))
  assert.equal(key.asymmetricKeyDetails.namedCurve, 'prime256v1')
  const [core] = JSON.parse(readFileSync(join(dir, 'oauth-clients.json'), 'utf8'))
  assert.deepEqual(core.redirectUris, ['https://203.0.113.5/auth/callback'])
  assert.deepEqual(core.scopes, ['openid', 'profile', 'email', 'offline_access'])
  assert.equal(core.secret, undefined)
  assert.equal(statSync(join(dir, 'core-client.secret')).mode & 0o777, 0o600)
  writeFileSync(join(dir, 'session.secret'), 'kept\n')
  assert.deepEqual(writeOauthMaterial(dir, 'https://203.0.113.5').created, [])
  assert.equal(readFileSync(join(dir, 'session.secret'), 'utf8'), 'kept\n')
})

test('rejects non-https or path origins', () => {
  assert.throws(() => oauthMaterial('http://203.0.113.5'))
  assert.throws(() => oauthMaterial('https://203.0.113.5/app'))
  assert.equal(oauthMaterial('https://h.test/', 'https://auth.h.test').issuer, 'https://auth.h.test')
})
