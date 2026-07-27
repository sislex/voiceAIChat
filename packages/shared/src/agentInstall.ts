// Готовые команды установки/обновления агента на машине — по одной на ОС.
//
// Пользователь копирует строку и вставляет в терминал; скрипт сам проверяет
// Node 22+, при необходимости ставит портативный Node (без прав администратора),
// качает свежий `voicechat-agent.cjs`, ГАСИТ старый процесс и запускает новый.
//
// Поэтому установка и обновление — одна и та же команда: установщики
// идемпотентны. Отдельной «команды обновления» не существует, и это осознанно:
// две почти одинаковые простыни разъезжаются при первой же правке.
//
// Чистые функции — без DOM, сети и файлов.

import { decodeAgentConnection } from './agentProtocol'
import { REST } from './protocol'

/** ОС, для которых есть готовая команда. */
export type AgentOs = 'windows' | 'macos' | 'linux' | 'android'

export interface AgentOsInfo {
  id: AgentOs
  /** Название ОС (идёт и в aria-label — без эмодзи). */
  name: string
  /** Значок для кнопки. */
  icon: string
  /** Куда вставлять команду (подсказка на кнопке). */
  shell: string
}

export const AGENT_OS_LIST: AgentOsInfo[] = [
  { id: 'windows', name: 'Windows', icon: '🪟', shell: 'PowerShell' },
  { id: 'macos', name: 'macOS', icon: '🍎', shell: 'Terminal' },
  { id: 'linux', name: 'Linux', icon: '🐧', shell: 'bash' },
  { id: 'android', name: 'Android', icon: '📱', shell: 'Termux' }
]

/** База сервера (http/https) из строки подключения; null — строка не разобралась. */
export function serverBaseFromConnection(conn: string): string | null {
  const parsed = decodeAgentConnection(conn)
  if (!parsed?.server) return null
  const http = parsed.server.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:')
  try {
    const u = new URL(http)
    return `${u.protocol}//${u.host}`
  } catch {
    return null
  }
}

/** ОС машины по телеметрии (для кнопки «обновить» и подсказки в строке). */
export function agentOsFromPlatform(platform: string, isAndroid = false): AgentOs | null {
  if (isAndroid) return 'android'
  if (platform === 'win32') return 'windows'
  if (platform === 'darwin') return 'macos'
  if (platform === 'linux') return 'linux'
  return null
}

/** Путь установщика по ОС. */
export function installPath(os: AgentOs): string {
  switch (os) {
    case 'windows':
      return REST.agentInstallWindows
    case 'macos':
      return REST.agentInstallMacos
    case 'linux':
      return REST.agentInstallLinux
    case 'android':
      return REST.agentInstallAndroid
  }
}

/** Абсолютный URL установщика для этой ОС. */
export function installScriptUrl(os: AgentOs, base: string): string {
  return `${base.replace(/\/+$/, '')}${installPath(os)}`
}

/**
 * Команда для копирования. Пустой `conn` — законный случай: при обновлении уже
 * установленной машины установщик сам достанет строку подключения (из своего файла
 * или из аргументов живого агента), и передавать токен ещё раз не нужно.
 */
export function installCommand(os: AgentOs, base: string, conn = ''): string {
  const url = installScriptUrl(os, base)
  if (os === 'windows') {
    // Внешние двойные кавычки понимают и cmd.exe, и PowerShell. Внутри не
    // используем $-переменные: родительский PowerShell раскрыл бы их до запуска
    // дочернего процесса. Строка подключения base64url, поэтому одинарные кавычки безопасны.
    const arg = conn ? ` '${conn}'` : ''
    return (
      `powershell -NoProfile -ExecutionPolicy Bypass -Command "` +
      `Set-Location ([Environment]::GetEnvironmentVariable('TEMP')); ` +
      `curl.exe -fsSLk ${url} -o vc-agent-install.ps1; & .\\vc-agent-install.ps1${arg}"`
    )
  }
  // bash -s -- <conn>: скрипт читается из stdin, строка подключения идёт аргументом.
  return conn ? `curl -fsSLk ${url} | bash -s -- '${conn}'` : `curl -fsSLk ${url} | bash`
}

/**
 * Та же команда, но с пояснением, что она делает при повторном запуске. UI
 * показывает её в строке машины, когда агент устарел.
 */
export const UPDATE_HINT =
  'Команда та же, что при установке: она погасит старый агент, заменит скрипт и запустит новый.'
