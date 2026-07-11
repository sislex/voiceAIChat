import { describe, it, expect } from 'vitest'
import { parseMcpList } from './mcp'

describe('parseMcpList', () => {
  it('пустой список при «No MCP servers configured»', () => {
    expect(parseMcpList('No MCP servers configured. Use `claude mcp add` ...')).toEqual([])
  })

  it('игнорирует строку health-check и парсит подключённый сервер', () => {
    const out = [
      'Checking MCP server health...',
      '',
      'fs: npx -y @modelcontextprotocol/server-filesystem /tmp - ✓ Connected'
    ].join('\n')
    const servers = parseMcpList(out)
    expect(servers).toHaveLength(1)
    expect(servers[0]).toMatchObject({
      name: 'fs',
      detail: 'npx -y @modelcontextprotocol/server-filesystem /tmp',
      connected: true
    })
  })

  it('помечает неподключённый сервер', () => {
    const servers = parseMcpList('weather: https://x/sse (SSE) - ✗ Failed to connect')
    expect(servers).toHaveLength(1)
    expect(servers[0].name).toBe('weather')
    expect(servers[0].connected).toBe(false)
  })

  it('пустой ввод → []', () => {
    expect(parseMcpList('')).toEqual([])
  })
})
