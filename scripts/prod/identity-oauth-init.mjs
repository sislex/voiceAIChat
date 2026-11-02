#!/usr/bin/env node
// Create the production Identity OAuth material once (sso-auth-v1 A7).
//   docker compose exec -u node voicechat node scripts/prod/identity-oauth-init.mjs https://<public host> [auth origin]
// Writes into /data/identity/oauth (the shared vc-data volume) and never overwrites
// existing files, so a rerun keeps issued tokens and client secrets valid. Prints
// only file names and the .env lines to add; secret values stay in the files.
import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export function oauthMaterial(publicUrl, authUrl = publicUrl.replace(/\/$/, '') + ':8443') {
  for (const value of [publicUrl, authUrl]) {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username)
      throw new Error(`Expected an https origin: ${value}`)
  }
  const core = publicUrl.replace(/\/$/, ''), issuer = authUrl.replace(/\/$/, '')
  const scopes = ['openid', 'profile', 'email', 'offline_access']
  const clients = [{ id: 'core', type: 'confidential', redirectUris: [`${core}/auth/callback`],
    postLogoutRedirectUris: [`${core}/`], audience: 'core', scopes, exchangeAudiences: ['storage'] }]
  return { core, issuer, clients }
}

export function writeOauthMaterial(directory, publicUrl, authUrl) {
  const { core, issuer, clients } = oauthMaterial(publicUrl, authUrl)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const secret = () => randomBytes(32).toString('base64url')
  const files = {
    'oauth-key.pem': () => generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'pem' }),
    'oauth-clients.json': () => JSON.stringify(clients, null, 2) + '\n',
    'core-client.secret': () => secret() + '\n',
  }
  const created = []
  for (const [name, content] of Object.entries(files)) {
    const path = join(directory, name)
    if (existsSync(path)) continue
    writeFileSync(path, content(), { mode: 0o600, flag: 'wx' })
    created.push(name)
  }
  return { created, env: [`AUTH_URL=${issuer}`, `VC_PUBLIC_URL=${core}`,
    `AUTH_CLIENT_SECRET_FILE=${join(directory, 'core-client.secret')}`,
    'VC_NODE_EXTRA_CA_CERTS=/caddy/caddy/pki/authorities/local/root.crt',
    'SISLEXA_IDENTITY_IMAGE=ghcr.io/sislex/identity:70e28251f3faa79eabea664924abdf5a73e5500f'] }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [publicUrl, authUrl] = process.argv.slice(2)
  if (!publicUrl) { console.error('usage: identity-oauth-init.mjs https://<public host> [auth origin]'); process.exit(2) }
  const result = writeOauthMaterial(process.env.VC_IDENTITY_OAUTH_DIR ?? '/data/identity/oauth', publicUrl, authUrl)
  console.log(result.created.length ? `created: ${result.created.join(', ')}` : 'all files already exist; nothing changed')
  console.log('add to .env next to docker-compose.yml:\n  ' + result.env.join('\n  '))
}
