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
  it('настраивает автозапуск и готовит Termux API без дублирования wake-lock в run.sh', () => {
    const s = buildAndroidInstallScript('http://h')
    expect(s).toContain('.termux/boot')
    expect(s).toContain('pkg install -y termux-api')
    expect(s).toContain('Установите пакет termux-api и приложение Termux:API')
    const runScript = s.slice(s.indexOf("<<'RUN'"), s.indexOf('\nRUN', s.indexOf("<<'RUN'")))
    expect(runScript).not.toContain('termux-wake-lock')
    expect(s).toContain('--connection')
  })
  it('готовит Termux для нативных npm-модулей и проверяет better-sqlite3', () => {
    const s = buildAndroidInstallScript('http://h')
    expect(s).toContain('pkg install -y clang make python pkg-config')
    expect(s).toContain('export GYP_DEFINES="android_ndk_path=$PREFIX"')
    expect(s).toContain('npm install --no-save --no-package-lock --silent better-sqlite3@11.10.0')
    expect(s).toContain("require('better-sqlite3')")
  })

  it('проверяет новый bundle до замены и сохраняет connection до перезапуска', () => {
    const s = buildAndroidInstallScript('http://h')
    expect(s.indexOf('node --check')).toBeLessThan(s.indexOf('mv "$AGENT_DIR/voicechat-agent.new.cjs"'))
    expect(s.indexOf("printf '%s' \"$CONN\"")).toBeLessThan(s.indexOf('mv "$AGENT_DIR/voicechat-agent.new.cjs"'))
    expect(s.indexOf('mv "$AGENT_DIR/voicechat-agent.new.cjs"')).toBeLessThan(s.indexOf('setsid nohup'))
  })

  it('учитывает самоподписанный TLS: curl -k и VC_AGENT_INSECURE_TLS', () => {
    const s = buildAndroidInstallScript('https://self-signed')
    expect(s).toContain('curl -fsSLk')
    expect(s).toContain('VC_AGENT_INSECURE_TLS=1')
  })
})
