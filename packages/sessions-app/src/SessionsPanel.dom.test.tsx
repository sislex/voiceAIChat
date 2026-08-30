import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DeviceSession } from '@voicechat/sessions-core'
import { SessionsBulkActions, SessionsPanel } from './SessionsPanel'
import { createSessionsStore } from './store/sessionsStore'
import type { SessionsClient } from './contracts'
import { FIXTURE_NOW, makeSession, makeSessions } from './fixtures'
import { expectNoViolations } from './test/a11y'

function setup(sessions: DeviceSession[], over: Partial<SessionsClient> = {}) {
  const state = [...sessions]
  const client: SessionsClient = {
    list: async () => [...state],
    revoke: async (sid) => { state.splice(state.findIndex((s) => s.sid === sid), 1) },
    revokeOthers: async () => { state.splice(0, state.length, ...state.filter((s) => s.current)) },
    rename: async (sid, label) => { const s = state.find((x) => x.sid === sid); if (s) s.label = label },
    setTrusted: async (sid, trusted) => { const s = state.find((x) => x.sid === sid); if (s) s.trustedAt = trusted ? FIXTURE_NOW : null },
    ...over
  }
  return createSessionsStore({ client, host: { now: () => FIXTURE_NOW } })
}

describe('SessionsPanel', () => {
  it('показывает устройства: подпись, место, бейджи; у текущей нет кнопки завершения', async () => {
    const store = setup(makeSessions())
    render(<SessionsPanel store={store} now={FIXTURE_NOW} />)
    await screen.findByTestId('sessions-panel')
    const current = screen.getByTestId('session-current')
    expect(within(current).getByText('Chrome 128 · macOS')).toBeInTheDocument()
    expect(within(current).getByText('это устройство')).toBeInTheDocument()
    expect(within(current).getByText(/Москва, RU/)).toBeInTheDocument()
    expect(within(current).queryByRole('button', { name: 'Завершить' })).toBeNull()
    // Пользовательская метка вытесняет разбор UA, доверие видно бейджем.
    const work = screen.getByTestId('session-work')
    expect(within(work).getByText('Рабочий ноут')).toBeInTheDocument()
    expect(within(work).getByText('доверенное')).toBeInTheDocument()
    // Унаследованный вход без UA не притворяется известным устройством.
    expect(within(screen.getByTestId('session-legacy')).getByText('Устройство без метки')).toBeInTheDocument()
    // Телефон опознан как телефон, а не как настольный Safari.
    expect(within(screen.getByTestId('session-phone')).getByText('Safari 17 · iOS')).toBeInTheDocument()
  })

  it('завершает чужую сессию после подтверждения и не трогает её при отказе', async () => {
    const store = setup(makeSessions())
    const confirm = vi.fn(async () => false)
    render(<SessionsPanel store={store} now={FIXTURE_NOW} confirm={confirm} />)
    await screen.findByTestId('session-phone')
    await userEvent.click(within(screen.getByTestId('session-phone')).getByRole('button', { name: 'Завершить' }))
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringContaining('Safari 17 · iOS'), variant: 'danger' }))
    expect(screen.getByTestId('session-phone')).toBeInTheDocument()

    confirm.mockResolvedValue(true)
    await userEvent.click(within(screen.getByTestId('session-phone')).getByRole('button', { name: 'Завершить' }))
    await waitFor(() => expect(screen.queryByTestId('session-phone')).toBeNull())
  })

  it('переименование: сохраняет введённое имя и возвращает автоматическое при пустом', async () => {
    const store = setup([makeSession({ sid: 'a' }), makeSession({ sid: 'current', current: true })])
    render(<SessionsPanel store={store} now={FIXTURE_NOW} />)
    const card = await screen.findByTestId('session-a')
    await userEvent.click(within(card).getByRole('button', { name: 'Переименовать' }))
    await userEvent.type(screen.getByLabelText('Название устройства'), 'Домашний ПК')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(within(screen.getByTestId('session-a')).getByText('Домашний ПК')).toBeInTheDocument())

    await userEvent.click(within(screen.getByTestId('session-a')).getByRole('button', { name: 'Переименовать' }))
    await userEvent.clear(screen.getByLabelText('Название устройства'))
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(within(screen.getByTestId('session-a')).getByText('Chrome 128 · macOS')).toBeInTheDocument())
  })

  it('доверие переключается с карточки', async () => {
    const store = setup([makeSession({ sid: 'a' })])
    render(<SessionsPanel store={store} now={FIXTURE_NOW} />)
    const card = await screen.findByTestId('session-a')
    await userEvent.click(within(card).getByRole('button', { name: 'Сделать доверенным' }))
    await waitFor(() => expect(within(screen.getByTestId('session-a')).getByText('доверенное')).toBeInTheDocument())
    await userEvent.click(within(screen.getByTestId('session-a')).getByRole('button', { name: 'Снять доверие' }))
    await waitFor(() => expect(within(screen.getByTestId('session-a')).queryByText('доверенное')).toBeNull())
  })

  it('поиск появляется на длинном списке и фильтрует по браузеру, месту и адресу', async () => {
    const store = setup(makeSessions())
    render(<SessionsPanel store={store} now={FIXTURE_NOW} />)
    await screen.findByTestId('sessions-panel')
    const search = screen.getByLabelText('Поиск по устройствам')
    await userEvent.type(search, 'казань')
    await waitFor(() => expect(screen.queryByTestId('session-current')).toBeNull())
    expect(screen.getByTestId('session-phone')).toBeInTheDocument()
    await userEvent.clear(search)
    await userEvent.type(search, 'нет такого')
    await waitFor(() => expect(screen.getByText('Ничего не найдено')).toBeInTheDocument())
  })

  it('короткий список обходится без поиска', async () => {
    const store = setup([makeSession({ sid: 'a', current: true })])
    render(<SessionsPanel store={store} now={FIXTURE_NOW} />)
    await screen.findByTestId('session-a')
    expect(screen.queryByLabelText('Поиск по устройствам')).toBeNull()
  })

  it('режим только для чтения (админка) оставляет лишь завершение', async () => {
    const store = setup(makeSessions())
    render(<SessionsPanel store={store} now={FIXTURE_NOW} readOnly />)
    const card = await screen.findByTestId('session-phone')
    expect(within(card).queryByRole('button', { name: 'Переименовать' })).toBeNull()
    expect(within(card).queryByRole('button', { name: 'Сделать доверенным' })).toBeNull()
    expect(within(card).getByRole('button', { name: 'Завершить' })).toBeInTheDocument()
  })

  it('пустой список объясняет, что будет дальше', async () => {
    const store = setup([])
    render(<SessionsPanel store={store} now={FIXTURE_NOW} />)
    expect(await screen.findByText('Активных сессий нет')).toBeInTheDocument()
  })

  it('ошибка чтения показывает причину и даёт повторить', async () => {
    let fail = true
    const store = createSessionsStore({
      client: {
        list: async () => { if (fail) throw new Error('502 Bad Gateway'); return [makeSession({ sid: 'a', current: true })] },
        revoke: async () => undefined
      }
    })
    render(<SessionsPanel store={store} now={FIXTURE_NOW} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось получить список сессий')
    fail = false
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    await waitFor(() => expect(screen.getByTestId('session-a')).toBeInTheDocument())
  })
})

describe('SessionsBulkActions', () => {
  it('считает чужие сессии и завершает их', async () => {
    const store = setup(makeSessions())
    render(<><SessionsPanel store={store} now={FIXTURE_NOW} /><SessionsBulkActions store={store} /></>)
    const bulk = await screen.findByRole('button', { name: 'Выйти на других устройствах (3)' })
    await userEvent.click(bulk)
    await waitFor(() => expect(screen.queryByRole('button', { name: /Выйти на других/ })).toBeNull())
    expect(screen.getByTestId('session-current')).toBeInTheDocument()
  })

  it('без чужих сессий и без поддержки массовых действий ничего не рисует', async () => {
    const store = createSessionsStore({ client: { list: async () => [makeSession({ sid: 'a', current: true })], revoke: async () => undefined } })
    await store.actions.load()
    const { container } = render(<SessionsBulkActions store={store} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('«выйти везде» спрашивает подтверждение и уводит хост на экран входа', async () => {
    const onSignedOut = vi.fn()
    const store = createSessionsStore({
      client: { list: async () => makeSessions(), revoke: async () => undefined, revokeAll: async () => undefined },
      host: { onSignedOut }
    })
    await store.actions.load()
    render(<SessionsBulkActions store={store} confirm={async () => true} />)
    await userEvent.click(screen.getByRole('button', { name: 'Выйти везде, включая это устройство' }))
    await waitFor(() => expect(onSignedOut).toHaveBeenCalled())
  })
})

describe('доступность', () => {
  it('панель со всеми состояниями карточек не даёт нарушений axe', async () => {
    const store = setup(makeSessions())
    render(<><SessionsPanel store={store} now={FIXTURE_NOW} /><SessionsBulkActions store={store} /></>)
    await screen.findByTestId('sessions-panel')
    await expectNoViolations()
  })

  it('поле переименования подписано меткой', async () => {
    const store = setup([makeSession({ sid: 'a' })])
    render(<SessionsPanel store={store} now={FIXTURE_NOW} />)
    await userEvent.click(within(await screen.findByTestId('session-a')).getByRole('button', { name: 'Переименовать' }))
    expect(screen.getByLabelText('Название устройства')).toHaveFocus()
    await expectNoViolations()
  })
})

describe('SessionsPanel: платформы, соседи, активность и завершённые', () => {
  it('фильтр по платформе появляется только при разных платформах и сужает список', async () => {
    const store = setup([
      makeSession({ sid: 'web', platform: 'web', current: true }),
      makeSession({ sid: 'app', platform: 'desktop' })
    ])
    render(<SessionsPanel store={store} now={FIXTURE_NOW} />)
    await screen.findByTestId('session-web')
    await userEvent.click(screen.getByRole('button', { name: 'Приложение' }))
    await waitFor(() => expect(screen.queryByTestId('session-web')).toBeNull())
    expect(screen.getByTestId('session-app')).toBeInTheDocument()
    // Повторный клик по той же платформе снимает фильтр.
    await userEvent.click(screen.getByRole('button', { name: 'Приложение' }))
    await waitFor(() => expect(screen.getByTestId('session-web')).toBeInTheDocument())
  })

  it('одинаковая платформа фильтра не рисует', async () => {
    const store = setup([makeSession({ sid: 'a', platform: 'web', current: true }), makeSession({ sid: 'b', platform: 'web' })])
    render(<SessionsPanel store={store} now={FIXTURE_NOW} />)
    await screen.findByTestId('session-a')
    expect(screen.queryByRole('button', { name: 'Браузер' })).toBeNull()
  })

  it('карточка показывает активность и число сессий того же устройства', async () => {
    const store = setup([
      makeSession({ sid: 'a', deviceKey: 'same', requests: 42, lastPath: '/api/projects', current: true }),
      makeSession({ sid: 'b', deviceKey: 'same' })
    ])
    render(<SessionsPanel store={store} now={FIXTURE_NOW} />)
    const card = await screen.findByTestId('session-a')
    expect(within(card).getByText('42 обращения · /api/projects')).toBeInTheDocument()
    expect(within(card).getByText('ещё 1 сессия этого устройства')).toBeInTheDocument()
  })

  it('число обращений склоняется', async () => {
    const store = setup([
      makeSession({ sid: 'one', requests: 1, current: true }),
      makeSession({ sid: 'five', requests: 5 })
    ])
    render(<SessionsPanel store={store} now={FIXTURE_NOW} />)
    expect(within(await screen.findByTestId('session-one')).getByText('1 обращение')).toBeInTheDocument()
    expect(within(screen.getByTestId('session-five')).getByText('5 обращений')).toBeInTheDocument()
  })

  it('завершённые сессии грузятся при раскрытии и не показываются в админском режиме', async () => {
    const listEnded = vi.fn(async () => [makeSession({ sid: 'gone', ended: true, endedAt: FIXTURE_NOW - 60_000 })])
    const store = setup([makeSession({ sid: 'a', current: true })], { listEnded })
    const { unmount } = render(<SessionsPanel store={store} now={FIXTURE_NOW} />)
    const details = await screen.findByTestId('sessions-ended')
    expect(listEnded).not.toHaveBeenCalled()
    await userEvent.click(within(details).getByText('Недавно завершённые'))
    await waitFor(() => expect(screen.getByTestId('ended-gone')).toBeInTheDocument())
    unmount()

    const adminStore = setup([makeSession({ sid: 'a', current: true })], { listEnded })
    render(<SessionsPanel store={adminStore} now={FIXTURE_NOW} readOnly />)
    await screen.findByTestId('session-a')
    expect(screen.queryByTestId('sessions-ended')).toBeNull()
  })

  it('«это не я» спрашивает подтверждение и уводит на экран входа', async () => {
    const panic = vi.fn(async () => undefined)
    const onSignedOut = vi.fn()
    const store = createSessionsStore({
      client: { list: async () => makeSessions(), revoke: async () => undefined, panic },
      host: { now: () => FIXTURE_NOW, onSignedOut }
    })
    await store.actions.load()
    render(<SessionsBulkActions store={store} confirm={async () => true} />)
    await userEvent.click(screen.getByRole('button', { name: 'Это не я — закрыть все входы' }))
    await waitFor(() => expect(panic).toHaveBeenCalled())
    expect(onSignedOut).toHaveBeenCalled()
  })
})

