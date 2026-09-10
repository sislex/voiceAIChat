import { describe, expect, it } from 'vitest'
import { createLocalPlaywrightReaderCore } from './localCore.js'

describe('выбор исполнителя модели по разговору Web Reader', () => {
  const make = (conversation: unknown) => createLocalPlaywrightReaderCore({ db: { chat: { getConversation: async () => conversation } } as never, issuePreviewRunKey: async () => 'fixture', logBrowserShot: async () => undefined })
  it('полный браузер маршрутизируется в сессию этого же разговора', async () => {
    const core = make({ assistantKind:'web-recorder',previewEngine:'chromium' });expect(await core.modelTarget('alice','c')).toMatchObject({sessionId:'c',conversationKey:'c'});expect(await core.conversation('alice','c')).toEqual({assistantKind:'web-recorder',previewEngine:'chromium'})
  })
  it('быстрый режим сохраняет iframe relay', async () => { expect(await make({assistantKind:'web-recorder',previewEngine:'proxy'}).modelTarget('alice','c')).toBeNull() })
  it('чужой/удалённый разговор не получает native target', async () => { expect(await make(null).modelTarget('alice','c')).toBeNull() })
})
