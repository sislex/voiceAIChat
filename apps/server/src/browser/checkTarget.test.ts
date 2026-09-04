import { describe, it, expect } from 'vitest'
import { DEFAULT_CI_BROWSER_CHECK, type CiBrowserCheck } from '@voicechat/shared'
import { browserCheckTarget, withMachinePreviewTarget } from './checkTarget.js'

const check = (mode: CiBrowserCheck['mode']): CiBrowserCheck => ({ ...DEFAULT_CI_BROWSER_CHECK, mode })

describe('выбор цели браузерного действия', () => {
  it('разговор Playwright Reader остаётся при своей сессии', () => {
    expect(browserCheckTarget({ conversationId: 'conv-1', taskId: null, playwrightReader: true, check: check('off') }))
      .toEqual({ sessionId: 'conv-1', conversationKey: 'conv-1' })
  })

  it('задача с режимом chromium получает сессию по задаче, а не по разговору', () => {
    expect(browserCheckTarget({ conversationId: 'conv-1', taskId: 'task-7', playwrightReader: false, check: check('chromium') }))
      .toEqual({ sessionId: 'task-task-7', conversationKey: 'task-task-7' })
  })

  it('без задачи, при выключенном режиме и при панели пользователя цели нет', () => {
    expect(browserCheckTarget({ conversationId: 'conv-1', taskId: null, playwrightReader: false, check: check('chromium') })).toBeNull()
    expect(browserCheckTarget({ conversationId: 'conv-1', taskId: 'task-7', playwrightReader: false, check: check('off') })).toBeNull()
    expect(browserCheckTarget({ conversationId: 'conv-1', taskId: 'task-7', playwrightReader: false, check: check('user_panel') })).toBeNull()
  })
})

describe('подмена адреса машины на прокси превью', () => {
  it('open на машину уходит через прокси', () => {
    const action = withMachinePreviewTarget({ kind: 'open', url: 'http://agent-1.machine.internal:5173/board' }, 'http://voicechat:8787')
    expect(action).toEqual({ kind: 'open', url: 'http://voicechat:8787/api/preview?url=http%3A%2F%2Fagent-1.machine.internal%3A5173%2Fboard' })
  })

  it('публичный адрес и прочие действия не меняются', () => {
    const open = { kind: 'open', url: 'https://example.test/' } as const
    expect(withMachinePreviewTarget(open, 'http://voicechat:8787')).toEqual(open)
    const click = { kind: 'click', selector: '#ok' } as const
    expect(withMachinePreviewTarget(click, 'http://voicechat:8787')).toBe(click)
  })
})
