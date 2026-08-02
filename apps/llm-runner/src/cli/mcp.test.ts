import { describe, it, expect } from 'vitest'
import { listMcpServers, type ExecFileFn } from './mcp'

describe('listMcpServers', () => {
  it('парсит вывод claude mcp list', async () => {
    const exec: ExecFileFn = (_cmd, _args, cb) => cb(null, 'fs: npx server - ✓ Connected')
    const servers = await listMcpServers(exec)
    expect(servers).toHaveLength(1)
    expect(servers[0].name).toBe('fs')
    expect(servers[0].connected).toBe(true)
  })

  it('при ошибке CLI (пустой stdout) → пустой список', async () => {
    const exec: ExecFileFn = (_cmd, _args, cb) => cb(new Error('ENOENT'), '')
    expect(await listMcpServers(exec)).toEqual([])
  })

  it('исключение в exec не роняет — []', async () => {
    const exec: ExecFileFn = () => {
      throw new Error('boom')
    }
    expect(await listMcpServers(exec)).toEqual([])
  })
})
