import type { ServerConfig } from '../config.js'

/** Публичная база MCP-эндпоинтов для исполнителя; без env остаёмся на loopback dev-сервера. */
export function buildPublicMcpUrl(config: Pick<ServerConfig, 'port' | 'mcpPublicBase'>, path: string, secret: string): string {
  const base = (config.mcpPublicBase ?? `http://127.0.0.1:${config.port}`).replace(/\/+$/, '')
  return `${base}${path}?k=${secret}`
}

/**
 * Конфигурация, при которой MCP заведомо не работает: CLI живёт в другом
 * контейнере, а адрес эндпоинтов остался loopback-ом — из контейнера исполнителя
 * это его собственный localhost, где сервера нет. Инструменты `mcp__remote__*` и
 * `mcp__kb__*` тогда просто не появляются у модели, без единой ошибки в ленте:
 * модель отвечает «инструмент недоступен», и разбирательство уходит в машины и
 * сеть. Поэтому предупреждение печатается на старте — это единственный след.
 */
export function mcpBaseMisconfigured(
  config: Pick<ServerConfig, 'mcpPublicBase' | 'llmRunnerClaudeUrl' | 'llmRunnerCodexUrl'>
): boolean {
  return !config.mcpPublicBase && Boolean(config.llmRunnerClaudeUrl || config.llmRunnerCodexUrl)
}
