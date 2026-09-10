import { describe, expect, it, vi } from 'vitest'
import { registerPreviewProxy } from './routes/previewProxy.js'
import { registerPreviewMcp } from './mcp/previewMcp.js'
import { createReaderModule, type ReaderDeps } from './module.js'

vi.mock('./routes/previewProxy.js', () => ({ registerPreviewProxy: vi.fn() }))
vi.mock('./mcp/previewMcp.js', () => ({ registerPreviewMcp: vi.fn() }))

describe('сессии сайтов Web Reader', () => {
  it('MCP сбрасывает контейнер собственного HTTP-прокси, сохраняя соседний Reader', async () => {
    const deps = { app: {}, db: {}, core: {}, machines: {}, browser: {}, mcpSecret: 'test' } as unknown as ReaderDeps
    createReaderModule(deps)
    createReaderModule(deps)
    const first = vi.mocked(registerPreviewProxy).mock.calls[0]![1]!.cookies!
    const second = vi.mocked(registerPreviewProxy).mock.calls[1]![1]!.cookies!
    const url = new URL('https://login.example.com/')
    first.store('user', url, 'sid=first')
    second.store('user', url, 'sid=second')
    const context = vi.mocked(registerPreviewMcp).mock.calls[0]![1]!.context!
    expect(await context.clearCookies!({ userId: 'user', conversationId: 'reader' }, url.hostname)).toBe(1)
    expect(first.header('user', url)).toBeUndefined()
    expect(second.header('user', url)).toBe('sid=second')
  })
})
