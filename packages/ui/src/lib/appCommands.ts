// Базовый набор команд приложения плюс пункты по данным (беседы, проекты, задачи
// открытой доски, машины). Собран отдельной чистой функцией, а не прямо в App:
// набор надо проверять тестом, а App и без этого длинный.
//
// Экранные команды здесь не живут — их регистрируют сами экраны
// (`useCommandSource` в KanbanBoard и RunFeed).

import type { VoiceState } from '@shared/types'
import { issueKey } from '@shared/projects'
import type { Command } from './commands'
import type { HotkeyBinding } from './useHotkeys'

/** Минимальные формы данных: приносить сюда типы стора незачем. */
export interface CommandChat {
  id: string
  title: string
}
export interface CommandProject {
  id: string
  name: string
}
export interface CommandTask {
  id: string
  title: string
  seq: number
}
export interface CommandMachine {
  id: string
  name: string
}

export interface AppCommandDeps {
  /** Голосовой ввод включён (иначе микрофонные команды неприменимы). */
  voiceEnabled: boolean
  voice: VoiceState
  /** Автоозвучка ответов включена — от неё зависит подпись команды. */
  autoSpeak: boolean
  theme: 'light' | 'dark'
  /** Web-режим: есть мосты машин и сессии (в desktop команд машин и выхода нет). */
  web: boolean
  /** Палитра открыта — тогда команда «Командная палитра» в ней самой не нужна. */
  paletteOpen: boolean
  /** Куда ведёт «Доска проекта»: последний открытый или первый доступный. */
  boardProjectId: string | null
  chats: readonly CommandChat[]
  projects: readonly CommandProject[]
  /** Задачи открытой доски (других в памяти нет) и её проект — для ключа «VC-42». */
  tasks: readonly CommandTask[]
  taskProject: CommandProject | null
  machines: readonly CommandMachine[]
  newChat: () => void
  toggleMic: () => void
  stopOrCancel: () => void
  toggleAutoSpeak: () => void
  toggleTheme: () => void
  openSettings: () => void
  openBoard: (projectId: string) => void
  openMachineConsole: (agentId: string | null) => void
  openKnowledgeBase: () => void
  logout: () => void
  openPalette: () => void
  openCheatSheet: () => void
  openChat: (id: string) => void
  openProject: (id: string) => void
  openTask: (projectId: string, taskId: string) => void
}

/** Пустое название беседы в списке выглядит как дырка — подставляем то же, что чат. */
const UNTITLED_CHAT = 'Новый разговор'

/** Базовые команды: то, что раньше жило только в меню и на кнопках. */
function baseCommands(deps: AppCommandDeps): Command[] {
  const recording = deps.voice === 'listening'
  const busy = deps.voice === 'thinking' || deps.voice === 'speaking'
  return [
    {
      id: 'app.new-chat',
      title: 'Новая беседа',
      section: 'action',
      keywords: ['создать чат', 'new chat'],
      run: deps.newChat
    },
    {
      id: 'app.mic',
      title: recording ? 'Остановить запись' : 'Говорить в микрофон',
      section: 'action',
      hint: 'Удерживайте пробел',
      hotkey: 'Space',
      hotkeyNote: 'удержание',
      keywords: ['микрофон', 'запись', 'push to talk'],
      enabled: () => deps.voiceEnabled,
      run: deps.toggleMic
    },
    {
      id: 'app.stop',
      title: recording ? 'Остановить запись' : 'Отменить ответ модели',
      section: 'action',
      hotkey: 'Escape',
      keywords: ['стоп', 'отмена', 'cancel'],
      enabled: () => recording || busy,
      run: deps.stopOrCancel
    },
    {
      id: 'app.tts',
      title: deps.autoSpeak ? 'Выключить озвучку ответов' : 'Включить озвучку ответов',
      section: 'action',
      keywords: ['tts', 'голос', 'speak'],
      run: deps.toggleAutoSpeak
    },
    {
      id: 'app.theme',
      title: deps.theme === 'dark' ? 'Светлая тема' : 'Тёмная тема',
      section: 'action',
      keywords: ['тема', 'theme', 'оформление'],
      run: deps.toggleTheme
    },
    {
      id: 'app.settings',
      title: 'Открыть настройки',
      section: 'action',
      keywords: ['settings', 'параметры'],
      run: deps.openSettings
    },
    {
      id: 'app.board',
      title: 'Открыть доску проекта',
      section: 'action',
      keywords: ['канбан', 'kanban', 'задачи'],
      enabled: () => deps.boardProjectId != null,
      run: () => {
        if (deps.boardProjectId) deps.openBoard(deps.boardProjectId)
      }
    },
    {
      id: 'app.machine-console',
      title: 'Открыть консоль машины',
      section: 'action',
      keywords: ['терминал', 'console', 'shell'],
      enabled: () => deps.web,
      run: () => deps.openMachineConsole(null)
    },
    {
      id: 'app.kb',
      title: 'Открыть базу знаний',
      section: 'action',
      keywords: ['kb', 'документация', 'knowledge'],
      run: deps.openKnowledgeBase
    },
    {
      id: 'app.logout',
      title: 'Выйти',
      section: 'action',
      keywords: ['logout', 'сменить пользователя'],
      enabled: () => deps.web,
      run: deps.logout
    },
    {
      id: 'app.palette',
      title: 'Командная палитра',
      section: 'action',
      hotkey: 'mod+k',
      keywords: ['команды', 'palette'],
      enabled: () => !deps.paletteOpen,
      run: deps.openPalette
    },
    {
      id: 'app.hotkeys',
      title: 'Горячие клавиши',
      section: 'action',
      hotkey: '?',
      keywords: ['шпаргалка', 'hotkeys', 'клавиатура'],
      run: deps.openCheatSheet
    }
  ]
}

/** Пункты по данным: беседы, проекты, задачи открытой доски, машины. */
function entityCommands(deps: AppCommandDeps): Command[] {
  const commands: Command[] = []
  for (const chat of deps.chats) {
    commands.push({
      id: `chat:${chat.id}`,
      title: chat.title.trim() || UNTITLED_CHAT,
      section: 'chat',
      run: () => deps.openChat(chat.id)
    })
  }
  for (const project of deps.projects) {
    commands.push({
      id: `project:${project.id}`,
      title: project.name,
      section: 'project',
      run: () => deps.openProject(project.id)
    })
  }
  const board = deps.taskProject
  if (board) {
    for (const task of deps.tasks) {
      const key = issueKey(board.name, task)
      commands.push({
        // Ключ в названии, а не только в подписи: тогда «42» и подсвечивается,
        // и находится ровно так же, как слова названия.
        id: `task:${task.id}`,
        title: `${key} · ${task.title}`,
        section: 'task',
        hint: board.name,
        keywords: [`#${task.seq}`, String(task.seq)],
        run: () => deps.openTask(board.id, task.id)
      })
    }
  }
  for (const machine of deps.machines) {
    commands.push({
      id: `machine:${machine.id}`,
      title: `Консоль: ${machine.name}`,
      section: 'machine',
      keywords: ['терминал', 'console', machine.id],
      run: () => deps.openMachineConsole(machine.id)
    })
  }
  return commands
}

/** Весь набор команд уровня приложения. */
export function buildAppCommands(deps: AppCommandDeps): Command[] {
  return [...baseCommands(deps), ...entityCommands(deps)]
}

// ---- Глобальные биндинги палитры и шпаргалки ---------------------------------

export interface AppHotkeyDeps {
  /** Приветственный мастер пройден: до него горячие клавиши не нужны. */
  onboarded: boolean
  voice: VoiceState
  /** ⌘K: открыть или закрыть палитру (повторное нажатие закрывает). */
  togglePalette: () => void
  openCheatSheet: () => void
}

/**
 * Биндинги уровня приложения. Во время записи голоса не срабатывают: push-to-talk
 * — критичный сценарий, и окно поверх него забрало бы фокус вместе с пробелом.
 * Решение принято в пользу «игнорировать», а не «сначала остановить запись»:
 * молча оборвать реплику хуже, чем не открыть окно.
 */
export function buildHotkeyBindings(deps: AppHotkeyDeps): HotkeyBinding[] {
  const allowed = (): boolean => deps.onboarded && deps.voice !== 'listening'
  return [
    {
      combo: 'mod+k',
      // С модификатором ловим и в поле ввода: палитра нужна в том числе из
      // композера, а пробел и «?» там должны печататься.
      inInput: true,
      enabled: allowed,
      onDown: deps.togglePalette
    },
    {
      combo: '?',
      enabled: allowed,
      onDown: deps.openCheatSheet
    }
  ]
}
