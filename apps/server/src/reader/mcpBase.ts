// Адрес MCP «browser» глазами исполнителя LLM: во встроенном режиме — публичная база ядра (`VC_MCP_PUBLIC_BASE`),
// в `VC_READER_MODE=remote` — процесс ридера (`VC_READER_MCP_PUBLIC_BASE`, иначе `VC_READER_URL`). Один helper
// на ядро и процесс канбана: оба выдают ходам `previewMcpBaseUrl`, и расходиться им нельзя.
import type { ServerConfig } from '../config.js'
import { buildPublicMcpUrl } from '../mcp/publicBase.js'
import { PREVIEW_MCP_PATH } from '../mcp/previewMcp.js'

export function previewMcpBaseUrlOf(config: Pick<ServerConfig, 'port' | 'mcpPublicBase' | 'readerMode' | 'readerUrl' | 'readerMcpPublicBase'>, mcpSecret: string): string {
  if (config.readerMode === 'remote') {
    const base = (config.readerMcpPublicBase ?? config.readerUrl ?? '').replace(/\/+$/, '')
    return `${base}${PREVIEW_MCP_PATH}?k=${mcpSecret}`
  }
  return buildPublicMcpUrl(config, PREVIEW_MCP_PATH, mcpSecret)
}
