// Cookie контекста сессии: ключ доступа Chromium к прокси превью сервера.
// Проверяется без запуска Chromium — на подставленном контексте.
//
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { BrowserSessionManager, type StartSessionCookie } from './sessionManager.js'

interface FakeSession { context: { addCookies: ReturnType<typeof vi.fn> } }

async function apply(cookies: unknown): Promise<{ added: unknown[][]; session: FakeSession }> {
  const manager = new BrowserSessionManager('/tmp/vc-browser-profiles-test')
  const added: unknown[][] = []
  const session = { context: { addCookies: vi.fn(async (list: unknown[]) => { added.push(list) }) } }
  const call = (manager as unknown as {
    applyCookies(session: unknown, cookies: StartSessionCookie[] | undefined): Promise<void>
  }).applyCookies.bind(manager)
  await call(session, cookies as StartSessionCookie[] | undefined)
  return { added, session }
}

describe('cookie контекста сессии', () => {
  it('кладёт переданные cookie в контекст', async () => {
    const { added } = await apply([{ name: 'vc_preview_run', value: 'ключ', url: 'http://voicechat:8787/api/preview' }])
    expect(added).toEqual([[{ name: 'vc_preview_run', value: 'ключ', url: 'http://voicechat:8787/api/preview' }]])
  })

  it('без cookie контекст не трогает', async () => {
    expect((await apply(undefined)).session.context.addCookies).not.toHaveBeenCalled()
    expect((await apply([])).session.context.addCookies).not.toHaveBeenCalled()
  })

  it.each([
    [{ name: 'ok', value: 'v', url: 'http://voicechat:8787/' }, { name: 1, value: null }],
    [{ nope: true }]
  ])('повреждённый список отклоняется целиком до запуска Chromium: %j', async (...cookies) => {
    const manager = new BrowserSessionManager('/tmp/vc-browser-profiles-test')
    await expect(manager.start({ sessionId: 'bad-cookie', userKey: 'test', conversationKey: 'test', cookies: cookies as StartSessionCookie[] })).rejects.toThrow(/invalid session cookies/)
    expect(manager.count()).toBe(0)
  })
})
