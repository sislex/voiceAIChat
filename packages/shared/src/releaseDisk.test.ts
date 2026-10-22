import { describe, expect, it } from 'vitest'
import { RELEASE_DISK_LOW, RELEASE_MIN_FREE_BYTES, parseReleaseDiskPreflight, releaseDiskCleanupPrompt, type ReleaseDiskCheck, type ReleaseDiskLowResponse } from './release'
import { REST } from './protocol'

const build: ReleaseDiskCheck = {
  role: 'build', machineId: 'm1', machineName: 'Build M1', freeBytes: RELEASE_MIN_FREE_BYTES,
  minBytes: RELEASE_MIN_FREE_BYTES, ok: true, measuredAt: 1_791_244_800_000,
}
const production: ReleaseDiskCheck = { ...build, role: 'production', machineId: null, machineName: 'Production' }

describe('release disk preflight', () => {
  it('exports the exact binary threshold and encoded endpoint', () => {
    expect(RELEASE_MIN_FREE_BYTES).toBe(10_737_418_240)
    expect(REST.projectReleasePreflight('project/a b')).toBe('/api/projects/project%2Fa%20b/releases/preflight')
  })

  it('accepts both machines at the inclusive threshold', () => {
    const value = { ok: true, checks: [build, production] }
    expect(parseReleaseDiskPreflight(value)).toEqual(value)
  })

  it('carries low and unmeasurable machines in the error response', () => {
    const response: ReleaseDiskLowResponse = {
      code: RELEASE_DISK_LOW, error: 'Недостаточно места',
      preflight: { ok: false, checks: [
        { ...build, freeBytes: 0, ok: false },
        { ...production, freeBytes: null, ok: false, error: 'Машина недоступна' },
      ] },
    }
    expect(response.code).toBe('release_disk_low')
    expect(parseReleaseDiskPreflight(response.preflight)).toEqual(response.preflight)
  })

  it.each([
    null, [], {}, { ok: 'true', checks: [build] }, { ok: true, checks: [] },
    { ok: true, checks: [build], extra: true }, { ok: false, checks: [build] },
    { ok: true, checks: [{ ...build, freeBytes: 0, ok: false }] },
  ])('rejects malformed or inconsistent envelopes: %j', value => {
    expect(() => parseReleaseDiskPreflight(value)).toThrow(TypeError)
  })

  it.each([
    { role: 'other' }, { machineId: 3 }, { machineName: '' }, { extra: 1 },
    { freeBytes: undefined }, { freeBytes: '10' }, { freeBytes: -1 }, { freeBytes: NaN },
    { freeBytes: Infinity }, { freeBytes: 0.5 }, { freeBytes: Number.MAX_SAFE_INTEGER + 1 },
    { minBytes: -1 }, { minBytes: Infinity }, { measuredAt: undefined }, { measuredAt: NaN },
    { ok: 1 }, { ok: false }, { error: '' }, { error: 'unexpected' },
    { freeBytes: null }, { freeBytes: null, ok: false },
    { freeBytes: null, ok: true, error: 'offline' }, { freeBytes: null, ok: false, error: 42 },
  ])('rejects malformed or contradictory checks: %j', patch => {
    expect(() => parseReleaseDiskPreflight({ ok: true, checks: [{ ...build, ...patch }] })).toThrow(TypeError)
  })

  it('requires every check field', () => {
    for (const key of Object.keys(build)) {
      const check = { ...build } as Record<string, unknown>
      delete check[key]
      expect(() => parseReleaseDiskPreflight({ ok: true, checks: [check] })).toThrow(TypeError)
    }
  })
})

describe('releaseDiskCleanupPrompt', () => {
  it('names the machine, exact sizes, safe candidates and explicit chat confirmation', () => {
    const prompt = releaseDiskCleanupPrompt({ ...build, freeBytes: 2 * 1024 ** 3, ok: false })
    for (const text of ['Build M1', '2 ГиБ (2147483648 байт)', '10 ГиБ (10737418240 байт)',
      'образы Docker', 'кэш сборки', 'старые релизы и логи', 'workspaces', 'Покажи размеры',
      'Ничего не удаляй без явного подтверждения пользователя в этом чате', 'Никогда не трогай личные файлы']) {
      expect(prompt).toContain(text)
    }
  })

  it('reports an unavailable measurement without inventing free space', () => {
    const prompt = releaseDiskCleanupPrompt({ ...production, freeBytes: null, ok: false, error: 'offline' })
    expect(prompt).toContain('Production')
    expect(prompt).toContain('Свободно: не удалось измерить (offline)')
    expect(prompt).toContain('10 ГиБ')
    expect(prompt).toContain('без явного подтверждения пользователя в этом чате')
  })
})
