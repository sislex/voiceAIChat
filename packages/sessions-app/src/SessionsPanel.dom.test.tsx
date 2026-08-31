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

describe('SessionsPanel: цикл 3 — флаг, 2FA, история, устройство целиком, длинный список', () => {
  it('флаг страны и бейдж подтверждённого входа видны в карточке', async () => {
    const store = setup([
      makeSession({ sid: 'a', current: true, twoFactor: true, geo: { country: 'RU', city: 'Москва', label: 'Москва, RU' } })
    ])
    render(<SessionsPanel store={store} now={FIXTURE_NOW} />)
    const card = await screen.findByTestId('session-a')
    expect(within(card).getByText(/🇷🇺 Москва, RU/)).toBeInTheDocument()
    expect(within(card).getByText('подтверждено кодом')).toBeInTheDocument()
  })

  it('история устройства грузится при раскрытии и показывает человеческие подписи', async () => {
    const history = vi.fn(async () => [{ id: 7, at: FIXTURE_NOW - 60_000, type: 'session_trusted', details: 'Рабочий ноут' }])
    const store = setup([makeSession({ sid: 'a', current: true })], { history })
    render(<SessionsPanel store={store} now={FIXTURE_NOW} />)
    const card = await screen.findByTestId('session-a')
    expect(history).not.toHaveBeenCalled()
    await userEvent.click(within(card).getByText('Что делало это устройство'))
    await waitFor(() => expect(within(card).getByText(/устройство доверено: Рабочий ноут/)).toBeInTheDocument())
  })

  it('в истории не дублируется подпись события, если деталь совпадает с ней', async () => {
    // Сервер кладёт в details ту же фразу — печатать её дважды незачем.
    const history = vi.fn(async () => [{ id: 1, at: FIXTURE_NOW, type: 'login_new_device', details: 'вход с нового устройства' }])
    const store = setup([makeSession({ sid: 'a', current: true })], { history })
    render(<SessionsPanel store={store} now={FIXTURE_NOW} />)
    const card = await screen.findByTestId('session-a')
    await userEvent.click(within(card).getByText('Что делало это устройство'))
    await waitFor(() => expect(within(card).getByText(/вход с нового устройства/)).toBeInTheDocument())
    expect(within(card).queryByText(/вход с нового устройства: вход с нового устройства/)).toBeNull()
  })

  it('кнопка «завершить все сессии устройства» появляется только при соседях', async () => {
    const store = setup([
      makeSession({ sid: 'current', deviceKey: 'same', current: true }),
      makeSession({ sid: 'a', deviceKey: 'same' }),
      makeSession({ sid: 'lonely', deviceKey: 'other' })
    ])
    render(<SessionsPanel store={store} now={FIXTURE_NOW} confirm={async () => true} />)
    await screen.findByTestId('session-current')
    expect(within(screen.getByTestId('session-lonely')).queryByRole('button', { name: /Завершить устройство|Завершить другие входы/ })).toBeNull()
    await userEvent.click(within(screen.getByTestId('session-current')).getByRole('button', { name: 'Завершить другие входы (1)' }))
    await waitFor(() => expect(screen.queryByTestId('session-a')).toBeNull())
    // Текущая остаётся: выбивать себя этой кнопкой пользователь не просил.
    expect(screen.getByTestId('session-current')).toBeInTheDocument()
  })

  it('длинный список подрезается и честно говорит, сколько скрыто', async () => {
    const many = Array.from({ length: 8 }, (_, i) => makeSession({ sid: `s${i}`, current: i === 0 }))
    const store = setup(many)
    render(<SessionsPanel store={store} now={FIXTURE_NOW} maxVisible={5} />)
    await screen.findByTestId('session-s0')
    expect(screen.getAllByTestId(/^session-s\d$/)).toHaveLength(5)
    expect(screen.getByText('Показаны первые записи, ещё 3 скрыто — уточните поиск')).toBeInTheDocument()
  })

  it('режим только для чтения не предлагает гасить устройство целиком', async () => {
    const store = setup([
      makeSession({ sid: 'a', deviceKey: 'same', current: true }),
      makeSession({ sid: 'b', deviceKey: 'same' })
    ])
    render(<SessionsPanel store={store} now={FIXTURE_NOW} readOnly />)
    await screen.findByTestId('session-a')
    expect(screen.queryByRole('button', { name: /Завершить устройство|Завершить другие входы/ })).toBeNull()
  })
})

describe('SessionsPanel: цикл 4 — порядок, обновление, выбор, доступность', () => {
  it('порядок списка меняется выбором и остаётся применённым', async () => {
    const store = setup([
      makeSession({ sid: 'current', current: true, lastSeen: FIXTURE_NOW - 86_400_000 }),
      makeSession({ sid: 'fresh', lastSeen: FIXTURE_NOW, createdAt: FIXTURE_NOW - 10 * 86_400_000 }),
      makeSession({ sid: 'old', lastSeen: FIXTURE_NOW - 5 * 86_400_000, createdAt: FIXTURE_NOW - 86_400_000 })
    ])
    render(<SessionsPanel store={store} now={FIXTURE_NOW} />)
    await screen.findByTestId('session-current')
    const order = (): string[] => screen.getAllByTestId(/^session-/).map((el) => el.getAttribute('data-testid')!)
    expect(order()).toEqual(['session-current', 'session-fresh', 'session-old'])
    await userEvent.selectOptions(screen.getByLabelText('Порядок'), 'created')
    await waitFor(() => expect(order()).toEqual(['session-current', 'session-old', 'session-fresh']))
  })

  it('кнопка «Обновить» перечитывает список и показывает время чтения', async () => {
    const list = vi.fn(async () => [makeSession({ sid: 'a', current: true })])
    const store = createSessionsStore({ client: { list, revoke: async () => undefined }, host: { now: () => FIXTURE_NOW } })
    render(<SessionsPanel store={store} now={FIXTURE_NOW} />)
    await screen.findByTestId('session-a')
    expect(list).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/обновлено/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Обновить' }))
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2))
  })

  it('выбор карточек завершает их пачкой; у текущей чекбокса нет', async () => {
    const store = setup(makeSessions())
    render(<SessionsPanel store={store} now={FIXTURE_NOW} confirm={async () => true} />)
    await screen.findByTestId('session-current')
    expect(within(screen.getByTestId('session-current')).queryByRole('checkbox')).toBeNull()
    await userEvent.click(within(screen.getByTestId('session-phone')).getByRole('checkbox'))
    await userEvent.click(within(screen.getByTestId('session-work')).getByRole('checkbox'))
    expect(screen.getByText('Выбрано: 2')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Завершить выбранные (2)' }))
    await waitFor(() => expect(screen.queryByTestId('session-phone')).toBeNull())
    expect(screen.queryByTestId('session-work')).toBeNull()
    expect(screen.getByTestId('session-current')).toBeInTheDocument()
  })

  it('результат действия объявляется скринридеру', async () => {
    const store = setup(makeSessions())
    render(<SessionsPanel store={store} now={FIXTURE_NOW} confirm={async () => true} />)
    await screen.findByTestId('session-work')
    await userEvent.click(within(screen.getByTestId('session-work')).getByRole('button', { name: 'Завершить' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Сессия «Рабочий ноут» завершена'))
  })

  it('сессия на исходе срока помечена бейджем', async () => {
    const store = setup([
      makeSession({ sid: 'soon', current: true, expiresAt: FIXTURE_NOW + 3 * 60 * 60_000 }),
      makeSession({ sid: 'long', expiresAt: FIXTURE_NOW + 20 * 86_400_000 })
    ])
    render(<SessionsPanel store={store} now={FIXTURE_NOW} />)
    expect(within(await screen.findByTestId('session-soon')).getByText('скоро истечёт')).toBeInTheDocument()
    expect(within(screen.getByTestId('session-long')).queryByText('скоро истечёт')).toBeNull()
  })

  it('в завершённых видно, почему сессия закончилась', async () => {
    const listEnded = vi.fn(async () => [
      makeSession({ sid: 'gone', ended: true, endedAt: FIXTURE_NOW - 60_000, endReason: 'evicted' })
    ])
    const store = setup([makeSession({ sid: 'a', current: true })], { listEnded })
    render(<SessionsPanel store={store} now={FIXTURE_NOW} />)
    await userEvent.click(within(await screen.findByTestId('sessions-ended')).getByText('Недавно завершённые'))
    await waitFor(() => expect(within(screen.getByTestId('ended-gone')).getByText(/вытеснена лимитом/)).toBeInTheDocument())
  })

  it('доступность: тулбар, чекбоксы и объявления не дают нарушений axe', async () => {
    const store = setup(makeSessions())
    render(<><SessionsPanel store={store} now={FIXTURE_NOW} /><SessionsBulkActions store={store} /></>)
    await screen.findByTestId('sessions-panel')
    await userEvent.click(within(screen.getByTestId('session-phone')).getByRole('checkbox'))
    await expectNoViolations()
  })
})

describe('SessionsPanel: цикл 5 — доверие, срок доверия и завершённые порциями', () => {
  it('в карточке видно, сколько осталось доверию', async () => {
    const store = setup([makeSession({ sid: 'a', current: true, trustedAt: FIXTURE_NOW - 25 * 86_400_000 })])
    render(<SessionsPanel store={store} now={FIXTURE_NOW} />)
    const card = await screen.findByTestId('session-a')
    expect(within(card).getByText('доверие ещё 5 дней')).toBeInTheDocument()
  })

  it('«снять доверие со всех» спрашивает подтверждение и зовёт клиента', async () => {
    const untrustAll = vi.fn(async () => undefined)
    const store = setup(makeSessions(), { untrustAll })
    await store.actions.load()
    render(<SessionsBulkActions store={store} confirm={async () => true} />)
    await userEvent.click(screen.getByRole('button', { name: 'Снять доверие со всех устройств' }))
    await waitFor(() => expect(untrustAll).toHaveBeenCalled())
  })

  it('без доверенных устройств кнопка снятия доверия не предлагается', async () => {
    // Иначе интерфейс предлагает действие, которое заведомо ничего не изменит.
    const store = setup([makeSession({ sid: 'a', current: true }), makeSession({ sid: 'b' })], { untrustAll: async () => undefined })
    await store.actions.load()
    render(<SessionsBulkActions store={store} />)
    expect(screen.queryByRole('button', { name: 'Снять доверие со всех устройств' })).toBeNull()
  })

  it('завершённые ищутся и раскрываются кнопкой «показать ещё»', async () => {
    const ended = Array.from({ length: 8 }, (_, i) => makeSession({ sid: `gone-${i}`, ended: true, endedAt: FIXTURE_NOW - 60_000 }))
    const store = setup([makeSession({ sid: 'a', current: true })], { listEnded: async () => ended })
    render(<SessionsPanel store={store} now={FIXTURE_NOW} />)
    await userEvent.click(within(await screen.findByTestId('sessions-ended')).getByText('Недавно завершённые'))
    await waitFor(() => expect(screen.getAllByTestId(/^ended-/)).toHaveLength(5))
    await userEvent.click(screen.getByRole('button', { name: 'Показать ещё (3)' }))
    await waitFor(() => expect(screen.getAllByTestId(/^ended-/)).toHaveLength(8))
    await userEvent.type(screen.getByLabelText('Поиск среди завершённых'), 'нет-такого')
    await waitFor(() => expect(screen.queryByTestId('ended-gone-0')).toBeNull())
  })

  it('подсказка про имя устройства появляется, когда сессий у него несколько', async () => {
    const store = setup([
      makeSession({ sid: 'a', deviceKey: 'same', current: true }),
      makeSession({ sid: 'b', deviceKey: 'same' })
    ])
    render(<SessionsPanel store={store} now={FIXTURE_NOW} />)
    await userEvent.click(within(await screen.findByTestId('session-a')).getByRole('button', { name: 'Переименовать' }))
    expect(screen.getByText(/применится ко всем входам с этого устройства/)).toBeInTheDocument()
  })
})

