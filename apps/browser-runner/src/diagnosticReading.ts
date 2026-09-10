import {
  BROWSER_LOG_RESULT_BUDGET,
  normalizeBrowserDiagnosticOptions,
  type BrowserConsoleEntry,
  type BrowserInspectAction,
  type BrowserInspectResult,
  type BrowserNetworkEntry
} from '@voicechat/shared'

type LogAction = Extract<BrowserInspectAction, { kind: 'console' | 'network' }>
interface LogBuffers {
  console: BrowserConsoleEntry[]
  network: BrowserNetworkEntry[]
}
interface LogContext {
  tabId?: string
  sequence?: number
  dropped?: number
}

export function readBrowserDiagnostics(
  logs: LogBuffers,
  action: LogAction,
  context: LogContext = {}
): BrowserInspectResult {
  try {
    const options = normalizeBrowserDiagnosticOptions(action)
    const tabId = options.allTabs ? undefined : (options.tabId ?? context.tabId)
    let pattern: RegExp | undefined
    if (action.kind === 'console') {
      if (action.level !== undefined && !['log', 'info', 'warn', 'error'].includes(action.level))
        throw new Error('Некорректный уровень консоли')
      if (action.pattern !== undefined && (typeof action.pattern !== 'string' || action.pattern.length > 2000))
        throw new Error('Некорректный фильтр консоли')
      if (action.regex !== undefined && typeof action.regex !== 'boolean') throw new Error('Некорректный режим фильтра')
      if (action.pattern && action.regex !== false) {
        try {
          pattern = new RegExp(action.pattern, 'i')
        } catch {
          throw new Error(`Фильтр «${action.pattern}» — не регулярное выражение`)
        }
      }
    } else {
      if (action.filter !== undefined && (typeof action.filter !== 'string' || action.filter.length > 2000))
        throw new Error('Некорректный фильтр сети')
      if (
        action.resourceType !== undefined &&
        (typeof action.resourceType !== 'string' || action.resourceType.length > 100)
      )
        throw new Error('Некорректный тип ресурса')
      if (action.state !== undefined && !['pending', 'response', 'completed', 'failed'].includes(action.state))
        throw new Error('Некорректное состояние запроса')
      if (action.failedOnly !== undefined && typeof action.failedOnly !== 'boolean')
        throw new Error('Некорректный фильтр ошибок сети')
    }
    const entries = action.kind === 'console' ? logs.console : logs.network
    const sequenced = entries.map((entry, index) => ({ entry, sequence: entry.sequence ?? index + 1 }))
    const cursor = context.sequence ?? Math.max(0, ...sequenced.map((item) => item.sequence))
    const filtered = sequenced
      .filter(({ entry, sequence }) => {
        if (tabId !== undefined && entry.tabId !== tabId) return false
        if (options.since !== undefined && sequence <= options.since) return false
        if (options.before !== undefined && sequence >= options.before) return false
        if (action.kind === 'console') {
          const row = entry as BrowserConsoleEntry
          return (
            (!action.level || row.level === action.level) &&
            (!action.pattern ||
              (pattern ? pattern.test(row.text) : row.text.toLowerCase().includes(action.pattern.toLowerCase())))
          )
        }
        const row = entry as BrowserNetworkEntry
        return (
          (!action.filter || row.url.toLowerCase().includes(action.filter.toLowerCase())) &&
          (!action.state || row.state === action.state) &&
          (!action.resourceType || row.resourceType === action.resourceType) &&
          (!action.failedOnly || row.state === 'failed' || row.status >= 400)
        )
      })
      .sort((a, b) => b.sequence - a.sequence)
    const selected: typeof filtered = []
    let size = 300
    for (const item of filtered) {
      if (selected.length >= options.limit) break
      const length = JSON.stringify(item.entry).length + 1
      if (size + length > BROWSER_LOG_RESULT_BUDGET) break
      selected.push(item)
      size += length
    }
    if (filtered.length && !selected.length) return { ok: false, error: 'Запись журнала превышает лимит выдачи' }
    if (options.clear) {
      // Удаляем ровно выданные строки: остальные вкладки, фильтры и старые
      // порции остаются доступны следующему запросу модели.
      const removed = new Set(selected.map((item) => item.entry))
      for (let index = entries.length - 1; index >= 0; index--)
        if (removed.has(entries[index])) entries.splice(index, 1)
    }
    const summary = {
      ok: true,
      total: filtered.length,
      returned: selected.length,
      cursor,
      ...(filtered.length > selected.length ? { truncated: true, nextBefore: selected.at(-1)!.sequence } : {}),
      ...(options.clear ? { cleared: selected.length } : {}),
      ...(context.dropped ? { dropped: context.dropped } : {})
    }
    const rows = selected.reverse().map((item) => ({ ...item.entry }))
    return action.kind === 'console'
      ? { ...summary, console: rows as BrowserConsoleEntry[] }
      : { ...summary, network: rows as BrowserNetworkEntry[] }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Журнал не прочитан' }
  }
}
