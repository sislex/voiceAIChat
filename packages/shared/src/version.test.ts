import { describe, it, expect } from 'vitest'
import { AGENT_VERSION, compareVersions, isToolAllowed, requiredVersion } from './version'

describe('AGENT_VERSION', () => {
  it('публикует релиз с живым контекстом PTY для консоли с ассистентом', () => {
    expect(AGENT_VERSION).toBe('0.15.0')
  })

  it('http-proxy требует агента 0.13.0', () => {
    expect(requiredVersion('http-proxy')).toBe('0.13.0')
    expect(isToolAllowed('0.12.0', 'http-proxy')).toBe(false)
    expect(isToolAllowed('0.13.0', 'http-proxy')).toBe(true)
  })
})

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

  it('pty требует 0.9.0 (старый агент не умеет начальный cwd)', () => {
    expect(requiredVersion('pty')).toBe('0.9.0')
    expect(isToolAllowed('0.6.0', 'pty')).toBe(false)
    expect(isToolAllowed('0.9.0', 'pty')).toBe(true)
  })

  it('неизвестный тул → базовая 0.1.0', () => {
    expect(requiredVersion('что-то')).toBe('0.1.0')
    expect(isToolAllowed('0.1.0', 'что-то')).toBe(true)
  })
})
