import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ensureCliProfile } from './cliProfiles.js'

function credentials(accessToken: string, refreshToken: string, refreshTokenExpiresAt?: number): string {
  return JSON.stringify({
    claudeAiOauth: { accessToken, refreshToken, refreshTokenExpiresAt, subscriptionType: 'team' }
  })
}

describe('ensureCliProfile', () => {
  it('восстанавливает пустой OAuth Claude из действующего общего профиля', () => {
    const root = mkdtempSync(join(tmpdir(), 'voicechat-cli-profile-'))
    const sharedHome = join(root, 'shared')
    const dataDir = join(root, 'data')
    mkdirSync(join(sharedHome, '.claude'), { recursive: true })
    writeFileSync(join(sharedHome, '.claude', '.credentials.json'), credentials('fresh-a', 'fresh-r'))

    const profile = ensureCliProfile(dataDir, 'admin', sharedHome)
    writeFileSync(join(profile.claude, '.credentials.json'), credentials('', ''))

    ensureCliProfile(dataDir, 'admin', sharedHome)
    expect(readFileSync(join(profile.claude, '.credentials.json'), 'utf8')).toBe(
      credentials('fresh-a', 'fresh-r')
    )
  })

  it('не затирает действующие пользовательские OAuth-токены Claude', () => {
    const root = mkdtempSync(join(tmpdir(), 'voicechat-cli-profile-'))
    const sharedHome = join(root, 'shared')
    const dataDir = join(root, 'data')
    mkdirSync(join(sharedHome, '.claude'), { recursive: true })
    writeFileSync(join(sharedHome, '.claude', '.credentials.json'), credentials('shared-a', 'shared-r'))

    const profile = ensureCliProfile(dataDir, 'user', sharedHome)
    const own = credentials('own-a', 'own-r')
    writeFileSync(join(profile.claude, '.credentials.json'), own)

    ensureCliProfile(dataDir, 'user', sharedHome)
    expect(readFileSync(join(profile.claude, '.credentials.json'), 'utf8')).toBe(own)
  })

  it('в режиме общего Codex OAuth синхронизирует auth.json из HOME', () => {
    const root = mkdtempSync(join(tmpdir(), 'voicechat-cli-profile-'))
    const sharedHome = join(root, 'shared')
    const dataDir = join(root, 'data')
    mkdirSync(join(sharedHome, '.codex'), { recursive: true })
    const sharedAuth = '{"tokens":{"access_token":"shared"}}'
    writeFileSync(join(sharedHome, '.codex', 'auth.json'), sharedAuth)

    const profile = ensureCliProfile(dataDir, 'user', sharedHome, { sharedCodexAuth: true })
    writeFileSync(join(profile.codex, 'auth.json'), '{"tokens":{"access_token":"stale"}}')
    ensureCliProfile(dataDir, 'user', sharedHome, { sharedCodexAuth: true })

    expect(readFileSync(join(profile.codex, 'auth.json'), 'utf8')).toBe(sharedAuth)
  })
})
