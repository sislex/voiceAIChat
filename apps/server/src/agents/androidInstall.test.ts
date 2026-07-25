import { describe, it, expect } from 'vitest'
import { buildAndroidInstallScript } from './androidInstall'

describe('buildAndroidInstallScript', () => {
  it('подставляет адрес сервера и указывает на /api/agents/script', () => {
    const s = buildAndroidInstallScript('https://example.com')
    expect(s).toContain('SERVER="https://example.com"')
    expect(s).toContain('/api/agents/script')
    expect(s.startsWith('#!/data/data/com.termux/files/usr/bin/bash')).toBe(true)
  })
  it('срезает хвостовой слэш', () => {
    expect(buildAndroidInstallScript('https://example.com/')).toContain('SERVER="https://example.com"')
  })
  it('настраивает автозапуск и wake-lock', () => {
    const s = buildAndroidInstallScript('http://h')
    expect(s).toContain('.termux/boot')
    expect(s).toContain('termux-wake-lock')
    expect(s).toContain('--connection')
  })
  it('учитывает самоподписанный TLS: curl -k и VC_AGENT_INSECURE_TLS', () => {
    const s = buildAndroidInstallScript('https://self-signed')
    expect(s).toContain('curl -fsSLk')
    expect(s).toContain('VC_AGENT_INSECURE_TLS=1')
  })
})
