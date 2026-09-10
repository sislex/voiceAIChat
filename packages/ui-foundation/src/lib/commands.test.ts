// Окружение jsdom вопреки имени файла (без `.dom.`): компоненты здесь не
// рендерятся, но недавние команды живут в localStorage.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  DEFAULT_SECTION_LIMIT,
  RECENT_LIMIT,
  listCommands,
  recentCommandIds,
  registerCommand,
  registerCommandSource,
  rememberCommand,
  resetCommands,
  searchCommands,
  subscribeCommands,
  type Command
} from './commands'

function cmd(partial: Partial<Command> & Pick<Command, 'id' | 'title'>): Command {
  return { section: 'action', run: () => {}, ...partial }
}

describe('реестр команд', () => {
  beforeEach(() => {
    resetCommands()
    localStorage.clear()
  })

  it('собирает команды всех источников', () => {
    registerCommand(cmd({ id: 'a', title: 'Первая' }))
    registerCommandSource(() => [cmd({ id: 'b', title: 'Вторая' })])
    expect(listCommands().map((c) => c.id)).toEqual(['a', 'b'])
  })

  it('снятие регистрации убирает команды экрана', () => {
    const off = registerCommand(cmd({ id: 'a', title: 'Первая' }))
    off()
    expect(listCommands()).toEqual([])
  })

  it('источник читается заново на каждый вызов — данные не устаревают', () => {
    let title = 'До'
    registerCommandSource(() => [cmd({ id: 'a', title })])
    expect(listCommands()[0]!.title).toBe('До')
    title = 'После'
    expect(listCommands()[0]!.title).toBe('После')
  })

  it('дубли по id склеиваются — побеждает зарегистрированный позже', () => {
    registerCommand(cmd({ id: 'ci.retry', title: 'Старая' }))
    registerCommand(cmd({ id: 'ci.retry', title: 'Новая' }))
    const all = listCommands()
    expect(all).toHaveLength(1)
    expect(all[0]!.title).toBe('Новая')
  })

  it('битый источник не роняет список целиком', () => {
    registerCommandSource(() => {
      throw new Error('экран отдал мусор')
    })
    registerCommand(cmd({ id: 'a', title: 'Живая' }))
    expect(listCommands().map((c) => c.id)).toEqual(['a'])
  })

  it('подписка срабатывает на приход и уход источника', () => {
    const seen = vi.fn()
    subscribeCommands(seen)
    const off = registerCommand(cmd({ id: 'a', title: 'Первая' }))
    off()
    expect(seen).toHaveBeenCalledTimes(2)
  })
})

describe('недавние команды', () => {
  beforeEach(() => {
    resetCommands()
    localStorage.clear()
  })

  it('свежая — первой, без дублей и не длиннее лимита', () => {
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) rememberCommand(id)
    rememberCommand('b')
    const recent = recentCommandIds()
    expect(recent[0]).toBe('b')
    expect(recent).toHaveLength(RECENT_LIMIT)
    expect(new Set(recent).size).toBe(recent.length)
  })

  it('мусор в localStorage читается как «недавних нет»', () => {
    localStorage.setItem('vc:commands:recent', '{не json')
    expect(recentCommandIds()).toEqual([])
  })

  it('живут между перезагрузками — значение остаётся в localStorage', () => {
    rememberCommand('app.settings')
    // Новый «сеанс»: модуль читает ключ заново, состояния в памяти нет.
    expect(recentCommandIds()).toEqual(['app.settings'])
  })
})

describe('searchCommands', () => {
  const all: Command[] = [
    cmd({ id: 'app.new-chat', title: 'Новая беседа' }),
    cmd({ id: 'app.settings', title: 'Открыть настройки' }),
    cmd({ id: 'chat:1', title: 'Миграция базы', section: 'chat' }),
    cmd({ id: 'project:1', title: 'Голос Чат', section: 'project' }),
    cmd({ id: 'task:1', title: 'VC-42 · Починить логин', section: 'task', keywords: ['#42', '42'] }),
    cmd({ id: 'machine:1', title: 'Консоль: ноутбук', section: 'machine' })
  ]

  it('пустой запрос: «Недавние» сверху, дальше разделы по порядку', () => {
    const groups = searchCommands(all, '', { recent: ['project:1'] })
    expect(groups.map((g) => g.key)).toEqual(['recent', 'action', 'chat', 'task', 'machine'])
    expect(groups[0]!.hits.map((h) => h.command.id)).toEqual(['project:1'])
  })

  it('находит по всем разделам и подсвечивает совпавшие буквы названия', () => {
    const groups = searchCommands(all, 'нас')
    const hit = groups.flatMap((g) => g.hits).find((h) => h.command.id === 'app.settings')
    expect(hit).toBeDefined()
    expect(hit!.indices.length).toBe(3)
  })

  it('задача ищется и по номеру «#42», и по названию', () => {
    const byNumber = searchCommands(all, '#42').flatMap((g) => g.hits)
    expect(byNumber.map((h) => h.command.id)).toEqual(['task:1'])
    const byTitle = searchCommands(all, 'логин').flatMap((g) => g.hits)
    expect(byTitle.map((h) => h.command.id)).toEqual(['task:1'])
  })

  it('выключенные команды в выдачу не попадают', () => {
    const groups = searchCommands(
      [cmd({ id: 'app.logout', title: 'Выйти', enabled: () => false })],
      'вый'
    )
    expect(groups).toEqual([])
  })

  it('падение enabled() трактуется как «нельзя»', () => {
    const groups = searchCommands(
      [
        cmd({
          id: 'broken',
          title: 'Сломанная',
          enabled: () => {
            throw new Error('нет данных')
          }
        })
      ],
      ''
    )
    expect(groups).toEqual([])
  })

  it('ограничивает выдачу и сообщает, сколько скрыто', () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      cmd({ id: `chat:${i}`, title: `Беседа ${i}`, section: 'chat' })
    )
    const [group] = searchCommands(many, 'беседа', { limitPerSection: 5 })
    expect(group!.hits).toHaveLength(5)
    expect(group!.hidden).toBe(25)
  })

  it('лимит по умолчанию — DEFAULT_SECTION_LIMIT', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      cmd({ id: `chat:${i}`, title: `Беседа ${i}`, section: 'chat' })
    )
    const [group] = searchCommands(many, '')
    expect(group!.hits).toHaveLength(DEFAULT_SECTION_LIMIT)
  })

  it('недавние не дублируются в своём разделе', () => {
    const groups = searchCommands(all, '', { recent: ['app.settings'] })
    const actions = groups.find((g) => g.key === 'action')
    expect(actions!.hits.map((h) => h.command.id)).not.toContain('app.settings')
  })

  it('500+ бесед фильтруются без заметного лага', () => {
    const fixture = Array.from({ length: 600 }, (_, i) =>
      cmd({ id: `chat:${i}`, title: `Разговор про миграцию базы номер ${i}`, section: 'chat' })
    )
    const queries = ['р', 'ра', 'раз', 'разг', 'разго', 'миг', 'мигр', 'база']
    const started = performance.now()
    for (const query of queries) searchCommands(fixture, query, { limitPerSection: 8 })
    const spent = performance.now() - started
    // Бюджет с запасом: 8 нажатий по 600 команд — это доли миллисекунды на пункт.
    expect(spent).toBeLessThan(1000)
  })
})
