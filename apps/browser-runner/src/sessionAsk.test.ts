// Круг 10: просьба модели к человеку. Есть места, где действовать самой нельзя
// и не нужно — код из СМС, капча, вход паролем из менеджера: раньше модель
// упиралась в такой экран и либо стояла молча, либо пыталась пройти его сама.

import { describe, expect, it, vi } from 'vitest'
import { BrowserDialogs } from './dialogs.js'
import { BrowserDownloads } from './downloads.js'
import { BrowserCommandQueue } from './commandQueue.js'
import { SessionHistory } from './sessionHistory.js'
import { BrowserSessionManager } from './sessionManager.js'

function withSession() {
  const manager = new BrowserSessionManager('/tmp/unused-reader-ask', new Map())
  const page = { url: () => 'https://a.b/', title: async () => 'Страница' }
  const session = {
    dialogs: new BrowserDialogs(), downloads: new BrowserDownloads((url) => url), openerIds: new Map(),
    history: new SessionHistory(), queue: new BrowserCommandQueue(), profileMode: 'ephemeral' as const,
    id: 'c', conversationKey: 'c', incarnation: 'inc', activeTabId: 'tab',
    pages: new Map([['tab', page]]), viewport: { width: 800, height: 600, deviceScaleFactor: 1 }, lastUsedAt: 0
  }
  ;(manager as unknown as { sessions: Map<string, Promise<unknown>> }).sessions.set('c', Promise.resolve(session))
  const send = (command: unknown, actor: 'user' | 'assistant' = 'assistant') =>
    manager.command('c', { requestId: 'r', incarnation: 'inc', actor, command } as never)
  // Фейковая сессия собрана из частей: открытую просьбу читаем через unknown,
  // потому что полем `ask` её тип здесь не описан.
  const openAsk = () => (session as unknown as { ask?: { id: string } }).ask
  return { manager, session, send, openAsk }
}

describe('просьба к человеку', () => {
  it('ждёт ответа и возвращает его модели одним вызовом', async () => {
    const { session, send, openAsk } = withSession()
    const asked = send({ type: 'ask', text: 'Введите код из СМС', timeoutMs: 5_000 })
    await vi.waitFor(() => expect(openAsk()?.id).toBeTruthy())
    const askId = openAsk()!.id
    await send({ type: 'answer', askId, done: true, text: 'ввёл' }, 'user')
    expect(await asked).toMatchObject({ ask: { done: true, text: 'ввёл' } })
  })

  it('отказ человека — это ответ, а не ошибка', async () => {
    const { session, send, openAsk } = withSession()
    const asked = send({ type: 'ask', text: 'Пройдите капчу', timeoutMs: 5_000 })
    await vi.waitFor(() => expect(openAsk()?.id).toBeTruthy())
    await send({ type: 'answer', askId: openAsk()!.id, done: false }, 'user')
    expect(await asked).toMatchObject({ ask: { done: false } })
  })

  it('по таймауту просьба закрывается и говорит об этом', async () => {
    const { send } = withSession()
    expect(await send({ type: 'ask', text: 'Подтвердите вход', timeoutMs: 5_000 })).toMatchObject({ ask: { timedOut: true, done: false } })
  }, 20_000)

  it('отвечать может только человек: иначе модель закроет собственную просьбу', async () => {
    const { session, send, openAsk } = withSession()
    const asked = send({ type: 'ask', text: 'Войдите паролем', timeoutMs: 5_000 })
    await vi.waitFor(() => expect(openAsk()?.id).toBeTruthy())
    await expect(send({ type: 'answer', askId: openAsk()!.id, done: true }, 'assistant')).rejects.toThrow('human_control')
    await send({ type: 'answer', askId: openAsk()!.id, done: true }, 'user')
    await asked
  })

  it('ответ на закрытую просьбу отвергается словами', async () => {
    const { send } = withSession()
    await expect(send({ type: 'answer', askId: 'нет такой', done: true }, 'user')).rejects.toThrow('закрыта')
  })

  it('просьба и ответ попадают в ленту сессии', async () => {
    const { session, send, openAsk } = withSession()
    const asked = send({ type: 'ask', text: 'Введите код', timeoutMs: 5_000 })
    await vi.waitFor(() => expect(openAsk()?.id).toBeTruthy())
    await send({ type: 'answer', askId: openAsk()!.id, done: true }, 'user')
    await asked
    const titles = session.history.list().entries.map((entry) => entry.title)
    expect(titles.some((title) => title.includes('просьба человеку'))).toBe(true)
    expect(titles.some((title) => title.includes('человек сделал'))).toBe(true)
  })
})
