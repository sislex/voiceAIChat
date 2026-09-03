import { describe, expect, it } from 'vitest'
import { getCachedPreview, previewCacheKey, putCachedPreview } from './previewCache'

describe('previewCache', () => {
  it('ключ включает разговор, путь и версию', () => {
    expect(previewCacheKey('c1', 'a.png', 5)).toBe('c1|a.png|5')
    expect(previewCacheKey('c1', 'a.png', 5)).not.toBe(previewCacheKey('c1', 'a.png', 6))
  })

  it('без IndexedDB работает как no-op', async () => {
    expect(await getCachedPreview('c1', 'a.png', 1)).toBeNull()
    await expect(putCachedPreview('c1', 'a.png', 1, new Blob(['x']))).resolves.toBeUndefined()
  })
})
