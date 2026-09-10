import { expect, it } from 'vitest'
import {
  boundedBrowserDialogs,
  isBrowserDialogListResult,
  normalizeBrowserDialogAnswer,
  type BrowserDialogInfo
} from './browserDialogs'
const dialog = (id: string): BrowserDialogInfo => ({
  id,
  tabId: id,
  type: 'prompt',
  message: 'Название',
  defaultValue: 'Черновик',
  openedAt: 1
})
it('ответ требует явного решения и различает пропущенный и пустой текст', () => {
  expect(normalizeBrowserDialogAnswer({ dialogId: 'd', accept: true })).not.toHaveProperty('promptText')
  expect(normalizeBrowserDialogAnswer({ dialogId: 'd', accept: true, promptText: '' })).toHaveProperty('promptText', '')
  for (const value of [
    { dialogId: 'd' },
    { dialogId: '', accept: true },
    { dialogId: 'd', accept: false, promptText: '' }
  ])
    expect(() => normalizeBrowserDialogAnswer(value as never)).toThrow()
})
it('активный диалог сохраняется в ограниченном списке без мутации исходного массива', () => {
  const dialogs = Array.from({ length: 20 }, (_, index) => ({
    ...dialog(String(index)),
    message: 'x'.repeat(4000),
    defaultValue: 'y'.repeat(2000)
  }))
  const result = boundedBrowserDialogs(dialogs, '19')
  expect(result.dialogs[0].id).toBe('19')
  expect(result.total).toBe(20)
  expect(result.truncated).toBe(true)
  expect(JSON.stringify(result).length).toBeLessThan(16000)
  expect(dialogs[0].id).toBe('0')
})
it('ready-метаданные старого раннера не подтверждают поддержку диалогов', () => {
  expect(isBrowserDialogListResult({ ok: true, dialogs: [dialog('1')], total: 1 })).toBe(true)
  for (const value of [
    { state: 'ready' },
    { ok: true },
    { ok: true, dialogs: [{}], total: 1 },
    { ok: true, dialogs: [], total: -1 }
  ])
    expect(isBrowserDialogListResult(value)).toBe(false)
})

it('управляющие символы не вытесняют активный диалог из JSON-бюджета', () => {
  const result = boundedBrowserDialogs([{ ...dialog('1'), message: '\u0001'.repeat(4000), defaultValue: '\u0002'.repeat(2000) }], '1')
  expect(result.dialogs).toHaveLength(1)
  expect(result.dialogs[0].messageTruncated).toBe(true)
  expect(JSON.stringify(result).length).toBeLessThan(16000)
})
