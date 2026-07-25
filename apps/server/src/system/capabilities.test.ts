import { describe, it, expect } from 'vitest'
import { computeCapabilities, DEFAULT_MEM_THRESHOLDS } from './capabilities.js'
import type { SystemResources } from './resources.js'

const GB = 1024 * 1024 * 1024
const res = (memoryLimitBytes: number, cpuCount = 4): SystemResources => ({ memoryLimitBytes, cpuCount })

describe('computeCapabilities', () => {
  it('памяти достаточно на всё → STT и TTS доступны, без причин', () => {
    const c = computeCapabilities(res(8 * GB), 'large-v3-turbo')
    expect(c.stt.available).toBe(true)
    expect(c.tts.available).toBe(true)
    expect(c.stt.reason).toBe('')
    expect(c.tts.reason).toBe('')
    expect(c.memoryLimitBytes).toBe(8 * GB)
    expect(c.cpuCount).toBe(4)
  })

  it('память между TTS и STT(large) → озвучка доступна, распознавание заблокировано', () => {
    const c = computeCapabilities(res(1 * GB), 'large-v3-turbo')
    expect(c.tts.available).toBe(true)
    expect(c.stt.available).toBe(false)
    expect(c.stt.reason).toContain('распознавания')
  })

  it('порог STT зависит от модели: small проходит там, где large — нет', () => {
    const small = computeCapabilities(res(1 * GB), 'small')
    const large = computeCapabilities(res(1 * GB), 'large-v3-turbo')
    expect(small.stt.available).toBe(true)
    expect(large.stt.available).toBe(false)
  })

  it('памяти мало на всё → обе функции заблокированы с причинами', () => {
    const c = computeCapabilities(res(256 * 1024 * 1024), 'small')
    expect(c.stt.available).toBe(false)
    expect(c.tts.available).toBe(false)
    expect(c.tts.reason).toContain('озвучки')
    expect(c.stt.reason).toContain('МБ') // размер человекочитаем
  })

  it('переопределения порогов имеют приоритет над дефолтами', () => {
    // Поднимаем порог TTS выше лимита → озвучка блокируется, хотя дефолт бы прошёл.
    const c = computeCapabilities(res(1 * GB), 'small', DEFAULT_MEM_THRESHOLDS, { tts: 2 * GB })
    expect(c.tts.available).toBe(false)
  })

  it('граница: лимит ровно равен порогу → доступно (>=)', () => {
    const c = computeCapabilities(res(DEFAULT_MEM_THRESHOLDS.tts), 'small', DEFAULT_MEM_THRESHOLDS, {})
    expect(c.tts.available).toBe(true)
  })
})
