import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ReaderActionHistory } from './ReaderActionHistory'
const actions = [
  { id: 'a', action: { kind: 'click' as const, text: 'Continue' }, title: 'Account page', address: 'https://account.test/path?secret=hidden' },
  { id: 'b', action: { kind: 'read' as const }, title: 'News', address: 'https://news.test/' }
]
afterEach(cleanup)
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
