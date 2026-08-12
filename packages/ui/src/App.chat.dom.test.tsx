import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App, { openWebReaderWorkspace } from './App'
import { createFakeApi, type FakeApi } from './test/fakeApi'
import { DEFAULT_SETTINGS } from '@shared/types'

const SLOW = { frame: 100_000, transcribe: 100_000, think: 100_000, speak: 100_000 }

// Адрес чата: любой переход к разговору идёт через #/chat/:id, поэтому ссылку
// можно скопировать и открыть заново. Между тестами hash сбрасывает setup.ts.
afterEach(() => {
  window.location.hash = ''
})

interface Seeded {
  api: FakeApi
  /** Старый разговор (не самый свежий). */
  gifts: string
  /** Самый свежий разговор — его открывает загрузка без адреса. */
  lisbon: string
}

async function seededApi(): Promise<Seeded> {
  const api = createFakeApi([])
  await api['settings:save']({ ...DEFAULT_SETTINGS, onboarded: true })
  const gifts = await api['conversations:create']({ title: 'Идеи для подарка' })
  await api['messages:add']({ conversationId: gifts.id, role: 'u1', text: 'Что подарить?', time: '10:00' })
  const lisbon = await api['conversations:create']({ title: 'Поездка в Лиссабон' })
  await api['messages:add']({ conversationId: lisbon.id, role: 'u1', text: 'Погода в июле?', time: '14:02' })
  return { api, gifts: gifts.id, lisbon: lisbon.id }
}

describe('App — адрес открытого чата (#/chat/:id)', () => {
  it('загрузка без адреса открывает свежий чат и подставляет его id в URL', async () => {
    const { api, lisbon } = await seededApi()
    render(<App api={api} delays={SLOW} />)

    expect(await screen.findByText('Погода в июле?')).toBeInTheDocument()
    await waitFor(() => expect(window.location.hash).toBe(`#/chat/${lisbon}`))
  })

  it('загрузка по ссылке открывает чат из адреса, а не самый свежий', async () => {
    const { api, gifts } = await seededApi()
    window.location.hash = `#/chat/${gifts}`
    render(<App api={api} delays={SLOW} />)

    expect(await screen.findByText('Что подарить?')).toBeInTheDocument()
    expect(screen.queryByText('Погода в июле?')).not.toBeInTheDocument()
    expect(window.location.hash).toBe(`#/chat/${gifts}`)
  })

  it('клик по разговору в сайдбаре меняет адрес, а смена адреса — открытый чат', async () => {
    const { api, gifts, lisbon } = await seededApi()
    render(<App api={api} delays={SLOW} />)
    await screen.findByText('Погода в июле?')

    await userEvent.click(screen.getByText('Идеи для подарка'))
    await waitFor(() => expect(window.location.hash).toBe(`#/chat/${gifts}`))
    expect(await screen.findByText('Что подарить?')).toBeInTheDocument()

    // «Назад» в браузере — это просто смена hash: чат должен переключиться сам.
    window.location.hash = `#/chat/${lisbon}`
    expect(await screen.findByText('Погода в июле?')).toBeInTheDocument()
  })

  it('новый разговор остаётся локальным до первой отправки и получает адрес после неё', async () => {
    const { api } = await seededApi()
    render(<App api={api} delays={SLOW} />)
    await screen.findByText('Погода в июле?')

    await userEvent.click(screen.getByRole('button', { name: '+ Новый' }))
    await userEvent.click(screen.getByRole('button', { name: '+ Новый' }))
    await waitFor(() => expect(window.location.hash).toBe('#/'))
    expect(api._state.conversations).toHaveLength(2)

    // Десктопный композер развёрнут по умолчанию (CHAT-180) — кнопки разворота нет.
    const composer = screen.getByPlaceholderText(/Напишите|Расшифровка|Сообщение/i)
    await userEvent.type(composer, 'Первая реплика{Enter}')
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/chat\/.+/))
    expect(api._state.conversations).toHaveLength(3)
    expect(api._state.conversations.filter((conversation) => conversation.title === 'Первая реплика')).toHaveLength(1)
  })

  it('удаление открытого чата уводит на адрес следующего', async () => {
    const { api, gifts, lisbon } = await seededApi()
    render(<App api={api} delays={SLOW} />)
    await waitFor(() => expect(window.location.hash).toBe(`#/chat/${lisbon}`))

    await userEvent.click(screen.getByLabelText('Удалить разговор «Поездка в Лиссабон»'))
    await userEvent.click(screen.getByText('Удалить'))

    await waitFor(() => expect(window.location.hash).toBe(`#/chat/${gifts}`))
    expect(await screen.findByText('Что подарить?')).toBeInTheDocument()
  })

  it('ссылка на удалённый чат: показываем ошибку и открываем свежий', async () => {
    const { api, lisbon } = await seededApi()
    window.location.hash = '#/chat/нет-такого'
    render(<App api={api} delays={SLOW} />)

    expect(await screen.findByTestId('error-bar')).toHaveTextContent('Разговор не найден')
    expect(await screen.findByText('Погода в июле?')).toBeInTheDocument()
    await waitFor(() => expect(window.location.hash).toBe(`#/chat/${lisbon}`))
  })

  it('переход на битый адрес при работе возвращает прежний чат', async () => {
    const { api, lisbon } = await seededApi()
    render(<App api={api} delays={SLOW} />)
    await waitFor(() => expect(window.location.hash).toBe(`#/chat/${lisbon}`))

    window.location.hash = '#/chat/id-которого-нет'
    expect(await screen.findByTestId('error-bar')).toHaveTextContent('Разговор не найден')
    await waitFor(() => expect(window.location.hash).toBe(`#/chat/${lisbon}`))
    expect(await screen.findByText('Погода в июле?')).toBeInTheDocument()
  })
})

describe('App — отдельная страница Web Reader', () => {
  it('открывает workspace в новой вкладке и сохраняет исходный чат', () => {
    window.location.hash = '#/chat/chat-42'
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)

    openWebReaderWorkspace()

    expect(open).toHaveBeenCalledWith(
      `${window.location.origin}${window.location.pathname}#/web-reader`,
      '_blank',
      'noopener,noreferrer'
    )
    expect(window.location.hash).toBe('#/chat/chat-42')
  })

  it('показывает Web Reader на собственном маршруте', async () => {
    const { api } = await seededApi()
    window.location.hash = '#/web-reader'
    render(<App api={api} delays={SLOW} />)

    const frame = await screen.findByTitle('Web Reader')
    expect(frame).toHaveAttribute('src', '/web-recorder/')
    expect(window.location.hash).toMatch(/^#\/web-reader\/.+/)
    expect(screen.getByRole('tab', { name: 'Сайт' })).toBeInTheDocument()
    expect(document.querySelector('aside.side')).not.toBeInTheDocument()
    expect(document.querySelector('.app')).toHaveClass('app--web-reader')
    expect(document.querySelector('section.webpreview[aria-label="Web Reader"]')).toBeInTheDocument()
  })

  it('перенаправляет старый URL на Web Reader без открытия второго чата', async () => {
    const { api } = await seededApi()
    const reader = await api['conversations:create']({ title: 'Reader', assistantKind: 'web-recorder' })
    window.location.hash = `#/web-recorder/${reader.id}`
    render(<App api={api} delays={SLOW} />)

    await screen.findByTitle('Web Reader')
    await waitFor(() => expect(window.location.hash).toBe(`#/web-reader/${reader.id}`))
  })

  it('не открывает обычный чат как Web Reader и не создаёт лишний разговор', async () => {
    const { api, gifts } = await seededApi()
    const reader = await api['conversations:create']({ title: 'Reader', assistantKind: 'web-recorder' })
    const count = api._state.conversations.length
    window.location.hash = `#/web-reader/${gifts}`
    render(<App api={api} delays={SLOW} />)

    await screen.findByTitle('Web Reader')
    await waitFor(() => expect(window.location.hash).toBe(`#/web-reader/${reader.id}`))
    expect(api._state.conversations).toHaveLength(count)
    expect(screen.queryByText('Что подарить?')).not.toBeInTheDocument()
  })

  it('переключает Reader по URL при навигации назад и вперёд', async () => {
    const { api } = await seededApi()
    const first = await api['conversations:create']({ title: 'Reader 1', assistantKind: 'web-recorder' })
    const second = await api['conversations:create']({ title: 'Reader 2', assistantKind: 'web-recorder' })
    window.location.hash = `#/web-reader/${first.id}`
    render(<App api={api} delays={SLOW} />)
    await screen.findByTitle('Web Reader')

    window.location.hash = `#/web-reader/${second.id}`
    await waitFor(() => expect(screen.getByLabelText('Разговор Web Reader')).toHaveValue(second.id))
    window.location.hash = `#/web-reader/${first.id}`
    await waitFor(() => expect(screen.getByLabelText('Разговор Web Reader')).toHaveValue(first.id))
  })
})
