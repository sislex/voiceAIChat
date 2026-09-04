// Cookie контекста сессии: ключ доступа Chromium к прокси превью сервера.
// Проверяется без запуска Chromium — на подставленном контексте.
//
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { BrowserSessionManager, type StartSessionCookie } from './sessionManager.js'

interface FakeSession { context: { addCookies: ReturnType<typeof vi.fn> } }

function apply(cookies: unknown): { added: unknown[][]; session: FakeSession } {
  const manager = new BrowserSessionManager('/tmp/vc-browser-profiles-test')
  const added: unknown[][] = []
  const session = { context: { addCookies: vi.fn(async (list: unknown[]) => { added.push(list) }) } }
  const call = (manager as unknown as {
    applyCookies(session: unknown, cookies: StartSessionCookie[] | undefined): Promise<void>
  }).applyCookies.bind(manager)
  void call(session, cookies as StartSessionCookie[] | undefined)
  return { added, session }
}

describe('cookie контекста сессии', () => {
  it('кладёт переданные cookie в контекст', () => {
    const { added } = apply([{ name: 'vc_preview_run', value: 'ключ', url: 'http://voicechat:8787/api/preview' }])
    expect(added).toEqual([[{ name: 'vc_preview_run', value: 'ключ', url: 'http://voicechat:8787/api/preview' }]])
  })

  it('без cookie контекст не трогает', () => {
    expect(apply(undefined).session.context.addCookies).not.toHaveBeenCalled()
    expect(apply([]).session.context.addCookies).not.toHaveBeenCalled()
  })

  it('битую запись отбрасывает, а не роняет сессию', () => {
    const { added } = apply([{ name: 'ок', value: 'v', url: 'http://voicechat:8787/' }, { name: 1, value: null }])
    expect(added).toEqual([[{ name: 'ок', value: 'v', url: 'http://voicechat:8787/' }]])
  })

  it('целиком битый список не приводит к вызову', () => {
    expect(apply([{ nope: true }]).session.context.addCookies).not.toHaveBeenCalled()
  })
})
