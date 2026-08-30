// Контракт типов между транспортным DTO приложения и ядром модуля сессий.
// @voicechat/sessions-core здесь только в devDependencies: shared остаётся без
// зависимостей в рантайме, но расхождение типов и констант ловится на гейте.
import { describe, expect, expectTypeOf, it } from 'vitest'
import { DEFAULT_SESSION_POLICY, SESSION_SHORT_TTL_MS as CORE_SHORT_TTL, SESSION_TTL_MS as CORE_TTL, type DeviceSession } from '@voicechat/sessions-core'
import { SESSION_SHORT_TTL_MS, SESSION_TTL_MS, type SessionInfo } from './types'

describe('SessionInfo ↔ DeviceSession', () => {
  it('DTO остаётся подмножеством типа ядра', () => {
    // Ошибка компиляции здесь означает, что DTO разошёлся с ядром: в ядре
    // появилось обязательное поле или у DTO изменился тип существующего.
    expectTypeOf<SessionInfo>().toMatchTypeOf<DeviceSession>()
    const dto: SessionInfo = { sid: 's', user: 'u', createdAt: 1, lastSeen: 2, expiresAt: 3, ip: '', userAgent: '', current: true }
    const core: DeviceSession = dto
    expect(core.sid).toBe('s')
  })

  it('сроки жизни сессии совпадают с политикой ядра', () => {
    expect(SESSION_TTL_MS).toBe(CORE_TTL)
    expect(SESSION_SHORT_TTL_MS).toBe(CORE_SHORT_TTL)
    expect(DEFAULT_SESSION_POLICY.ttlMs).toBe(SESSION_TTL_MS)
  })
})
