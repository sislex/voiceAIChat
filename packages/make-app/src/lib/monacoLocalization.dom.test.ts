import { afterEach, expect, it } from 'vitest'
import { waitFor } from '@testing-library/dom'
import { localizeMonacoChrome } from './monacoLocalization'
import { setMakeLocale } from '../i18n'

let adapter: ReturnType<typeof localizeMonacoChrome> | undefined
afterEach(() => { adapter?.dispose(); document.body.innerHTML = ''; localStorage.clear() })

it('translates editor controls without changing code, input values, or surrounding content', async () => {
  document.body.innerHTML = '<p>Find</p><div id="editor"><div class="view-lines">Copy</div><div class="find-widget"><input placeholder="Find" aria-label="Find" value="Find"><button title="Match Case (Alt+C)">Replace</button></div></div>'
  const root = document.getElementById('editor')!
  const input = root.querySelector('input')!
  setMakeLocale('ru')
  adapter = localizeMonacoChrome(root)
  expect(input.placeholder).toBe('Найти')
  expect(input.value).toBe('Find')
  expect(root.querySelector('.view-lines')!.textContent).toBe('Copy')
  expect(document.querySelector('p')!.textContent).toBe('Find')
  expect(root.querySelector('button')!.title).toContain('(Alt+C)')
  setMakeLocale('en'); adapter.refresh()
  expect(input.placeholder).toBe('Find')
  expect(root.querySelector('button')!.textContent).toBe('Replace')
  setMakeLocale('ru'); adapter.refresh()
  input.setAttribute('placeholder', 'Replace')
  await waitFor(() => expect(input.placeholder).toBe('Заменить'))
  setMakeLocale('en'); adapter.refresh()
  expect(input.placeholder).toBe('Replace')
})

it('localizes menus for an editor that was already focused when its adapter loaded', async () => {
  document.body.innerHTML = '<div id="editor"><textarea></textarea></div>'
  const root = document.getElementById('editor')!
  root.querySelector('textarea')!.focus()
  setMakeLocale('ru')
  adapter = localizeMonacoChrome(root)
  const menu = document.createElement('div')
  menu.className = 'context-view'
  menu.innerHTML = '<div class="monaco-menu"><button>Copy</button></div>'
  document.body.append(menu)
  await waitFor(() => expect(menu.textContent).toBe('Копирование'))
  setMakeLocale('en'); adapter.refresh()
  expect(menu.textContent).toBe('Copy')
})
