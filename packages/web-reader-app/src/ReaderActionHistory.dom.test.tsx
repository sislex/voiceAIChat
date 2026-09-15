import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ReaderActionHistory } from './ReaderActionHistory'
const actions = [
  { id: 'a', action: { kind: 'click' as const, text: 'Continue' }, title: 'Account page', address: 'https://account.test/path?secret=hidden' },
  { id: 'b', action: { kind: 'read' as const }, title: 'News', address: 'https://news.test/' }
]
afterEach(() => { cleanup(); sessionStorage.clear() })
const mount = () => render(<ReaderActionHistory actions={actions} />)
it('collapses and reopens the action list', () => {
  mount(); const toggle = screen.getByRole('button', { name: 'Действия ассистента' })
  fireEvent.click(toggle); expect(screen.queryByRole('list')).not.toBeInTheDocument(); expect(toggle).toHaveAttribute('aria-expanded', 'false')
  fireEvent.click(toggle); expect(screen.getByRole('list')).toBeVisible()
})
it('reports the total count while filtering', () => {
  mount(); fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Continue' } })
  expect(screen.getByLabelText('Количество действий')).toHaveTextContent('2')
  expect(screen.getAllByRole('listitem')).toHaveLength(1)
})
it('searches action labels without case sensitivity', () => {
  mount(); fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'continue' } })
  expect(screen.getAllByRole('listitem')).toHaveLength(1)
})
it('searches page titles and site names', () => {
  mount(); fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'account page' } }); expect(screen.getAllByRole('listitem')).toHaveLength(1)
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'news.test' } }); expect(screen.getAllByRole('listitem')).toHaveLength(1)
})
it('announces when search has no matches', () => {
  mount(); fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'missing' } })
  expect(screen.getByRole('status')).toHaveTextContent('Действия не найдены')
})
it('clears search by button and Escape', () => {
  mount(); const search = screen.getByRole('searchbox')
  fireEvent.change(search, { target: { value: 'missing' } }); fireEvent.click(screen.getByRole('button', { name: 'Очистить поиск' })); expect(search).toHaveValue('')
  fireEvent.change(search, { target: { value: 'missing' } }); fireEvent.keyDown(search, { key: 'Escape' }); expect(search).toHaveValue('')
})
it('shows the recorded page title', () => { mount(); expect(screen.getByText('Account page')).toBeVisible() })
it('shows site names without query parameters or credentials', () => {
  mount(); expect(screen.getByText('account.test')).toBeVisible(); expect(screen.queryByText(/secret=hidden/)).not.toBeInTheDocument()
})
it('gives repeat controls distinct names and preserves the selected action', () => {
  const repeat = vi.fn(); render(<ReaderActionHistory actions={actions} onRepeat={repeat} />)
  fireEvent.click(screen.getByRole('button', { name: 'Повторить действие 1: Нажал Continue' })); expect(repeat).toHaveBeenCalledWith(actions[0].action)
  expect(screen.getByRole('button', { name: 'Повторить действие 2: Прочитал страницу' })).toBeVisible()
})
it('resets local history controls when the conversation key changes', () => {
  const view = render(<ReaderActionHistory key="first" actions={actions} />)
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'missing' } })
  view.rerender(<ReaderActionHistory key="second" actions={actions} />)
  expect(screen.getByRole('searchbox')).toHaveValue(''); expect(screen.getAllByRole('listitem')).toHaveLength(2)
})
it('starts collapsed on a narrow screen and shows the event time', () => {
  const original = window.matchMedia
  window.matchMedia = ((query: string) => ({ matches: query.includes('max-width: 560px'), media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as typeof window.matchMedia
  try {
    render(<ReaderActionHistory actions={[{ ...actions[1], at: new Date(2026, 8, 14, 9, 5).getTime() }]} />)
    expect(screen.getByRole('button', { name: 'Действия ассистента' })).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'Действия ассистента' }))
    expect(screen.getByRole('listitem')).toHaveTextContent('09:05')
  } finally { window.matchMedia = original }
})

it('offers «Показать» only for steps with a selector and hides search until the list grows', () => {
  const onReveal = vi.fn()
  const { unmount } = render(<ReaderActionHistory actions={[{ id: 'c', action: { kind: 'click', selector: '#buy' }, title: null, address: null }]} onReveal={onReveal} />)
  expect(screen.queryByRole('searchbox')).toBeNull()
  unmount()
  render(<ReaderActionHistory actions={[{ id: 'c', action: { kind: 'click', selector: '#buy' }, title: null, address: null }, ...actions]} onReveal={onReveal} />)
  expect(screen.getByRole('searchbox')).toBeTruthy()
  // Клик по селектору и клик по тексту показываются; чтение — нет.
  expect(screen.getAllByRole('button', { name: /Показать на странице/ })).toHaveLength(2)
  fireEvent.click(screen.getAllByRole('button', { name: /Показать на странице/ })[0])
  expect(onReveal).toHaveBeenCalledWith({ selector: '#buy' })
})

it('shows check verdicts with summaries and disables reveal on another page', () => {
  render(<ReaderActionHistory currentUrl="https://now.test/" onReveal={vi.fn()} actions={[
    { id: 'ok', action: { kind: 'check', text: 'Войти' }, title: null, address: 'https://now.test/', ok: true, summary: '«Войти» видно' },
    { id: 'bad', action: { kind: 'check', text: 'Строка', count: 3 }, title: null, address: 'https://now.test/', ok: false, summary: '.row: 2 из 3 — не совпало' },
    { id: 'old', action: { kind: 'click', selector: '#buy' }, title: null, address: 'https://old.test/' }
  ]} />)
  expect(screen.getByLabelText('Проверка пройдена')).toBeTruthy()
  expect(screen.getByLabelText('Проверка не пройдена')).toBeTruthy()
  expect(screen.getByText('.row: 2 из 3 — не совпало')).toBeTruthy()
  const reveals = screen.getAllByRole('button', { name: /Показать на странице/ }) as HTMLButtonElement[]
  expect(reveals.filter((button) => button.disabled)).toHaveLength(1)
  expect(reveals.find((button) => button.disabled)!.title).toBe('Открыта другая страница')
})

it('filters to failed checks and clears the feed', () => {
  const onClear = vi.fn()
  render(<ReaderActionHistory onClear={onClear} actions={[
    { id: 'ok', action: { kind: 'check', text: 'Войти' }, title: null, address: null, ok: true, summary: 'видно' },
    { id: 'bad', action: { kind: 'check', text: 'Корзина' }, title: null, address: null, ok: false, summary: 'не видно' },
    { id: 'read', action: { kind: 'read' }, title: null, address: null }
  ]} />)
  fireEvent.click(screen.getByRole('button', { name: 'Только ✗ (1)' }))
  expect(screen.getAllByRole('listitem')).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: 'Очистить ленту действий' }))
  expect(onClear).toHaveBeenCalledOnce()
})

it('manual mode disables repeat and reveal; details show the action JSON', () => {
  render(<ReaderActionHistory manual onRepeat={vi.fn()} onReveal={vi.fn()} actions={[{ id: 'c', action: { kind: 'click', selector: '#buy', text: 'Купить' }, title: null, address: null }]} />)
  expect((screen.getByRole('button', { name: /Повторить действие 1/ }) as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByRole('button', { name: /Показать на странице/ }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Подробности действия 1' }))
  expect(screen.getByText(/"selector": "#buy"/)).toBeTruthy()
})

it('shows verdict counts, repeat counters and short open labels', () => {
  render(<ReaderActionHistory actions={[
    { id: 'o', action: { kind: 'open', url: 'https://shop.example/catalog/very/long/path/that/keeps/going/and/going/forever/more' }, title: null, address: null },
    { id: 'r', action: { kind: 'read' }, title: null, address: null, count: 3 },
    { id: 'ok', action: { kind: 'check', text: 'Войти' }, title: null, address: null, ok: true, summary: 'видно' }
  ]} />)
  expect(screen.getByLabelText('Проверок пройдено 1, не пройдено 0')).toBeTruthy()
  expect(screen.getByLabelText('повторено 3 раз')).toBeTruthy()
  expect(screen.getByText(/Открыл shop\.example\/catalog/).textContent!.length).toBeLessThan(80)
})

it('copies the feed as text lines', () => {
  const writeText = vi.fn(async () => undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  render(<ReaderActionHistory actions={[{ id: 'ok', action: { kind: 'check', text: 'Войти' }, title: null, address: 'https://shop.example/', ok: true, summary: '«Войти» видно' }]} />)
  fireEvent.click(screen.getByRole('button', { name: 'Скопировать ленту действий' }))
  expect(writeText).toHaveBeenCalledWith(expect.stringContaining('✓ Проверил «Войти» — «Войти» видно (shop.example)'))
})

it('reveals steps by text when they have no selector and marks fresh steps as just now', () => {
  const onReveal = vi.fn()
  render(<ReaderActionHistory onReveal={onReveal} actions={[{ id: 'c', action: { kind: 'click', text: 'Купить' }, title: null, address: null, at: Date.now() }]} />)
  fireEvent.click(screen.getByRole('button', { name: /Показать на странице/ }))
  expect(onReveal).toHaveBeenCalledWith({ text: 'Купить' })
  expect(screen.getByRole('listitem').textContent).toContain('только что')
})

it('filters steps by kind and shows kind icons', () => {
  render(<ReaderActionHistory actions={[
    { id: '1', action: { kind: 'click', text: 'A' }, title: null, address: null },
    { id: '2', action: { kind: 'read' }, title: null, address: null },
    { id: '3', action: { kind: 'check', text: 'B' }, title: null, address: null, ok: true, summary: 'ok' },
    { id: '4', action: { kind: 'type', selector: '#x', text: 'y' }, title: null, address: null }
  ]} />)
  expect(screen.getAllByRole('listitem')).toHaveLength(4)
  fireEvent.change(screen.getByRole('combobox', { name: 'Какие шаги показывать' }), { target: { value: 'checks' } })
  expect(screen.getAllByRole('listitem')).toHaveLength(1)
  fireEvent.change(screen.getByRole('combobox', { name: 'Какие шаги показывать' }), { target: { value: 'actions' } })
  expect(screen.getAllByRole('listitem')).toHaveLength(2)
})

it('offers to open the page of a step made elsewhere', () => {
  const onRepeat = vi.fn()
  render(<ReaderActionHistory currentUrl="https://now.test/" onRepeat={onRepeat} actions={[{ id: 'o', action: { kind: 'click', text: 'A' }, title: null, address: 'https://old.test/page' }]} />)
  fireEvent.click(screen.getByRole('button', { name: 'Открыть страницу действия 1' }))
  expect(onRepeat).toHaveBeenCalledWith({ kind: 'open', url: 'https://old.test/page' })
})

it('подпись шага лежит отдельным элементом: значок не приклеивается к тексту действия', () => {
  render(<ReaderActionHistory actions={[{ id: '1', action: { kind: 'open', url: 'https://shop.example/' }, address: 'https://shop.example/', title: null, at: Date.now() }]} />)
  // Иконка декоративная и aria-hidden, но текстом она мешала бы и поиску по ленте, и E2E.
  expect(screen.getByText('Открыл shop.example').className).toContain('webpreview-history-label')
})
