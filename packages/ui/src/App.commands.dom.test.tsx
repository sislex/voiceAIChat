// Палитра и шпаргалка в собранном приложении: клавиши доходят до окна, реестр
// наполнен данными стора, а команда действительно переключает экран.
import { describe, it, expect, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { createFakeApi, type FakeApi } from './test/fakeApi'
import { DEFAULT_SETTINGS } from '@shared/types'

const SLOW = { frame: 100_000, transcribe: 100_000, think: 100_000, speak: 100_000 }

async function renderApp(): Promise<FakeApi> {
  const api = createFakeApi([])
  await api['settings:save']({ ...DEFAULT_SETTINGS, onboarded: true })
  await api['conversations:create']({ title: 'Идеи для подарка' })
  await api['conversations:create']({ title: 'Поездка в Лиссабон' })
  render(<App api={api} delays={SLOW} />)
  await screen.findByText('Поездка в Лиссабон', {}, { timeout: 10_000 })
  return api
}

/** Нажать ⌘K (metaKey — как на macOS; Ctrl проверен в тестах useHotkeys). */
function pressPalette(): void {
  fireEvent.keyDown(window, { key: 'k', metaKey: true })
}

describe('App — командная палитра', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('⌘K открывает палитру, Esc закрывает', async () => {
    await renderApp()
    pressPalette()
    const palette = await screen.findByTestId('command-palette')
    expect(palette).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /Поиск команды/ })).toHaveFocus()

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('command-palette')).toBeNull())
  })

  it('повторное ⌘K закрывает палитру', async () => {
    await renderApp()
    pressPalette()
    await screen.findByTestId('command-palette')
    pressPalette()
    await waitFor(() => expect(screen.queryByTestId('command-palette')).toBeNull())
  })

  it('⌘K работает и из композера — поле ввода не глотает комбинацию', async () => {
    await renderApp()
    const composer = screen.getByPlaceholderText(/Напишите|Расшифровка|Сообщение/i)
    composer.focus()
    pressPalette()
    expect(await screen.findByTestId('command-palette')).toBeInTheDocument()
  })

  it('кнопка «⌘K» рядом с поиском открывает палитру мышью', async () => {
    await renderApp()
    fireEvent.wheel(document.querySelector('.convolist')!, { deltaY: -40 })
    await userEvent.click(screen.getByRole('button', { name: 'Командная палитра' }))
    expect(await screen.findByTestId('command-palette')).toBeInTheDocument()
  })

  it('реестр наполнен беседами стора, и команда переключает беседу', async () => {
    await renderApp()
    pressPalette()
    await screen.findByTestId('command-palette')
    const input = screen.getByRole('combobox', { name: /Поиск команды/ })
    fireEvent.change(input, { target: { value: 'подарка' } })
    const option = (await screen.findAllByRole('option')).find((node) =>
      node.textContent?.includes('Идеи для подарка')
    )
    expect(option, 'беседы стора нет в реестре').toBeDefined()
    fireEvent.click(option!)
    await waitFor(() => expect(window.location.hash).toContain('/chat/'))
    await waitFor(() => expect(screen.queryByTestId('command-palette')).toBeNull())
  })

  it('базовая команда выполняется с клавиатуры: «Открыть базу знаний» уводит на раздел', async () => {
    await renderApp()
    pressPalette()
    await screen.findByTestId('command-palette')
    const input = screen.getByRole('combobox', { name: /Поиск команды/ })
    fireEvent.change(input, { target: { value: 'базу знаний' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(window.location.hash).toBe('#/kb'))
  })

  it('команда «Использование базы знаний» открывает панель телеметрии', async () => {
    await renderApp()
    pressPalette()
    await screen.findByTestId('command-palette')
    const input = screen.getByRole('combobox', { name: /Поиск команды/ })
    fireEvent.change(input, { target: { value: 'Использование базы знаний' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await screen.findByTestId('kb-usage-overlay')).toBeInTheDocument()
  })

  it('«?» открывает шпаргалку, и в ней есть push-to-talk', async () => {
    await renderApp()
    fireEvent.keyDown(window, { key: '?' })
    expect(await screen.findByTestId('hotkeys-sheet')).toBeInTheDocument()
    expect(screen.getByText('Говорить в микрофон')).toBeInTheDocument()
    expect(screen.getByText('Командная палитра')).toBeInTheDocument()
  })

  it('«?» в поле ввода печатается, а не открывает шпаргалку', async () => {
    await renderApp()
    const composer = screen.getByPlaceholderText(/Напишите|Расшифровка|Сообщение/i)
    composer.focus()
    fireEvent.keyDown(window, { key: '?' })
    expect(screen.queryByTestId('hotkeys-sheet')).toBeNull()
  })
})
