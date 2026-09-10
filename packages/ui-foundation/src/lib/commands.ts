// Реестр команд приложения — одна точка правды для командной палитры (⌘K) и
// шпаргалки горячих клавиш. Устроен как обычное замыкание без React (как стор):
// его можно наполнить и проверить в тесте без рендера, а React подключается
// отдельным файлом (useCommands.ts).
//
// Экраны регистрируют свои команды сами: канбан — «Создать задачу», лента CI —
// «Повторить последний ран». Иначе список пришлось бы держать в App и он
// разъезжался бы с экранами. Регистрация живёт столько, сколько смонтирован
// экран, поэтому в палитре нет команд, которые сейчас некуда применить.
//
// Источник — функция, а не готовый массив: команды берут данные из пропсов и
// стора (список бесед, задачи открытой доски), и массив устарел бы в момент
// регистрации. Список собирается заново при открытии палитры.

import { fuzzyMatch, type FuzzyMatch } from './fuzzy'

/** Раздел палитры. Порядок разделов в выдаче — `COMMAND_SECTIONS`. */
export type CommandSection = 'action' | 'chat' | 'project' | 'task' | 'machine'

/** Порядок разделов сверху вниз. */
export const COMMAND_SECTIONS: readonly CommandSection[] = ['action', 'chat', 'project', 'task', 'machine']

/** Заголовки разделов. */
export const SECTION_TITLES: Record<CommandSection, string> = {
  action: 'Действия',
  chat: 'Беседы',
  project: 'Проекты',
  task: 'Задачи',
  machine: 'Машины'
}

/** Заголовок группы «Недавние» (показывается при пустом запросе). */
export const RECENT_TITLE = 'Недавние'

export interface Command {
  /** Стабильный id: по нему хранятся «недавние» и склеиваются дубли. */
  id: string
  /** Что видит пользователь; по нему же идёт подсветка совпадений. */
  title: string
  section: CommandSection
  /** Вторая строка пункта: контекст (проект задачи, имя машины). Тоже ищется. */
  hint?: string
  /** Слова для поиска, которых нет в названии: «#42», синонимы, латиница. */
  keywords?: string[]
  /** Комбинация для шпаргалки («mod+k», «Space»); саму подписку делает useHotkeys. */
  hotkey?: string
  /** Пояснение к комбинации в шпаргалке («удерживайте»). */
  hotkeyNote?: string
  run: () => void
  /**
   * Команда сейчас применима. Палитра выключенные не показывает, шпаргалка —
   * показывает: она документация, а не список доступного.
   */
  enabled?: () => boolean
}

/** Функция-источник: вызывается при каждой сборке списка. */
export type CommandSource = () => Command[]

/** Снять регистрацию. */
export type Unregister = () => void

const sources: CommandSource[] = []
const listeners = new Set<() => void>()
let revision = 0

function bump(): void {
  revision += 1
  for (const listener of [...listeners]) listener()
}

/** Регистрирует источник команд (список пересобирается при каждом чтении). */
export function registerCommandSource(source: CommandSource): Unregister {
  sources.push(source)
  bump()
  return () => {
    const index = sources.indexOf(source)
    if (index < 0) return
    sources.splice(index, 1)
    bump()
  }
}

/** Регистрирует одну команду с зафиксированными колбэками. */
export function registerCommand(command: Command): Unregister {
  return registerCommandSource(() => [command])
}

/**
 * Текущий состав реестра. Дубли по id склеиваются — побеждает зарегистрированный
 * позже: один и тот же экран бывает на странице дважды (лента рана в модалке и в
 * шапке чата), и «Повторить ран» должен быть один.
 */
export function listCommands(): Command[] {
  const byId = new Map<string, Command>()
  for (const source of sources) {
    let items: Command[]
    try {
      items = source()
    } catch {
      // Экран отдал битые данные — это не повод обрушить палитру целиком.
      continue
    }
    for (const command of items) byId.set(command.id, command)
  }
  return [...byId.values()]
}

/** Номер версии состава реестра: меняется, когда экран приходит или уходит. */
export function commandsRevision(): number {
  return revision
}

/** Подписка на появление/исчезновение источников. */
export function subscribeCommands(listener: () => void): Unregister {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Сброс реестра — только для тестов (в приложении источники снимают экраны). */
export function resetCommands(): void {
  sources.length = 0
  bump()
}

// ---- Недавние ----------------------------------------------------------------

const RECENT_KEY = 'vc:commands:recent'
/** Сколько «недавних» помним и показываем. */
export const RECENT_LIMIT = 5

/** id последних выполненных команд, свежие первыми. */
export function recentCommandIds(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((id): id is string => typeof id === 'string').slice(0, RECENT_LIMIT)
  } catch {
    // Приватный режим или чужой мусор в ключе — «недавних» просто нет.
    return []
  }
}

/** Запомнить выполненную команду (в начало списка, без дублей). */
export function rememberCommand(id: string): void {
  const next = [id, ...recentCommandIds().filter((item) => item !== id)].slice(0, RECENT_LIMIT)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    // Персиста нет — палитра работает, просто без истории.
  }
}

// ---- Поиск и группировка -----------------------------------------------------

/** Найденная команда: вес для сортировки и индексы букв названия для подсветки. */
export interface CommandHit {
  command: Command
  score: number
  /** Индексы совпавших символов в `title`; пусто — совпало по keywords/hint. */
  indices: number[]
}

/** Группа выдачи: раздел или «Недавние». */
export interface CommandGroup {
  /** Ключ группы: раздел или 'recent'. */
  key: CommandSection | 'recent'
  title: string
  hits: CommandHit[]
  /** Сколько пунктов не показано из-за ограничения выдачи. */
  hidden: number
}

export interface SearchOptions {
  /** Сколько пунктов показывать в одной группе. */
  limitPerSection?: number
  /** id недавних команд для группы сверху при пустом запросе. */
  recent?: string[]
}

/** Сколько пунктов в группе по умолчанию: список из сотен бесед не нужен целиком. */
export const DEFAULT_SECTION_LIMIT = 8

/** Штраф за совпадение не в названии: подсветить его нечем, и по смыслу оно слабее. */
const ALT_PENALTY = 1

/**
 * Сверяет команду с запросом. Сначала название (его подсвечиваем), затем
 * keywords и подпись — чтобы «#42» находило задачу, названную словами.
 */
function matchCommand(command: Command, query: string): FuzzyMatch | null {
  const title = fuzzyMatch(command.title, query)
  if (title) return title
  const alternates = [...(command.keywords ?? []), ...(command.hint ? [command.hint] : [])]
  for (const alternate of alternates) {
    const hit = fuzzyMatch(alternate, query)
    if (hit) return { score: hit.score - ALT_PENALTY, indices: [] }
  }
  return null
}

function isEnabled(command: Command): boolean {
  try {
    return command.enabled ? command.enabled() : true
  } catch {
    return false
  }
}

/**
 * Выдача палитры: группы в порядке `COMMAND_SECTIONS`, внутри группы — по весу
 * совпадения. Пустой запрос — «Недавние» сверху и дальше всё по разделам в том
 * порядке, в котором команды зарегистрированы (список бесед остаётся списком
 * бесед). Выключенные команды в выдачу не попадают.
 */
export function searchCommands(commands: Command[], query: string, options: SearchOptions = {}): CommandGroup[] {
  const limit = options.limitPerSection ?? DEFAULT_SECTION_LIMIT
  const trimmed = query.trim()
  const available = commands.filter(isEnabled)

  const groups: CommandGroup[] = []
  const take = (key: CommandSection | 'recent', title: string, hits: CommandHit[]): void => {
    if (!hits.length) return
    groups.push({ key, title, hits: hits.slice(0, limit), hidden: Math.max(0, hits.length - limit) })
  }

  if (trimmed === '') {
    const byId = new Map(available.map((command) => [command.id, command]))
    const recent = (options.recent ?? [])
      .map((id) => byId.get(id))
      .filter((command): command is Command => command != null)
      .map((command) => ({ command, score: 0, indices: [] }))
    take('recent', RECENT_TITLE, recent)
    // Недавние показаны выше — второй раз в своём разделе они не нужны.
    const shown = new Set(recent.map((hit) => hit.command.id))
    for (const section of COMMAND_SECTIONS) {
      const hits = available
        .filter((command) => command.section === section && !shown.has(command.id))
        .map((command) => ({ command, score: 0, indices: [] }))
      take(section, SECTION_TITLES[section], hits)
    }
    return groups
  }

  for (const section of COMMAND_SECTIONS) {
    const hits: CommandHit[] = []
    for (const command of available) {
      if (command.section !== section) continue
      const match = matchCommand(command, trimmed)
      if (!match) continue
      hits.push({ command, score: match.score, indices: match.indices })
    }
    hits.sort((a, b) => b.score - a.score || a.command.title.localeCompare(b.command.title, 'ru'))
    take(section, SECTION_TITLES[section], hits)
  }
  return groups
}
