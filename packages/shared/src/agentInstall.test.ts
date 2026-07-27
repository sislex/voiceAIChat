import { describe, it, expect } from 'vitest'
import {
  AGENT_OS_LIST,
  agentOsFromPlatform,
  installCommand,
  installScriptUrl,
  serverBaseFromConnection
} from './agentInstall'
import { encodeAgentConnection } from './agentProtocol'

const CONN = encodeAgentConnection({ server: 'wss://host.example/agent', token: 'tok123' })

describe('serverBaseFromConnection', () => {
  it('wss → https, только протокол и хост', () => {
    expect(serverBaseFromConnection(CONN)).toBe('https://host.example')
  })

  it('ws → http и порт сохраняется', () => {
    const c = encodeAgentConnection({ server: 'ws://10.0.0.5:8787/agent', token: 't' })
    expect(serverBaseFromConnection(c)).toBe('http://10.0.0.5:8787')
  })

  it('мусор — null', () => {
    expect(serverBaseFromConnection('не строка подключения')).toBeNull()
  })
})

describe('agentOsFromPlatform', () => {
  it('android важнее платформы (Termux рапортует linux)', () => {
    expect(agentOsFromPlatform('linux', true)).toBe('android')
  })

  it('остальные платформы', () => {
    expect(agentOsFromPlatform('win32')).toBe('windows')
    expect(agentOsFromPlatform('darwin')).toBe('macos')
    expect(agentOsFromPlatform('linux')).toBe('linux')
  })

  it('неизвестная — null (кнопку обновления не показываем)', () => {
    expect(agentOsFromPlatform('freebsd')).toBeNull()
  })
})

describe('installCommand — команда для копирования', () => {
  it('на каждую ОС из списка есть команда с её URL', () => {
    for (const os of AGENT_OS_LIST) {
      const cmd = installCommand(os.id, 'https://host.example', CONN)
      expect(os.name).toMatch(/^[A-Za-z]/) // название без эмодзи — идёт в aria-label
      expect(cmd).toContain(installScriptUrl(os.id, 'https://host.example'))
      expect(cmd).toContain(CONN)
      expect(cmd.includes('\n')).toBe(false) // команда обязана быть одной строкой
    }
  })

  it('unix — curl | bash со строкой подключения аргументом', () => {
    expect(installCommand('linux', 'https://h', CONN)).toBe(
      `curl -fsSLk https://h/api/agents/install-linux.sh | bash -s -- '${CONN}'`
    )
  })

  it('macOS — свой установщик, не linux', () => {
    expect(installCommand('macos', 'https://h', CONN)).toContain('install-macos.sh')
  })

  it('windows — powershell с обходом ExecutionPolicy', () => {
    const cmd = installCommand('windows', 'https://h', CONN)
    expect(cmd).toContain('powershell -NoProfile -ExecutionPolicy Bypass')
    expect(cmd).toContain('install-windows.ps1')
    expect(cmd).toContain(`'${CONN}'`)
    expect(cmd).toMatch(/-Command "Set-Location/)
    expect(cmd).not.toContain("-Command '")
    expect(cmd).toBe(
      `powershell -NoProfile -ExecutionPolicy Bypass -Command "Set-Location ([Environment]::GetEnvironmentVariable('TEMP')); curl.exe -fsSLk https://h/api/agents/install-windows.ps1 -o vc-agent-install.ps1; & .\\vc-agent-install.ps1 '${CONN}'"`
    )
  })

  it('без строки подключения аргумент опускается (обновление уже установленной машины)', () => {
    expect(installCommand('linux', 'https://h')).toBe(
      'curl -fsSLk https://h/api/agents/install-linux.sh | bash'
    )
    expect(installCommand('windows', 'https://h')).toContain('vc-agent-install.ps1"')
    expect(installCommand('windows', 'https://h')).not.toContain('""')
  })

  it('хвостовой слэш в базе не удваивается', () => {
    expect(installCommand('linux', 'https://h/', CONN)).toContain('https://h/api/agents')
  })
})
