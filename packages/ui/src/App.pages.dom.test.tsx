import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { createFakeApi, type FakeApi } from './test/fakeApi'
import { DEFAULT_SETTINGS } from '@shared/types'

const SLOW = { frame: 100_000, transcribe: 100_000, think: 100_000, speak: 100_000 }

// Утилиты («Claude Code», «Codex», «База знаний», «Машины», «Пользователи»)
// живут по своим hash-URL и рендерятся страницами в контентной колонке — как
// «Проекты», а не модалками. Между тестами сбрасываем hash, иначе маршрут
// протекает в соседние кейсы.
afterEach(() => {
  window.location.hash = ''
})

async function renderApp(): Promise<FakeApi> {
  const api = createFakeApi([])
  await api['settings:save']({ ...DEFAULT_SETTINGS, onboarded: true })
  render(<App api={api} delays={SLOW} />)
  return api
}

describe('App — утилиты как страницы по URL', () => {
  it('#/claude-code рендерит проводник Claude Code страницей (не попап), чат скрыт', async () => {
    window.location.hash = '#/claude-code'
    await renderApp()
    const page = await screen.findByTestId('cc-overlay')
    expect(page.closest('.toolpage')).not.toBeNull()
    expect(page.closest('.ovl')).toBeNull()
    expect(screen.queryByLabelText('Поле ввода сообщения')).not.toBeInTheDocument()
  })

  it('пункт «Claude Code» в сайдбаре ведёт на #/claude-code, «Закрыть» возвращает чат', async () => {
    await renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Claude Code' }))
    await waitFor(() => expect(window.location.hash).toBe('#/claude-code'))
    const page = await screen.findByTestId('cc-overlay')
    await userEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
    await waitFor(() => expect(window.location.hash).toBe('#/'))
    expect(page).not.toBeInTheDocument()
    expect(await screen.findByLabelText('Поле ввода сообщения')).toBeInTheDocument()
  })

  it('#/codex рендерит проводник Codex страницей', async () => {
    window.location.hash = '#/codex'
    await renderApp()
    const page = await screen.findByTestId('cx-overlay')
    expect(page.closest('.toolpage')).not.toBeNull()
    expect(page.closest('.ovl')).toBeNull()
  })

  it('#/kb рендерит базу знаний страницей', async () => {
    window.location.hash = '#/kb'
    await renderApp()
    const page = await screen.findByTestId('kb-overlay')
    expect(page.closest('.toolpage')).not.toBeNull()
    expect(page.closest('.ovl')).toBeNull()
  })

  it('в локальном режиме #/machines и #/users редиректят на главную', async () => {
    window.location.hash = '#/machines'
    await renderApp()
    await waitFor(() => expect(window.location.hash).toBe('#/'))
    expect(await screen.findByLabelText('Поле ввода сообщения')).toBeInTheDocument()
    window.location.hash = '#/users'
    await waitFor(() => expect(window.location.hash).toBe('#/'))
  })
})
