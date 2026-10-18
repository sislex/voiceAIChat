import { describe, it, expect } from 'vitest'
import { parseApplications, serializeApplications, validateCoreId } from './deploymentProfiles.js'
describe('deployment profiles', () => {
  it('defaults to all local, disables missing ids and round trips external applications', () => {
    expect(parseApplications().every(a => a.enabled && a.location === 'local')).toBe(true)
    expect(parseApplications('').every(a => !a.enabled)).toBe(true)
    const value = 'chat,make=https://make.example.org'
    expect(serializeApplications(parseApplications(value))).toBe(value)
    expect(parseApplications(value).find(a => a.id === 'projects')?.enabled).toBe(false)
  })
  it.each(['make,make', 'unknown', 'chat,', 'make=http://example.org', 'make=https://user:secret@example.org', 'make='])('rejects %s', value => expect(() => parseApplications(value)).toThrow())
  it.each(['a', '../core', 'UPPER', '-core', 'a'.repeat(64)])('rejects core %s', value => expect(() => validateCoreId(value)).toThrow())
  it('accepts the exact coreId boundaries', () => { expect(validateCoreId('ab')).toBe('ab'); expect(validateCoreId('a'.repeat(63))).toHaveLength(63) })
})
