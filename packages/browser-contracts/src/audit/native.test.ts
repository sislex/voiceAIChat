import { describe, expect, it } from 'vitest'
import { nativeAuditExpression } from './native.js'

describe('trusted native audit program', () => {
  it('rejects malformed options before generating page code', () => {
    expect(() => nativeAuditExpression({ limit: 31 })).toThrow('Invalid audit')
    expect(() => nativeAuditExpression({ rules: ['duplicate-id', 'duplicate-id'] })).toThrow('Invalid audit')
  })
  it('does not accept arbitrary code through an extra option', () => {
    const options = { group: 'markup', code: 'window.unapprovedCode=true' }
    expect(nativeAuditExpression(options)).not.toContain('unapprovedCode')
  })
})
