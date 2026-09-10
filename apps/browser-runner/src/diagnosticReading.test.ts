import { expect, it } from 'vitest'
import { readBrowserDiagnostics } from './diagnosticReading.js'
const logs = () => ({
  console: [
    { id: '1', tabId: 'a', sequence: 1, level: 'error', text: 'first', at: 1 },
    { id: '2', tabId: 'a', sequence: 2, level: 'warn', text: 'literal [x]', at: 2 },
    { id: '3', tabId: 'b', sequence: 3, level: 'error', text: 'other', at: 3 },
    { id: '4', tabId: 'a', sequence: 4, level: 'error', text: 'last', at: 4 }
  ],
  network: []
})
it('курсор и пагинация независимы от вкладки и очистки', () => {
  const store = logs()
  const page = readBrowserDiagnostics(
    store,
    { kind: 'console', level: 'error', limit: 1, clear: true },
    { tabId: 'a', sequence: 10 }
  )
  expect(page).toMatchObject({ total: 2, returned: 1, cursor: 10, nextBefore: 4, cleared: 1 })
  expect(store.console.map((row) => row.id)).toEqual(['1', '2', '3'])
  expect(
    readBrowserDiagnostics(
      store,
      { kind: 'console', before: page.nextBefore, level: 'error' },
      { tabId: 'a' }
    ).console?.map((row) => row.id)
  ).toEqual(['1'])
})
it('ошибка фильтра не мутирует данные', () => {
  const store = logs()
  expect(readBrowserDiagnostics(store, { kind: 'console', regex: true, pattern: '[', clear: true }).ok).toBe(false)
  expect(store.console).toHaveLength(4)
  expect(readBrowserDiagnostics(store, { kind: 'console', regex: false, pattern: '[x]' }).console).toHaveLength(1)
})
it('результат не ссылается на изменяемую строку сети', () => {
  const store = logs(),
    result = readBrowserDiagnostics(store, { kind: 'console', limit: 1 })
  store.console[3].text = 'changed'
  expect(result.console![0].text).toBe('last')
})
