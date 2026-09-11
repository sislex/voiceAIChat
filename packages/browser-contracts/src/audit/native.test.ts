import { describe, expect, it } from 'vitest'
import { nativeAuditExpression } from './native.js'
import { nativeProbeExpression } from './nativeProbe.js'

describe('trusted native audit program', () => {
  it('rejects malformed options before generating page code', () => {
    expect(() => nativeAuditExpression({ limit: 31 })).toThrow('Invalid audit')
    expect(() => nativeAuditExpression({ rules: ['duplicate-id', 'duplicate-id'] })).toThrow('Invalid audit')
  })
  it('does not accept arbitrary code through an extra option', () => {
    const options = { group: 'markup', code: 'window.unapprovedCode=true' }
    expect(nativeAuditExpression(options)).not.toContain('unapprovedCode')
  })
  it('validates probe options and excludes caller-supplied code', () => {
    expect(() => nativeProbeExpression({ selector: '' })).toThrow('Invalid probe')
    expect(() => nativeProbeExpression({ selector: 'x'.repeat(1001) })).toThrow('Invalid probe')
    const options = { selector: '#target', code: 'window.unapprovedProbeCode=true' }
    expect(nativeProbeExpression(options)).not.toContain('unapprovedProbeCode')
  })
})
