import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UiProviders } from '@voicechat/ui-kit'
import { createFakeApi } from '@voicechat/ui-foundation/test/fakeApi'
import { MakePane } from '../components/MakePane'
import { MakeControlField } from '../components/MakeControls'
import { MakeSharedView } from '../components/MakeSharedView'
import { useConfirm, useToast } from './ui'
import { makeMessages } from './messages'
import { commonMakeMessages } from './commonMessages'
import { describeMakeError, getMakeLocale, MAKE_LOCALE_KEY, makeTurnLabel, mt, setMakeLocale, translateMake } from './index'

afterEach(() => { cleanup(); vi.restoreAllMocks(); setMakeLocale('ru'); localStorage.clear(); document.cookie = 'vc_make_locale=; Path=/; Max-Age=0' })

function pane(api = createFakeApi([])) {
  return render(<UiProviders><MakePane conversationId="locale-test" api={api} autosaveDelayMs={60_000} /></UiProviders>)
}

describe('Make interface languages', () => {
  it('switches language without replacing the editor, losing a draft, or changing preview-language emulation', async () => {
    pane()
    await userEvent.click(screen.getByRole('tab', { name: 'Код' }))
    const editor = await screen.findByLabelText('Содержимое index.html')
    fireEvent.change(editor, { target: { value: '<h1>Сохранить пользовательский текст</h1>' } })
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Язык интерфейса Make' }), 'en')
    expect(screen.getByRole('tab', { name: 'Code' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('Contents of index.html')).toBe(editor)
    expect(editor).toHaveValue('<h1>Сохранить пользовательский текст</h1>')
    expect(screen.getByTestId('make-pane')).toHaveAttribute('lang', 'en')
    expect(localStorage.getItem(MAKE_LOCALE_KEY)).toBe('en')
    await userEvent.click(screen.getByRole('tab', { name: 'Preview' }))
    await userEvent.click(screen.getByRole('button', { name: 'More' }))
    expect(screen.getByRole('combobox', { name: 'Preview language' })).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Project templates' })).toBeInTheDocument()
  })

  it('localizes dialogs and their close controls, including text from shared template metadata', async () => {
    setMakeLocale('en'); pane()
    await userEvent.click(screen.getByRole('button', { name: 'More' }))
    await userEvent.click(screen.getByRole('button', { name: 'Project templates' }))
    const dialog = screen.getByRole('dialog', { name: 'Project templates' })
    expect(dialog).toHaveAttribute('lang', 'en')
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeInTheDocument()
    expect(within(dialog).getByText('Blank page')).toBeInTheDocument()
    expect(within(dialog).getByText('Starter files: index.html, styles.css, app.js.')).toBeInTheDocument()
    act(() => setMakeLocale('ru'))
    expect(screen.getByRole('dialog', { name: 'Шаблоны проекта' })).toHaveAttribute('lang', 'ru')
    expect(screen.getByText('Пустая страница')).toBeInTheDocument()
  })

  it('translates existing error banners when language changes without repeating the request', async () => {
    const api = createFakeApi([])
    api['make:state'] = vi.fn().mockRejectedValue(new Error('Файл «страница.html» не найден'))
    pane(api)
    expect(await screen.findByRole('alert')).toHaveTextContent('Файл «страница.html» не найден')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Язык интерфейса Make' }), 'en')
    expect(screen.getByRole('alert')).toHaveTextContent('File “страница.html” not found')
    expect(api['make:state']).toHaveBeenCalledTimes(1)
  })

  it('shows localized JSON validation instead of browser-dependent parser messages', () => {
    setMakeLocale('en')
    const change = vi.fn()
    render(<MakeControlField name="data" base={{ a: 1 }} value={{ a: 1 }} onChange={change} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '{broken' } })
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid JSON. Check quotes, commas, and brackets.')
    expect(change).not.toHaveBeenCalled()
    act(() => setMakeLocale('ru'))
    expect(screen.getByRole('alert')).toHaveTextContent('Некорректный JSON')
  })

  it('applies a saved choice in shared-project error views', async () => {
    localStorage.setItem(MAKE_LOCALE_KEY, 'en')
    const api = createFakeApi([])
    api['make:shared'] = vi.fn().mockRejectedValue(new Error('Ссылка недействительна или отозвана'))
    render(<UiProviders><MakeSharedView token="missing" api={api} onBack={() => undefined} /></UiProviders>)
    expect(await screen.findByRole('alert')).toHaveTextContent('The link is invalid or has been revoked')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(screen.getByText('Details')).toBeInTheDocument()
  })

  it('responds to language changes from another tab and falls back safely for invalid saved values', () => {
    pane()
    act(() => { localStorage.setItem(MAKE_LOCALE_KEY, 'en'); window.dispatchEvent(new StorageEvent('storage', { key: MAKE_LOCALE_KEY, newValue: 'en' })) })
    expect(screen.getByRole('tab', { name: 'History' })).toBeInTheDocument()
    act(() => { localStorage.setItem(MAKE_LOCALE_KEY, 'unsupported'); window.dispatchEvent(new StorageEvent('storage', { key: MAKE_LOCALE_KEY, newValue: 'unsupported' })) })
    expect(getMakeLocale()).toBe('ru')
    expect(screen.getByRole('tab', { name: 'История' })).toBeInTheDocument()
  })

  it('keeps a language choice in memory when browser storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    setMakeLocale('en'); expect(mt('preview')).toBe('Preview')
    setMakeLocale('ru'); expect(mt('preview')).toBe('Превью')
  })

  it('switches language in memory when storage writes fail but the old preference remains readable', async () => {
    setMakeLocale('ru'); pane()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota exceeded') })
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Язык интерфейса Make' }), 'en')
    expect(screen.getByRole('tab', { name: 'History' })).toBeInTheDocument()
    expect(localStorage.getItem(MAKE_LOCALE_KEY)).toBe('ru')
    expect(getMakeLocale()).toBe('en')
  })

  it('formats Russian and English turn plurals and translates known network failures', () => {
    setMakeLocale('ru')
    expect([1, 2, 5, 11, 21, 22].map(makeTurnLabel)).toEqual(['ход', 'хода', 'ходов', 'ходов', 'ход', 'хода'])
    setMakeLocale('en')
    expect([1, 2, 21].map(makeTurnLabel)).toEqual(['turn', 'turns', 'turns'])
    expect(describeMakeError(new TypeError('Failed to fetch'))).toBe('No connection to the server. Try again.')
    expect(describeMakeError(new Error('load failed'))).toBe('load failed')
  })

  it('has complete, matching interpolation parameters in both interface catalogs', () => {
    const parameters = (value: string) => [...new Set(value.match(/\{p\d+\}/g))].sort()
    for (const [key, message] of Object.entries({ ...makeMessages, ...commonMakeMessages })) {
      expect(message.ru, key).not.toBe('')
      expect(message.en, key).not.toMatch(/[\u0400-\u04ff]/u)
      expect(parameters(message.en), key).toEqual(parameters(message.ru))
    }
    expect(translateMake('contentsOfValue', 'en', { p0: 'файл.tsx' })).toBe('Contents of файл.tsx')
  })
})

it('localizes confirmation safety text and notification controls through the shared providers', async () => {
  function Actions() {
    const confirm = useConfirm()
    const toast = useToast()
    return <button onClick={async () => {
      if (await confirm({ title: 'Удалить', requireText: 'demo' })) toast.success('Ссылка скопирована', { duration: 0 })
    }}>Run</button>
  }
  setMakeLocale('en')
  render(<UiProviders><Actions /></UiProviders>)
  await userEvent.click(screen.getByRole('button', { name: 'Run' }))
  expect(screen.getByRole('dialog')).toHaveAttribute('lang', 'en')
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  const proceed = screen.getByRole('button', { name: 'Continue' })
  expect(proceed).toBeDisabled()
  act(() => setMakeLocale('ru'))
  expect(screen.getByRole('button', { name: 'Отмена' })).toBeInTheDocument()
  await userEvent.type(screen.getByRole('textbox', { name: 'Для подтверждения введите «demo»' }), 'demo')
  act(() => setMakeLocale('en'))
  expect(screen.getByRole('textbox', { name: 'Type “demo” to confirm' })).toHaveValue('demo')
  await userEvent.click(proceed)
  expect(await screen.findByText('Link copied')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Dismiss notification' })).toBeInTheDocument()
  act(() => setMakeLocale('ru'))
  expect(screen.getByText('Ссылка скопирована')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Закрыть уведомление' })).toBeInTheDocument()
  expect(screen.getAllByTestId('toast-success')).toHaveLength(1)
  act(() => setMakeLocale('en'))
  await userEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }))
  expect(screen.queryByTestId('toast-success')).not.toBeInTheDocument()
})
