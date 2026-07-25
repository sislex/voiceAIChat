import { describe, it, expect } from 'vitest'
import { compareVersions, isToolAllowed, requiredVersion } from './version'

describe('compareVersions', () => {
  it('сравнивает x.y.z', () => {
    expect(compareVersions('0.1.0', '0.2.0')).toBe(-1)
    expect(compareVersions('0.2.0', '0.1.0')).toBe(1)
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('0.2.0', '0.2')).toBe(0) // недостающие части = 0
    expect(compareVersions('0.10.0', '0.9.0')).toBe(1) // числовое, не лексикографическое
  })
})

describe('isToolAllowed / requiredVersion', () => {
  it('fs требует 0.2.0, exec — 0.1.0', () => {
    expect(requiredVersion('fs')).toBe('0.2.0')
    expect(requiredVersion('exec')).toBe('0.1.0')
    // legacy-агент 0.1.0: fs запрещён, exec разрешён.
    expect(isToolAllowed('0.1.0', 'fs')).toBe(false)
    expect(isToolAllowed('0.1.0', 'exec')).toBe(true)
    // свежий 0.2.0: всё разрешено.
    expect(isToolAllowed('0.2.0', 'fs')).toBe(true)
    expect(isToolAllowed('0.2.0', 'exec')).toBe(true)
  })

  it('неизвестный тул → базовая 0.1.0', () => {
    expect(requiredVersion('что-то')).toBe('0.1.0')
    expect(isToolAllowed('0.1.0', 'что-то')).toBe(true)
  })
})
