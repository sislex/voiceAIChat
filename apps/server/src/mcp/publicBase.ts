import type { ServerConfig } from '../config.js'

/** Публичная база MCP-эндпоинтов для исполнителя; без env остаёмся на loopback dev-сервера. */
export function buildPublicMcpUrl(config: Pick<ServerConfig, 'port' | 'mcpPublicBase'>, path: string, secret: string): string {
  const base = (config.mcpPublicBase ?? `http://127.0.0.1:${config.port}`).replace(/\/+$/, '')
  return `${base}${path}?k=${secret}`
}
