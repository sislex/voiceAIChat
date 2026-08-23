import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { handleGitAccess, sanitizeRepositoryUrl, secureCredentialFile } from './gitAccess.js'

const originalHome = process.env.HOME
afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
})

describe('git access repository validation', () => {
  it('accepts only clean GitHub HTTPS repository URLs', () => {
    expect(sanitizeRepositoryUrl('https://github.com/org/repo.git')).toBe('https://github.com/org/repo.git')
    for (const value of [
      'https://secret@github.com/org/repo.git',
      'ssh://git@github.com/org/repo.git',
      'https://example.com/org/repo.git',
      'https://github.com/org/repo.git;touch pwned',
      'https://github.com/org/repo.git?token=secret'
    ]) expect(() => sanitizeRepositoryUrl(value)).toThrow('invalid_repository')
  })
})

describe.runIf(process.platform === 'linux')('headless Linux credential helper', () => {
  it('rejects a credential file when private modes cannot be established', () => {
    const insecureOps = {
      chmodSync: () => undefined,
      statSync: () => ({ mode: 0o777 }) as import('node:fs').Stats
    }
    expect(secureCredentialFile('/tmp/voicechat-test/git-credentials', insecureOps)).toBe(false)
  })

  it('stores credentials in a private agent file and reports the helper kind', () => {
    const home = mkdtempSync(join(tmpdir(), 'voicechat-git-access-'))
    process.env.HOME = home
    try {
      const result = handleGitAccess({
        operation: 'configure',
        repositoryUrl: 'https://github.com/org/repo.git',
        token: 'test-token'
      })
      expect(result.ok).toBe(true)
      expect(result.status.helperKind).toBe('linux-file')

      const directory = join(home, '.voicechat')
      const file = join(directory, 'git-credentials')
      expect(statSync(directory).mode & 0o777).toBe(0o700)
      expect(statSync(file).mode & 0o777).toBe(0o600)
      expect(readFileSync(file, 'utf8')).toContain('test-token')

      const deleted = handleGitAccess({ operation: 'delete', repositoryUrl: 'https://github.com/org/repo.git' })
      expect(deleted.ok).toBe(true)
      expect(() => statSync(file)).toThrow()
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
