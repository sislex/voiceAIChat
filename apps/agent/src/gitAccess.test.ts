import { describe, expect, it } from 'vitest'
import { sanitizeRepositoryUrl } from './gitAccess.js'

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
