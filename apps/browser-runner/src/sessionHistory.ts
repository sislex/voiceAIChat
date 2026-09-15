import type { BrowserCommand, BrowserHistoryEntry } from '@voicechat/shared'

/**
 * What happened in the session, in order, by both sides. The runner is the only
 * place that sees both: the person clicking in the panel and the model acting
 * through MCP. Without this log the question "what did the model just do here"
 * had no answer at all — the page state is the only trace, and it says nothing
 * about the order or about the step that failed and was retried.
 *
 * Deliberately small: a ring buffer of short human wordings, no payloads. The
 * point is a readable feed for the panel and a summary for the model, not an
 * audit trail — pages carry passwords, and a full command dump would keep them.
 */

const LIMIT = 200

export class SessionHistory {
  private entries: BrowserHistoryEntry[] = []

  record(entry: BrowserHistoryEntry): void {
    this.entries.push(entry)
    if (this.entries.length > LIMIT) this.entries.splice(0, this.entries.length - LIMIT)
  }

  /** Tail of the log: fresh lines matter, the beginning of a long session does not. */
  list(options: { actor?: 'user' | 'assistant'; limit?: number } = {}): { total: number; entries: BrowserHistoryEntry[] } {
    const filtered = options.actor ? this.entries.filter((entry) => entry.actor === options.actor) : this.entries
    const limit = Math.min(Math.max(options.limit ?? 30, 1), LIMIT)
    return { total: filtered.length, entries: filtered.slice(-limit) }
  }

  clear(): void {
    this.entries = []
  }
}

/** Short wording of a command, the way a person would name the action. */
export function describeCommand(command: BrowserCommand): { title: string; kind: string; selector?: string; url?: string } | null {
  const selectorOf = (value: unknown): string | undefined => (typeof value === 'string' && value ? value.slice(0, 120) : undefined)
  switch (command.type) {
    case 'navigate':
      return { title: `переход на ${command.url}`, kind: 'navigate', url: command.url }
    case 'back':
      return { title: 'назад по истории', kind: 'back' }
    case 'forward':
      return { title: 'вперёд по истории', kind: 'forward' }
    case 'reload':
      return { title: 'перезагрузка страницы', kind: 'reload' }
    case 'stop':
      return { title: 'остановка загрузки', kind: 'stop' }
    case 'newTab':
      return { title: command.url ? `новая вкладка: ${command.url}` : 'новая вкладка', kind: 'newTab', ...(command.url ? { url: command.url } : {}) }
    case 'selectTab':
      return { title: 'переключение вкладки', kind: 'selectTab' }
    case 'closeTab':
      return { title: 'закрытие вкладки', kind: 'closeTab' }
    case 'resize':
      return { title: `размер окна ${command.viewport.width}px`, kind: 'resize' }
    case 'environment':
      return { title: 'смена среды браузера', kind: 'environment' }
    case 'cookies':
      return { title: `cookies: ${command.action}`, kind: 'cookies' }
    case 'clearSiteData':
      return { title: 'очистка данных сайта', kind: 'clearSiteData' }
    case 'handleDialog':
      return { title: 'ответ на диалог сайта', kind: 'handleDialog' }
    case 'input': {
      const action = command.action
      if (action.type === 'click') return { title: `клик (${Math.round(action.x)}, ${Math.round(action.y)})`, kind: 'click' }
      if (action.type === 'type') return { title: `ввод текста (${action.text.length} симв.)`, kind: 'type' }
      if (action.type === 'press') return { title: `клавиша ${action.key}`, kind: 'press' }
      if (action.type === 'hotkey') return { title: `сочетание ${[...action.modifiers, action.key].join('+')}`, kind: 'hotkey' }
      if (action.type === 'wheel') return { title: 'прокрутка', kind: 'scroll' }
      if (action.type === 'drag') return { title: 'перетаскивание', kind: 'drag' }
      return null
    }
    case 'selector': {
      const action = command.action
      const selector = selectorOf((action as { selector?: string }).selector)
      const text = selectorOf((action as { text?: string }).text)
      const target = selector ?? (text ? `«${text}»` : undefined)
      // Чтение не попадает в ленту: модель читает страницу десятки раз за ход,
      // и лента человека превратилась бы в поток «прочитал, прочитал, нашёл».
      const quiet = ['read', 'find', 'a11y', 'metrics', 'measure', 'count', 'table', 'list', 'formState', 'validity', 'options', 'focusOrder', 'describe', 'copy', 'media']
      if (quiet.includes(action.kind)) return null
      const titles: Record<string, string> = {
        click: 'клик', type: 'ввод текста', press: 'клавиша', hover: 'наведение', set: 'значение контрола',
        scroll: 'прокрутка', scrollTo: 'прокрутка к элементу', scrollUntil: 'прокрутка ленты', drag: 'перетаскивание',
        upload: 'загрузка файла', dropFile: 'файлы в зону', fillForm: 'заполнение формы', submit: 'отправка формы',
        clear: 'очистка поля', paste: 'вставка текста', selectText: 'выделение текста', focus: 'фокус',
        wait: 'ожидание', highlight: 'подсветка элемента', expect: 'проверка'
      }
      const title = titles[action.kind] ?? action.kind
      return { title: target ? `${title}: ${target}` : title, kind: action.kind, ...(selector ? { selector } : {}) }
    }
    case 'inspect': {
      if (command.action.kind === 'evaluate') return { title: 'выполнение JS на странице', kind: 'evaluate' }
      return null
    }
    default:
      return null
  }
}
