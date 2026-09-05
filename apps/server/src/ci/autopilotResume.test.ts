// Судьба работы модели после сбоя машины. Реальный случай CHAT-413: ноутбук ушёл
// в сон на шаге «Закоммитить работу в ветку задачи», ран упал, и новый ран
// заставил бы модель переделывать полчаса работы заново.

import { describe, it, expect } from 'vitest'
import { AUTOPILOT_RETRY_BACKOFF_MS, isDirtyWorkspaceFailure, retryAllowedNow, shouldResumeAfterInfraFailure } from './autopilotResume.js'

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

describe('перезапуск development-рана', () => {
  it('грязная копия задачи распознаётся: перезапуск её не лечит', () => {
    expect(isDirtyWorkspaceFailure('Рабочая копия содержит локальные изменения: /path/CHAT-413')).toBe(true)
    expect(isDirtyWorkspaceFailure('Шаг «Работа модели» завершился с ошибкой.')).toBe(false)
    expect(isDirtyWorkspaceFailure(null)).toBe(false)
  })

  it('между перезапусками выдерживается пауза', () => {
    const now = 1_000_000
    expect(retryAllowedNow({ finishedAt: now - AUTOPILOT_RETRY_BACKOFF_MS, now })).toBe(true)
    expect(retryAllowedNow({ finishedAt: now - 5_000, now })).toBe(false)
    // Неизвестное время завершения не должно блокировать конвейер навсегда.
    expect(retryAllowedNow({ finishedAt: null, now })).toBe(true)
  })
})
