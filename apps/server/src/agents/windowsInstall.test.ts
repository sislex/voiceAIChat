import { describe, it, expect } from 'vitest'
import { buildWindowsInstallScript } from './windowsInstall'

describe('buildWindowsInstallScript', () => {
  it('подставляет адрес сервера и указывает на /api/agents/script', () => {
    const s = buildWindowsInstallScript('https://example.com')
    expect(s).toContain("$Server = 'https://example.com'")
    expect(s).toContain('/api/agents/script')
  })
  it('срезает хвостовой слэш', () => {
    expect(buildWindowsInstallScript('https://example.com/')).toContain("$Server = 'https://example.com'")
  })
  it('начинается с BOM — иначе PowerShell 5.1 портит русские строки', () => {
    expect(buildWindowsInstallScript('http://h').charCodeAt(0)).toBe(0xfeff)
  })
  it('проверяет Node 22+ и умеет ставить последнюю портативную ноду', () => {
    const s = buildWindowsInstallScript('http://h')
    expect(s).toContain('-lt 22')
    expect(s).toContain('https://nodejs.org/dist/index.json')
    expect(s).toContain('node-$Ver-win-$Arch.zip')
  })
  it('ставит и проверяет нативный ConPTY рядом с агентом', () => {
    const s = buildWindowsInstallScript('http://h')
    expect(s).toContain("install --prefix $AgentDir")
    expect(s).toContain('@lydell/node-pty@1.1.0')
    expect(s).toContain('node_modules/@lydell/node-pty')
  })

  it('настраивает автозапуск через HKCU Run и скрытый запуск wscript', () => {
    const s = buildWindowsInstallScript('http://h')
    expect(s).toContain('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run')
    expect(s).toContain('run-hidden.vbs')
    expect(s).toContain('wscript.exe')
    expect(s).toContain('--connection')
  })
  it('учитывает самоподписанный TLS: curl.exe -k и VC_AGENT_INSECURE_TLS', () => {
    const s = buildWindowsInstallScript('https://self-signed')
    expect(s).toContain('curl.exe -fsSLk')
    expect(s).toContain('VC_AGENT_INSECURE_TLS=1')
  })

  it('ищет bash.exe (PATH → пути Git for Windows) и передаёт его агенту через VC_PTY_SHELL', () => {
    const s = buildWindowsInstallScript('http://h')
    expect(s).toContain('function FindBash')
    expect(s).toContain('Get-Command bash.exe')
    expect(s).toContain("$env:ProgramFiles, $env:ProgramW6432")
    expect(s).toContain('VC_PTY_SHELL')
  })

  it('bash не найден — ставит портативный MinGit в каталог агента', () => {
    const s = buildWindowsInstallScript('http://h')
    expect(s).toContain('git-for-windows/git/releases/latest')
    expect(s).toContain('MinGit-')
    expect(s).toContain("Join-Path $AgentDir 'git'")
  })

  it('шаги пронумерованы [N/8] без пропусков', () => {
    const s = buildWindowsInstallScript('http://h')
    for (let n = 1; n <= 8; n++) {
      expect(s).toContain(`[${n}/8]`)
    }
    expect(s).not.toContain('/7]')
  })
})
