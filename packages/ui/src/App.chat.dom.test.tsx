import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
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

  it('новый разговор получает свой адрес', async () => {
    const { api, lisbon } = await seededApi()
    render(<App api={api} delays={SLOW} />)
    await screen.findByText('Погода в июле?')

    await userEvent.click(screen.getByRole('button', { name: '+ Новый' }))
    await waitFor(() => {
      expect(window.location.hash).toMatch(/^#\/chat\/.+/)
      expect(window.location.hash).not.toBe(`#/chat/${lisbon}`)
    })
    const created = api._state.conversations.find((c) => c.title === 'Новый разговор')
    expect(window.location.hash).toBe(`#/chat/${created?.id}`)
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

describe('App — веб-превью', () => {
  it('загружает сохранённый URL разговора, сохраняет override и валидирует адрес', async () => {
    const { api, lisbon } = await seededApi()
    const project = await api['projects:create']({ name: 'Web' })
    await api['projects:update']({ id: project.id, previewUrl: 'https://project.example/' })
    await api['conversations:setProject']({ id: lisbon, projectId: project.id })
    await api['conversations:setPreviewUrl']({ id: lisbon, previewUrl: 'https://project.example/' })
    render(<App api={api} delays={SLOW} />)

    const address = await screen.findByLabelText('Адрес превью')
    await userEvent.type(address, 'https://chat.example/app')
    await userEvent.click(screen.getByRole('button', { name: 'Открыть' }))
    const frame = await screen.findByTitle('Предпросмотр сайта')
    expect(frame).toHaveAttribute('src', '/api/preview?url=https%3A%2F%2Fchat.example%2Fapp')

    await userEvent.clear(address)
    await userEvent.type(address, 'file:///tmp/app')
    await userEvent.click(screen.getByRole('button', { name: 'Открыть' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('http:// или https://')
    expect(screen.getByRole('tab', { name: 'Чат' })).toHaveAttribute('aria-selected', 'true')
    await userEvent.click(screen.getByRole('tab', { name: 'Превью' }))
    expect(screen.getByRole('tab', { name: 'Превью' })).toHaveAttribute('aria-selected', 'true')
  })
})
