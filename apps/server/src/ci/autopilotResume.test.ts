// Судьба работы модели после сбоя машины. Реальный случай CHAT-413: ноутбук ушёл
// в сон на шаге «Закоммитить работу в ветку задачи», ран упал, и новый ран
// заставил бы модель переделывать полчаса работы заново.

import { describe, it, expect } from 'vitest'
import { shouldResumeAfterInfraFailure } from './autopilotResume.js'

const input = (over: Partial<Parameters<typeof shouldResumeAfterInfraFailure>[0]> = {}) =>
  ({ status: 'failed', infraErrors: 1, resumes: 0, limit: 3, ...over })

describe('возобновление рана после сбоя машины', () => {
  it('упавший по вине машины ран продолжается с того же шага', () => {
    expect(shouldResumeAfterInfraFailure(input())).toBe(true)
    expect(shouldResumeAfterInfraFailure(input({ status: 'timeout' }))).toBe(true)
  })

  it('дефект кода возобновлением не лечится: этим занимается fix-loop', () => {
    expect(shouldResumeAfterInfraFailure(input({ infraErrors: 0 }))).toBe(false)
  })

  it('успешный, отменённый и ещё живой ран не трогаем', () => {
    for (const status of ['success', 'cancelled', 'running', 'queued', 'awaiting_input', null]) {
      expect(shouldResumeAfterInfraFailure(input({ status }))).toBe(false)
    }
  })

  it('число возобновлений одного рана конечно', () => {
    expect(shouldResumeAfterInfraFailure(input({ resumes: 2, limit: 3 }))).toBe(true)
    expect(shouldResumeAfterInfraFailure(input({ resumes: 3, limit: 3 }))).toBe(false)
    // Нулевой лимит выключает возобновление целиком.
    expect(shouldResumeAfterInfraFailure(input({ resumes: 0, limit: 0 }))).toBe(false)
  })
})
