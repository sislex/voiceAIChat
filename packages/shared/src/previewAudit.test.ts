import { describe, expect, it } from 'vitest'
import { isPreviewAction } from './previewActions'
import { isPreviewAuditOptions } from './previewAudit'

describe('preview audit boundary', () => {
  it.each([{}, { group: 'markup', mode: 'list', limit: 30 }, { selector: '#content', rules: ['duplicate-id'], offset: 10 }])('accepts bounded options %j', options => {
    expect(isPreviewAuditOptions(options)).toBe(true)
    expect(isPreviewAction({ kind: 'audit', ...options })).toBe(true)
  })
  it.each([null, [], { group: '' }, { group: 'markup; alert(1)' }, { selector: ' ' }, { selector: 'x'.repeat(1001) }, { rules: [] }, { rules: ['duplicate-id', 'duplicate-id'] }, { rules: ['bad rule'] }, { mode: 'write' }, { offset: -1 }, { offset: 501 }, { offset: 0.1 }, { limit: 0 }, { limit: 31 }, { limit: Infinity }])('rejects invalid options %j', options => {
    expect(isPreviewAuditOptions(options)).toBe(false)
  })
  it('does not imply unimplemented frame support', () => {
    expect(isPreviewAction({ kind: 'audit', frame: '#child' })).toBe(false)
  })
})
