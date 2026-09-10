import { describe, expect, it } from 'vitest'
import { BROWSER_COMMAND_BODY_LIMIT, BROWSER_UPLOAD_LIMIT_BYTES } from './browserLimits'
import { isPreviewAction, PREVIEW_ACTION_LIMITS } from './previewActions'

describe('загрузка через контракт модели', () => {
  const upload = { kind: 'upload', selector: '#file', name: 'sample.bin' }
  it('пустой файл и файл на пределе проходят runtime-контракт', () => {
    expect(isPreviewAction({ ...upload, base64: '' })).toBe(true)
    const encodedLength = Math.ceil(BROWSER_UPLOAD_LIMIT_BYTES / 3) * 4
    const padding = (3 - BROWSER_UPLOAD_LIMIT_BYTES % 3) % 3
    expect(isPreviewAction({ ...upload, base64: 'A'.repeat(encodedLength - padding) + '='.repeat(padding) })).toBe(true)
    expect(encodedLength + 64 * 1024).toBeLessThan(BROWSER_COMMAND_BODY_LIMIT)
  })
  it('payload больше предела отклоняется ещё до исполнения', () => {
    expect(isPreviewAction({ ...upload, base64: 'A'.repeat(PREVIEW_ACTION_LIMITS.uploadBase64 + 1) })).toBe(false)
  })
})
