import { describe, expect, it } from 'vitest'
import { IMAGE_STUDIO_LIMITS } from './imageStudio'
import { isImageStudioGenerateRequest, IMAGE_STUDIO_RPC_BODY_LIMIT } from './imageStudioInternal'

describe('внутренний контракт генерации студии', () => {
  const request = { userId: 'ann', prompt: 'кот' }
  const source = { name: 'кот.png', dataBase64: 'aQ==' }
  it('принимает генерацию, правку, ретушь и до четырёх референсов', () => {
    for (const body of [request, { ...request, source }, { ...request, references: [source, source, source, source] },
      { ...request, source, mask: { name: 'mask.png', dataBase64: 'aQ==' }, targetSize: { width: 64, height: 48 } }]) {
      expect(isImageStudioGenerateRequest(body)).toBe(true)
    }
  })
  it('отклоняет некорректные и слишком большие запросы до запуска исполнителя', () => {
    for (const body of [null, {}, { ...request, userId: '' }, { ...request, prompt: ' ' },
      { ...request, prompt: 'a'.repeat(4001) }, { ...request, source: null },
      { ...request, mask: source }, { ...request, source, mask: source },
      { ...request, source, mask: source, targetSize: { width: 0, height: 2 } },
      { ...request, references: [source, source, source, source, source] },
      { ...request, source: { ...source, dataBase64: 'a'.repeat(16 * 1024 * 1024 + 1) } }]) {
      expect(isImageStudioGenerateRequest(body)).toBe(false)
    }
    expect(IMAGE_STUDIO_RPC_BODY_LIMIT).toBeGreaterThan(5 * Math.ceil(IMAGE_STUDIO_LIMITS.maxFileBytes / 3) * 4)
  })
})
