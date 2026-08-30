import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProfilePanel } from './ProfilePanel'
import { FULL_ACCESS, READ_ONLY, type ProfilePanelProps } from './contracts'
import { blockedUser, conversations, denied, emptyUsage, events, NOW, providers, usage, user } from './fixtures'
import { expectNoViolations } from './test/a11y'

function setup(overrides: Partial<ProfilePanelProps> = {}) {
  const props: ProfilePanelProps = {
    user,
    capabilities: FULL_ACCESS,
    providers,
    denied,
    usage,
    events,
    conversations,
    latestAgentVersion: '2.8.1',
    now: NOW,
    ...overrides
  }
  return render(<ProfilePanel {...props} />)
}

describe('ProfilePanel — шапка и быстрые факты', () => {
  it('показывает роль, активность и почту', () => {
    setup()
    const head = screen.getByTestId('profile-head')
    expect(head).toHaveTextContent('marina')
    expect(head).toHaveTextContent('developer')
    expect(head).toHaveTextContent('marina@voicechat.team')
    expect(head).toHaveTextContent('активен')
  })

  it('давняя активность не выдаётся за присутствие', () => {
    setup({ user: { ...user, lastSeenAt: NOW - 3 * 86_400_000 } })
    expect(screen.getByTestId('profile-head')).toHaveTextContent('не в сети')
  })

  it('процент лимита показывается только когда лимит задан', () => {
    setup()
    expect(screen.getByTestId('profile-quick-stats')).toHaveTextContent('74% лимита')
    setup({ user: { ...user, llmLimitUsd: null } })
    expect(screen.getAllByTestId('profile-quick-stats')[1]).toHaveTextContent('лимит не задан')
  })
})

describe('ProfilePanel — режим «смотрю на себя»', () => {
  it('без прав нет ни роли, ни блокировки, ни удаления', () => {
    setup({ capabilities: READ_ONLY, onChangeRole: undefined, onSetBlocked: undefined, onDelete: undefined })
    expect(screen.queryByLabelText('Роль пользователя')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Заблокировать' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Удалить учётку' })).toBeNull()
    expect(screen.queryByTestId('danger-zone')).toBeNull()
  })

  it('собственная блокировка видна как факт, а не как кнопка', () => {
    setup({ user: blockedUser, capabilities: READ_ONLY })
    expect(screen.getByTestId('danger-zone')).toHaveTextContent('Учётка заблокирована')
    expect(within(screen.getByTestId('danger-zone')).queryByRole('button')).toBeNull()
  })

  it('матрица доступа только для чтения: чекбоксы и тумблеры выключены', async () => {
    setup({ capabilities: READ_ONLY, tab: 'access' })
    for (const box of screen.getAllByRole('checkbox')) expect(box).toBeDisabled()
    expect(screen.getByRole('switch', { name: 'Доступ к Anthropic Claude' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Разрешить всё' })).toBeNull()
  })
})

describe('ProfilePanel — вкладки', () => {
  it('переключение вкладки уходит наружу: вкладка живёт в адресе страницы', async () => {
    const onChangeTab = vi.fn()
    setup({ onChangeTab })
    await userEvent.click(screen.getByRole('tab', { name: /Машины/ }))
    expect(onChangeTab).toHaveBeenCalledWith('machines')
  })

  it('счётчик машин стоит во вкладке', () => {
    setup()
    expect(within(screen.getByRole('tab', { name: /Машины/ })).getByText('3')).toBeInTheDocument()
  })

  it('«Вся история →» из обзора ведёт на журнал', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'Вся история →' }))
    expect(screen.getByTestId('history-tab')).toBeInTheDocument()
  })
})

describe('ProfilePanel — доступ к моделям', () => {
  it('черновик копится до «Сохранить», полоса изменений показывает итог', async () => {
    const onSaveAccess = vi.fn()
    setup({ tab: 'access', onSaveAccess })
    expect(screen.getByTestId('sticky-action-bar')).toHaveAttribute('aria-hidden', 'true')
    const haiku = screen.getByRole('checkbox', { name: /Claude Haiku/ })
    await userEvent.click(haiku)
    const bar = screen.getByTestId('sticky-action-bar')
    expect(bar).toHaveAttribute('aria-hidden', 'false')
    expect(onSaveAccess).not.toHaveBeenCalled()
    await userEvent.click(within(bar).getByRole('button', { name: 'Сохранить' }))
    expect(onSaveAccess).toHaveBeenCalledWith([{ provider: 'codex', modelId: 'o3' }])
  })

  it('«Отменить» возвращает сохранённые права и прячет полосу', async () => {
    const onSaveAccess = vi.fn()
    setup({ tab: 'access', onSaveAccess })
    await userEvent.click(screen.getByRole('switch', { name: 'Доступ к OpenAI Codex' }))
    await userEvent.click(within(screen.getByTestId('sticky-action-bar')).getByRole('button', { name: 'Отменить' }))
    expect(screen.getByTestId('sticky-action-bar')).toHaveAttribute('aria-hidden', 'true')
    expect(onSaveAccess).not.toHaveBeenCalled()
    expect(screen.getByRole('switch', { name: 'Доступ к OpenAI Codex' })).toHaveAttribute('aria-checked', 'true')
  })

  it('поиск модели сужает список, не трогая права', async () => {
    setup({ tab: 'access' })
    await userEvent.type(screen.getByTestId('model-search'), 'haiku')
    expect(screen.getByRole('checkbox', { name: /Claude Haiku/ })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /Claude Opus/ })).toBeNull()
  })
})

describe('ProfilePanel — блокировка', () => {
  it('спрашивает подтверждение и передаёт причину', async () => {
    const onSetBlocked = vi.fn()
    setup({ onSetBlocked })
    await userEvent.click(within(screen.getByTestId('danger-zone')).getByRole('button', { name: 'Заблокировать' }))
    const dialog = screen.getByTestId('block-dialog')
    await userEvent.type(within(dialog).getByLabelText('Причина'), 'запрос службы безопасности')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Заблокировать' }))
    expect(onSetBlocked).toHaveBeenCalledWith(true, 'запрос службы безопасности')
  })

  it('отмена ничего не меняет', async () => {
    const onSetBlocked = vi.fn()
    setup({ onSetBlocked })
    await userEvent.click(within(screen.getByTestId('danger-zone')).getByRole('button', { name: 'Заблокировать' }))
    await userEvent.click(within(screen.getByTestId('block-dialog')).getByRole('button', { name: 'Отмена' }))
    expect(onSetBlocked).not.toHaveBeenCalled()
  })
})

describe('ProfilePanel — машины', () => {
  it('устаревшая версия показывает переход и кнопку обновления', async () => {
    const onUpdateMachine = vi.fn()
    setup({ tab: 'machines', onUpdateMachine })
    const list = screen.getByTestId('machines-tab')
    expect(list).toHaveTextContent('2.7.4 → 2.8.1')
    expect(list).toHaveTextContent('macOS 15.6')
    await userEvent.click(within(list).getByRole('button', { name: 'Обновить' }))
    expect(onUpdateMachine).toHaveBeenCalledWith('m1')
  })

  it('у офлайн-машины ОС не выдумывается', () => {
    setup({ tab: 'machines' })
    expect(screen.getByTestId('machines-tab')).toHaveTextContent('ОС неизвестна (офлайн)')
  })

  it('без права обновления кнопки нет', () => {
    setup({ tab: 'machines', capabilities: READ_ONLY })
    expect(within(screen.getByTestId('machines-tab')).queryByRole('button', { name: 'Обновить' })).toBeNull()
  })
})

describe('ProfilePanel — использование', () => {
  it('показывает расход, токены и прерванные ходы вместо доли «успешных»', () => {
    setup({ tab: 'usage' })
    const tab = screen.getByTestId('usage-tab')
    expect(tab).toHaveTextContent('$184.20')
    expect(tab).toHaveTextContent('8.4M')
    expect(tab).toHaveTextContent('17 прервано')
    expect(tab).not.toHaveTextContent('%')
  })

  it('пустой период — честное пустое состояние, а не нули', () => {
    setup({ tab: 'usage', usage: emptyUsage })
    expect(screen.getByTestId('usage-tab')).toHaveTextContent('—')
    expect(screen.getByTestId('usage-tab')).toHaveTextContent('Расхода за период нет')
  })

  it('смена периода уходит наружу: данные грузит хост', async () => {
    const onSelectPeriod = vi.fn()
    setup({ tab: 'usage', onSelectPeriod })
    await userEvent.selectOptions(screen.getByLabelText('Период расхода'), '7d')
    expect(onSelectPeriod).toHaveBeenCalledWith('7d')
  })
})

describe('ProfilePanel — журнал', () => {
  it('фильтр по группе оставляет только свои события', async () => {
    setup({ tab: 'history' })
    await userEvent.selectOptions(screen.getByLabelText('Тип событий'), 'machines')
    const list = screen.getByTestId('history-tab')
    expect(list).toHaveTextContent('Агент подключился')
    expect(list).not.toHaveTextContent('Пароль изменён')
  })

  it('экспорт отдаёт CSV хосту вместе с именем файла', async () => {
    const onExportCsv = vi.fn()
    setup({ tab: 'history', onExportCsv })
    await userEvent.click(screen.getByRole('button', { name: 'Экспорт CSV' }))
    const [filename, csv] = onExportCsv.mock.calls[0]
    expect(filename).toBe('security-marina.csv')
    expect(csv.split('\n')).toHaveLength(events.length + 1)
  })

  it('пока журнал грузится, пустоты не показываем', () => {
    setup({ tab: 'history', events: null })
    expect(screen.queryByTestId('history-tab')).toBeNull()
    expect(screen.getByText('Загружаем журнал…')).toBeInTheDocument()
  })
})

describe('ProfilePanel — доступность', () => {
  it('без нарушений axe в админском и собственном режиме', async () => {
    const { unmount } = setup()
    await expectNoViolations()
    unmount()
    setup({ capabilities: READ_ONLY, tab: 'access' })
    await expectNoViolations()
  })
})
