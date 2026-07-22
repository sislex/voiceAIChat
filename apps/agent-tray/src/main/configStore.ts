// Хранение конфига агента (адрес сервера + токен) в userData/config.json.
// Чистые функции (dir передаётся снаружи) — тестируются без Electron.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { decodeAgentConnection } from '@shared/agentProtocol'

export interface StoredConfig {
  /** ws(s)://host:port/agent */
  serverUrl: string
  token: string
}

export function configPath(dir: string): string {
  return join(dir, 'config.json')
}

export function readConfig(dir: string): StoredConfig | null {
  try {
    const o = JSON.parse(readFileSync(configPath(dir), 'utf8')) as Partial<StoredConfig>
    if (typeof o.serverUrl === 'string' && o.serverUrl && typeof o.token === 'string' && o.token) {
      return { serverUrl: o.serverUrl, token: o.token }
    }
    return null
  } catch {
    return null
  }
}

export function writeConfig(dir: string, cfg: StoredConfig): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(configPath(dir), JSON.stringify(cfg, null, 2))
}

/** Разбирает строку подключения из веб-настроек в StoredConfig (null — не распознана). */
export function configFromConnectionString(str: string): StoredConfig | null {
  const p = decodeAgentConnection(str)
  return p ? { serverUrl: p.server, token: p.token } : null
}
