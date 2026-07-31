import { describe, it, expect, vi } from 'vitest'
import { buildAppCommands, buildHotkeyBindings, type AppCommandDeps } from './appCommands'
import { searchCommands, type Command } from './commands'

function deps(patch: Partial<AppCommandDeps> = {}): AppCommandDeps {
  return {
    voiceEnabled: true,
    voice: 'idle',
    autoSpeak: false,
    theme: 'light',
    web: true,
    paletteOpen: false,
    boardProjectId: 'p1',
    chats: [{ id: 'c1', title: 'Миграция базы' }],
    projects: [{ id: 'p1', name: 'Голос Чат' }],
    tasks: [{ id: 't1', title: 'Починить логин', seq: 42 }],
    taskProject: { id: 'p1', name: 'Голос Чат' },
    machines: [{ id: 'm1', name: 'ноутбук' }],
    newChat: vi.fn(),
    toggleMic: vi.fn(),
    stopOrCancel: vi.fn(),
    toggleAutoSpeak: vi.fn(),
    toggleTheme: vi.fn(),
    openSettings: vi.fn(),
    openBoard: vi.fn(),
    openMachineConsole: vi.fn(),
    openKnowledgeBase: vi.fn(),
    logout: vi.fn(),
    openPalette: vi.fn(),
    openCheatSheet: vi.fn(),
    openChat: vi.fn(),
    openProject: vi.fn(),
    openTask: vi.fn(),
    ...patch
  }
}

function byId(commands: Command[], id: string): Command {
  const found = commands.find((command) => command.id === id)
  expect(found, `нет команды ${id}`).toBeDefined()
  return found!
}

describe('buildAppCommands', () => {
  it('базовый набор на месте', () => {
    const ids = buildAppCommands(deps()).map((c) => c.id)
    for (const id of [
      'app.new-chat',
      'app.mic',
      'app.tts',
      'app.theme',
      'app.settings',
      'app.board',
      'app.machine-console',
      'app.kb',
      'app.logout',
      'app.palette',
      'app.hotkeys'
    ]) {
      expect(ids).toContain(id)
    }
  })

  it('каждая команда набора выполняется своим колбэком', () => {
    const d = deps()
    const commands = buildAppCommands(d)
    byId(commands, 'app.new-chat').run()
    byId(commands, 'app.tts').run()
    byId(commands, 'app.theme').run()
    byId(commands, 'app.settings').run()
    byId(commands, 'app.board').run()
    byId(commands, 'app.machine-console').run()
    byId(commands, 'app.kb').run()
    byId(commands, 'app.logout').run()
    expect(d.newChat).toHaveBeenCalled()
    expect(d.toggleAutoSpeak).toHaveBeenCalled()
    expect(d.toggleTheme).toHaveBeenCalled()
    expect(d.openSettings).toHaveBeenCalled()
    expect(d.openBoard).toHaveBeenCalledWith('p1')
    expect(d.openMachineConsole).toHaveBeenCalledWith(null)
    expect(d.openKnowledgeBase).toHaveBeenCalled()
    expect(d.logout).toHaveBeenCalled()
  })

  it('подписи переключателей зависят от состояния', () => {
    expect(byId(buildAppCommands(deps({ autoSpeak: false })), 'app.tts').title).toBe('Включить озвучку ответов')
    expect(byId(buildAppCommands(deps({ autoSpeak: true })), 'app.tts').title).toBe('Выключить озвучку ответов')
    expect(byId(buildAppCommands(deps({ theme: 'light' })), 'app.theme').title).toBe('Тёмная тема')
    expect(byId(buildAppCommands(deps({ theme: 'dark' })), 'app.theme').title).toBe('Светлая тема')
  })

  it('в desktop нет машин и выхода: мостов под них нет', () => {
    const commands = buildAppCommands(deps({ web: false }))
    expect(byId(commands, 'app.logout').enabled?.()).toBe(false)
    expect(byId(commands, 'app.machine-console').enabled?.()).toBe(false)
  })

  it('микрофонные команды выключены при выключенном голосовом вводе', () => {
    expect(byId(buildAppCommands(deps({ voiceEnabled: false })), 'app.mic').enabled?.()).toBe(false)
    expect(byId(buildAppCommands(deps({ voiceEnabled: true })), 'app.mic').enabled?.()).toBe(true)
  })

  it('«Отменить» доступна только когда есть что отменять', () => {
    expect(byId(buildAppCommands(deps({ voice: 'idle' })), 'app.stop').enabled?.()).toBe(false)
    expect(byId(buildAppCommands(deps({ voice: 'thinking' })), 'app.stop').enabled?.()).toBe(true)
    expect(byId(buildAppCommands(deps({ voice: 'listening' })), 'app.stop').enabled?.()).toBe(true)
  })

  it('открытая палитра не предлагает себя же', () => {
    expect(byId(buildAppCommands(deps({ paletteOpen: true })), 'app.palette').enabled?.()).toBe(false)
  })

  it('«Доска проекта» выключена, когда проектов нет', () => {
    expect(byId(buildAppCommands(deps({ boardProjectId: null })), 'app.board').enabled?.()).toBe(false)
  })

  it('шпаргалке достаются комбинации пробела, Esc, ⌘K и «?»', () => {
    const commands = buildAppCommands(deps())
    const keys = new Map(commands.filter((c) => c.hotkey).map((c) => [c.id, c.hotkey]))
    expect(keys.get('app.mic')).toBe('Space')
    expect(keys.get('app.stop')).toBe('Escape')
    expect(keys.get('app.palette')).toBe('mod+k')
    expect(keys.get('app.hotkeys')).toBe('?')
  })

  it('беседы, проекты, задачи и машины попадают в свои разделы', () => {
    const commands = buildAppCommands(deps())
    expect(byId(commands, 'chat:c1').section).toBe('chat')
    expect(byId(commands, 'project:p1').section).toBe('project')
    expect(byId(commands, 'task:t1').section).toBe('task')
    expect(byId(commands, 'machine:m1').section).toBe('machine')
  })

  it('название задачи несёт ключ проекта, а номер ищется через «#»', () => {
    const commands = buildAppCommands(deps())
    const task = byId(commands, 'task:t1')
    expect(task.title).toBe('GC-42 · Починить логин')
    expect(task.keywords).toContain('#42')
    const found = searchCommands(commands, '#42').flatMap((g) => g.hits)
    expect(found.map((h) => h.command.id)).toEqual(['task:t1'])
  })

  it('задачи без открытой доски не показываются: ключ считать не от чего', () => {
    const commands = buildAppCommands(deps({ taskProject: null }))
    expect(commands.some((c) => c.section === 'task')).toBe(false)
  })

  it('беседа без названия не становится пустой строкой', () => {
    const commands = buildAppCommands(deps({ chats: [{ id: 'c9', title: '   ' }] }))
    expect(byId(commands, 'chat:c9').title).toBe('Новый разговор')
  })

  it('пункт беседы открывает именно её', () => {
    const d = deps()
    byId(buildAppCommands(d), 'chat:c1').run()
    expect(d.openChat).toHaveBeenCalledWith('c1')
  })

  it('пункт задачи открывает карточку в её проекте', () => {
    const d = deps()
    byId(buildAppCommands(d), 'task:t1').run()
    expect(d.openTask).toHaveBeenCalledWith('p1', 't1')
  })

  it('пункт машины открывает консоль именно этой машины', () => {
    const d = deps()
    byId(buildAppCommands(d), 'machine:m1').run()
    expect(d.openMachineConsole).toHaveBeenCalledWith('m1')
  })
})

describe('buildHotkeyBindings', () => {
  function bindings(patch: Partial<Parameters<typeof buildHotkeyBindings>[0]> = {}) {
    return buildHotkeyBindings({
      onboarded: true,
      voice: 'idle',
      togglePalette: vi.fn(),
      openCheatSheet: vi.fn(),
      ...patch
    })
  }

  it('⌘K ловится и в поле ввода — у комбинации есть модификатор', () => {
    const palette = bindings().find((b) => b.combo === 'mod+k')
    expect(palette?.inInput).toBe(true)
  })

  it('«?» в поле ввода не перехватывается: там он печатается', () => {
    const sheet = bindings().find((b) => b.combo === '?')
    expect(sheet?.inInput).toBeUndefined()
  })

  it('во время записи голоса ⌘K и «?» игнорируются', () => {
    for (const binding of bindings({ voice: 'listening' })) {
      expect(binding.enabled?.(), binding.combo).toBe(false)
    }
    for (const binding of bindings({ voice: 'idle' })) {
      expect(binding.enabled?.(), binding.combo).toBe(true)
    }
  })

  it('во время хода модели и озвучки палитра открывается', () => {
    for (const voice of ['thinking', 'speaking'] as const) {
      const palette = bindings({ voice }).find((b) => b.combo === 'mod+k')
      expect(palette?.enabled?.(), voice).toBe(true)
    }
  })

  it('до онбординга горячих клавиш нет', () => {
    for (const binding of bindings({ onboarded: false })) expect(binding.enabled?.()).toBe(false)
  })

  it('⌘K переключает палитру, «?» открывает шпаргалку', () => {
    const togglePalette = vi.fn()
    const openCheatSheet = vi.fn()
    const map = bindings({ togglePalette, openCheatSheet })
    map.find((b) => b.combo === 'mod+k')?.onDown?.(new KeyboardEvent('keydown'))
    map.find((b) => b.combo === '?')?.onDown?.(new KeyboardEvent('keydown'))
    expect(togglePalette).toHaveBeenCalledTimes(1)
    expect(openCheatSheet).toHaveBeenCalledTimes(1)
  })
})
