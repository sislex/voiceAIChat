import { randomUUID } from 'node:crypto'
import type { ConsoleMessage, Page, Request } from 'playwright'
import {
  BROWSER_LOG_CAPACITY,
  BROWSER_LOG_MESSAGE_LIMIT,
  BROWSER_LOG_STACK_LIMIT,
  browserConsoleLevel,
  type BrowserConsoleEntry,
  type BrowserDiagnosticValue,
  type BrowserInspectAction,
  type BrowserNetworkEntry
} from '@voicechat/shared'
import { readBrowserDiagnostics } from './diagnosticReading.js'

/** Дескрипторы обходятся без вызова getter, а размер ограничен ещё в renderer. */
// tsx добавляет __name к локальным функциям. Тело renderer хранится как JS,
// чтобы сериализация Playwright не ссылалась на helper процесса Node.
const consoleArgument = new Function(
  'value',
  String.raw`
  const seen = new Set()
  let nodes = 0, truncated = false
  const omitted = (text) => { truncated = true; return text }
  const visit = (item, depth) => {
    if (++nodes > 100) return omitted('[Сокращено]')
    if (item === null || typeof item === 'boolean') return item
    if (typeof item === 'string') return item.length > 1000 ? omitted(item.slice(0, 1000) + '…') : item
    if (typeof item === 'number') return Number.isFinite(item) ? item : String(item)
    if (typeof item !== 'object') return omitted(String(item).slice(0, 1000))
    if (seen.has(item)) return omitted('[Циклическая ссылка]')
    if (depth >= 4) return omitted('[Вложенный объект]')
    seen.add(item)
    try {
      const descriptors = Object.getOwnPropertyDescriptors(item)
      const allKeys = Object.keys(descriptors).filter(key => key !== 'length'), keys = allKeys.slice(0, 20)
      if (allKeys.length > keys.length) truncated = true
      const property = (key) => 'value' in descriptors[key] ? visit(descriptors[key].value, depth + 1) : omitted('[Getter]')
      if (Array.isArray(item)) return keys.map(property)
      const out = {}
      for (const key of keys) { if (key.length > 200) truncated = true; out[key.slice(0, 200)] = property(key) }
      if (allKeys.length > keys.length) out['…'] = '[Сокращено]'
      return out
    } catch { return omitted('[Недоступный объект]') }
    finally { seen.delete(item) }
  }
  const result = visit(value, 0)
  return { value: result, truncated }
`
) as (value: unknown) => { value: BrowserDiagnosticValue; truncated: boolean }

export class BrowserDiagnostics {
  readonly console: BrowserConsoleEntry[] = []
  readonly network: BrowserNetworkEntry[] = []
  private sequence = 0
  private consoleDropped = 0
  private networkDropped = 0
  private readonly requests = new WeakMap<Request, { entry: BrowserNetworkEntry; started: number }>()
  constructor(private readonly publicUrl: (url: string) => string) {}

  private url(raw: string): string {
    return (raw.startsWith('blob:') ? 'blob:' + this.publicUrl(raw.slice(5)) : this.publicUrl(raw)).slice(0, 2000)
  }
  private stack(raw: string): string {
    return raw.replace(/https?:\/\/[^\s)]+/g, (url) => this.url(url))
  }
  private touch(entry: BrowserConsoleEntry | BrowserNetworkEntry): void {
    entry.sequence = ++this.sequence
  }
  private addConsole(entry: BrowserConsoleEntry): void {
    this.touch(entry)
    this.console.push(entry)
    if (this.console.length > BROWSER_LOG_CAPACITY) {
      this.consoleDropped += this.console.length - BROWSER_LOG_CAPACITY
      this.console.splice(0, this.console.length - BROWSER_LOG_CAPACITY)
    }
    this.boundConsole(entry)
  }
  private boundConsole(entry: BrowserConsoleEntry): void {
    while (JSON.stringify(entry).length > 10000) {
      if (entry.args?.length) {
        entry.args.pop()
        entry.argsTruncated = true
      } else if ((entry.stack?.length ?? 0) > 256) {
        entry.stack = entry.stack!.slice(0, Math.floor(entry.stack!.length / 2))
        entry.stackTruncated = true
      } else if (entry.text.length > 256) {
        entry.text = entry.text.slice(0, Math.floor(entry.text.length / 2))
        entry.textTruncated = true
      } else break
    }
  }
  private async arguments(message: ConsoleMessage, entry: BrowserConsoleEntry): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const args = message.args()
    const work = Promise.all(
      args
        .slice(0, 6)
        .map((argument) =>
          argument
            .evaluate(consoleArgument)
            .catch(() => ({ value: '[Недоступное значение]', truncated: true, unavailable: true }))
        )
    )
    try {
      const result = await Promise.race([
        work,
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), 500)
        })
      ])
      if (!this.console.includes(entry)) return
      delete entry.argsPending
      if (result) {
        entry.args = result.map((argument) => argument.value)
        if (args.length > 6 || result.some((argument) => argument.truncated)) entry.argsTruncated = true
        if (result.some((argument) => 'unavailable' in argument)) entry.argsUnavailable = true
      } else entry.argsUnavailable = true
      this.boundConsole(entry)
      this.touch(entry)
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  register(page: Page, tabId: string): void {
    page.on('console', (message) => {
      const location = message.location(),
        text = message.text()
      const entry: BrowserConsoleEntry = {
        id: randomUUID(),
        tabId,
        pageUrl: this.url(page.url()),
        level: browserConsoleLevel(message.type()),
        sourceType: message.type(),
        text: text.slice(0, BROWSER_LOG_MESSAGE_LIMIT),
        at: Date.now(),
        ...(text.length > BROWSER_LOG_MESSAGE_LIMIT ? { textTruncated: true } : {}),
        ...(location.url
          ? {
              source: { url: this.url(location.url), line: location.lineNumber + 1, column: location.columnNumber + 1 }
            }
          : {}),
        ...(message.args().length ? { argsPending: true } : {})
      }
      this.addConsole(entry)
      if (entry.argsPending)
        void this.arguments(message, entry).catch(() => {
          if (this.console.includes(entry)) {
            delete entry.argsPending
            entry.argsUnavailable = true
            this.touch(entry)
          }
        })
    })
    page.on('pageerror', (error) => {
      const stack = this.stack(error.stack ?? '')
      this.addConsole({
        id: randomUUID(),
        tabId,
        pageUrl: this.url(page.url()),
        level: 'error',
        sourceType: 'pageerror',
        text: error.message.slice(0, BROWSER_LOG_MESSAGE_LIMIT),
        at: Date.now(),
        ...(error.message.length > BROWSER_LOG_MESSAGE_LIMIT ? { textTruncated: true } : {}),
        ...(stack
          ? {
              stack: stack.slice(0, BROWSER_LOG_STACK_LIMIT),
              ...(stack.length > BROWSER_LOG_STACK_LIMIT ? { stackTruncated: true } : {})
            }
          : {})
      })
    })
    page.on('request', (request) => {
      let frameUrl: string | undefined,
        pageUrl = this.url(page.url())
      try {
        const frame = request.frame()
        frameUrl = this.url(request.isNavigationRequest() ? request.url() : frame.url())
        if (request.isNavigationRequest() && frame === page.mainFrame()) pageUrl = this.url(request.url())
      } catch {
        /* запрос служебного worker может не иметь frame */
      }
      const previous = request.redirectedFrom(),
        previousEntry = previous ? this.requests.get(previous)?.entry : undefined
      const entry: BrowserNetworkEntry = {
        id: randomUUID(),
        tabId,
        pageUrl,
        ...(frameUrl ? { frameUrl } : {}),
        method: request.method(),
        url: this.url(request.url()),
        status: 0,
        ok: false,
        state: 'pending',
        resourceType: request.resourceType(),
        at: Date.now(),
        ...(previousEntry?.id ? { redirectedFrom: previousEntry.id } : {})
      }
      if (previousEntry) {
        previousEntry.redirectedTo = entry.id
        this.touch(previousEntry)
      }
      this.touch(entry)
      this.network.push(entry)
      this.requests.set(request, { entry, started: performance.now() })
      if (this.network.length > BROWSER_LOG_CAPACITY) {
        this.networkDropped += this.network.length - BROWSER_LOG_CAPACITY
        this.network.splice(0, this.network.length - BROWSER_LOG_CAPACITY)
      }
    })
    page.on('response', (response) => {
      const tracked = this.requests.get(response.request())
      if (!tracked || !this.network.includes(tracked.entry)) return
      const entry = tracked.entry
      entry.status = response.status()
      entry.ok = response.ok() || (entry.status >= 300 && entry.status < 400)
      entry.state = 'response'
      entry.durationMs = Math.max(0, Math.round(performance.now() - tracked.started))
      this.touch(entry)
    })
    page.on('requestfinished', (request) => {
      const tracked = this.requests.get(request)
      if (!tracked || !this.network.includes(tracked.entry)) return
      tracked.entry.state = 'completed'
      tracked.entry.durationMs = Math.max(0, Math.round(performance.now() - tracked.started))
      this.touch(tracked.entry)
    })
    page.on('requestfailed', (request) => {
      const tracked = this.requests.get(request)
      if (!tracked || !this.network.includes(tracked.entry) || tracked.entry.download) return
      tracked.entry.state = 'failed'
      tracked.entry.ok = false
      tracked.entry.error = request.failure()?.errorText?.slice(0, 500) ?? 'Запрос не завершился'
      tracked.entry.durationMs = Math.max(0, Math.round(performance.now() - tracked.started))
      this.touch(tracked.entry)
    })
    page.on('download', (download) => {
      // Navigation, переданная менеджеру файлов, может завершиться ERR_ABORTED.
      // Успех/отмена самого файла проверяются каталогом downloads.
      const url = this.url(download.url()),
        entry = [...this.network].reverse().find((item) => item.tabId === tabId && item.url === url)
      if (entry) {
        entry.download = true
        entry.state = 'completed'
        entry.ok = true
        delete entry.error
        this.touch(entry)
      }
    })
  }
  hasTab(tabId: string): boolean {
    return this.console.some((entry) => entry.tabId === tabId) || this.network.some((entry) => entry.tabId === tabId)
  }
  read(action: Extract<BrowserInspectAction, { kind: 'console' | 'network' }>, tabId: string) {
    return readBrowserDiagnostics(this, action, {
      tabId,
      sequence: this.sequence,
      dropped: action.kind === 'console' ? this.consoleDropped : this.networkDropped
    })
  }
}
