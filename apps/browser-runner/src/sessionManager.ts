import { BrowserCommandQueue } from './commandQueue.js'
import { runEvaluation, isEvaluating } from './evaluation.js'
import { BrowserDiagnostics } from './diagnostics.js'
import { BrowserDownloads } from './downloads.js'
import { browserDownloadList, type BrowserDownloadResult } from '@voicechat/shared'
import { BrowserDialogs } from './dialogs.js'
import { boundedBrowserDialogs, type BrowserDialogListResult } from '@voicechat/shared'
import { runBrowserInput } from './inputActions.js'
import { normalizeBrowserProfileMode, type BrowserProfileMode, type BrowserSiteDataResetResult } from '@voicechat/shared'
import { clearSiteData, httpOrigin } from './siteData.js'
import { readReaderProfile, writeReaderProfile } from './profileState.js'
import { resolveFrame, framePage, listFrames, framePath } from './frames.js'
import { describeFramePoint } from './frameDescription.js'
import { captureFrame } from './frameCapture.js'
import { mkdir, readdir, rm } from 'node:fs/promises'
import { lookup } from 'node:dns/promises'
import { randomUUID } from 'node:crypto'
import { chromium, type BrowserContext, type Locator, type Page } from 'playwright'
import type { BrowserCommandRequest, BrowserFramesResult, BrowserConsoleEntry, BrowserInspectResult, BrowserNetworkEntry, BrowserSelectorResult, BrowserSessionMetadata, BrowserTab, BrowserViewport } from '@voicechat/shared'
import { aliasTargets, applyHostAlias, browserTarget, isBlockedAddress, profilePath, restoreHostAlias, validatePublicUrl, type HostAliases } from './security.js'
import { runSelectorAction } from './selectorActions.js'
import { runInspectAction } from './inspectActions.js'
import { capturePage, type BrowserCapture } from './screenshots.js'

interface Session {
  queue: BrowserCommandQueue
  diagnostics: BrowserDiagnostics
  downloads: BrowserDownloads
  downloadsPath: string
  dialogs: BrowserDialogs
  id: string
  userKey: string
  conversationKey: string
  incarnation: string
  context: BrowserContext
  pages: Map<string, Page>
  pageIds: WeakMap<Page, string>
  openerIds: Map<string, string>
  activeTabId: string
  viewport: BrowserViewport
  /** Кольцевые журналы страницы: без них модели нечем проверять поведение. */
  console: BrowserConsoleEntry[]
  network: BrowserNetworkEntry[]
  /** QA удаляет каталог; Reader сохраняет авторизацию между открытиями панели. */
  profileDir: string
  profileMode: BrowserProfileMode
  origins: Set<string>
  bootstrapCookies: Array<{ name: string; host: string }>
  /** Последнее обращение — по нему сборщик находит брошенные сессии. */
  lastUsedAt: number
  /** Кто выполнял последнюю команду: человек из панели или модель. */
  lastActor?: 'user' | 'assistant'
}

// Внешняя аналитика и изображения могут грузиться бесконечно; работать с DOM
// нужно одинаково при переходе, перезагрузке, истории и открытии вкладки.
const NAVIGATION_OPTIONS = { waitUntil: 'domcontentloaded' as const, timeout: 30_000 }

/**
 * Какая вкладка становится активной после закрытия. Закрытая не должна
 * оставаться активной: `activeTabId` указывал на удалённую страницу, и каждая
 * следующая команда падала `stale_tab` — сессия становилась непригодной, хотя
 * другие вкладки живы. Пустая строка означает «вкладок не осталось».
 */
export function nextActiveTab(open: string[], activeId: string, closedId: string, openerId?: string): string {
  if (activeId !== closedId) return activeId
  if (openerId && openerId !== closedId && open.includes(openerId)) return openerId
  return open.find((id) => id !== closedId) ?? ''
}

/**
 * Cookie, которую сервер кладёт в контекст сессии. Нужна одному сценарию:
 * dev-сервер выбранной машины живёт на её loopback и открывается через прокси
 * превью сервера, а навигация браузера не носит Bearer-заголовков.
 */
export interface StartSessionCookie {
  name: string
  value: string
  url: string
}

export interface StartSessionRequest {
  profileMode?: BrowserProfileMode
  sessionId: string
  userKey: string
  conversationKey: string
  viewport?: BrowserViewport
  cookies?: StartSessionCookie[]
}

export class BrowserSessionManager {
  private readonly sessions = new Map<string, Promise<Session>>()
  private readonly stopping = new Map<string, Promise<boolean>>()
  private closing = false

  private readonly allowedTargets: Set<string>

  constructor(
    private readonly profilesRoot: string,
    private readonly hostAliases: HostAliases = new Map(),
    /** Доверенный origin сервера (`host:port`) для браузерных проверок задач. */
    private readonly previewOrigin: string | null = null
  ) {
    this.allowedTargets = aliasTargets(hostAliases)
    if (previewOrigin) {
      this.allowedTargets.add(previewOrigin)
    }
  }

  async start(request: StartSessionRequest): Promise<BrowserSessionMetadata> {
    const profileMode = normalizeBrowserProfileMode(request.profileMode)
    const cookies = this.validCookies(request.cookies)
    if (this.closing) throw new Error('browser manager is closing')
    const stopping = this.stopping.get(request.sessionId)
    if (stopping) await stopping
    if (this.closing) throw new Error('browser manager is closing')
    let pending = this.sessions.get(request.sessionId)
    if (!pending) {
      pending = this.create({ ...request, profileMode, cookies })
      this.sessions.set(request.sessionId, pending)
      pending.catch(() => { if (this.sessions.get(request.sessionId) === pending) this.sessions.delete(request.sessionId) })
    }
    const session = await pending
    if (this.stopping.has(request.sessionId)) throw new Error('not_ready')
    if (session.userKey !== request.userKey || session.conversationKey !== request.conversationKey) throw new Error('session identity mismatch')
    // Идемпотентный start переиспользует живую сессию, но ключ доступа сервер
    // выдаёт заново: без повторной установки в профиле осталась бы прошлая
    // cookie, и прокси превью ответил бы 401 посреди рана.
    await this.applyCookies(session, cookies)
    return await this.metadata(session)
  }

  private async create(request: StartSessionRequest): Promise<Session> {
    const path = profilePath(this.profilesRoot, request.userKey, request.conversationKey)
    await mkdir(path, { recursive: true, mode: 0o700 })
    const profileMode = request.profileMode ?? 'ephemeral'
    const saved = profileMode === 'persistent' ? await readReaderProfile(path) : null
    const viewport = request.viewport ?? saved?.viewport ?? { width: 1280, height: 800, deviceScaleFactor: 1 }
    const downloadsPath = path + '/reader-downloads-' + randomUUID()
    const context = await chromium.launchPersistentContext(path, {
      downloadsPath,
      headless: true,
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: viewport.deviceScaleFactor,
      acceptDownloads: true,
      permissions: [],
      serviceWorkers: 'allow'
    }).catch(async error => { await rm(downloadsPath, { recursive: true, force: true }).catch(() => undefined); throw error })
    try {
      // После захвата Chromium-профиля прежней живой сессии здесь уже нет.
      // Удаляем только свои UUID-каталоги, оставшиеся после аварийного выхода.
      for (const entry of await readdir(path, { withFileTypes: true })) {
        const stale = path + '/' + entry.name
        if (entry.isDirectory() && /^reader-downloads-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entry.name) && stale !== downloadsPath) await rm(stale, { recursive: true, force: true })
      }
      const diagnostics = new BrowserDiagnostics(url => this.publicUrl(url))
      const session: Session = {
        queue: new BrowserCommandQueue(),
        diagnostics,
        dialogs: new BrowserDialogs(),
        downloads: new BrowserDownloads(url => this.publicUrl(url)),
        downloadsPath,
        id: request.sessionId,
        userKey: request.userKey,
        conversationKey: request.conversationKey,
        incarnation: randomUUID(),
        context,
        pages: new Map(),
        pageIds: new WeakMap(),
        openerIds: new Map(),
        console: diagnostics.console,
        network: diagnostics.network,
        activeTabId: '',
        viewport,
        profileDir: path, profileMode,
        origins: new Set(saved?.origins ?? []), bootstrapCookies: [],
        lastUsedAt: Date.now()
      }
      await session.downloads.attachLimits(context, downloadsPath)
      await context.route('**/*', async (route) => {
        try {
          const requested = validatePublicUrl(route.request().url(), this.allowedTargets)
          // Алиас применяется после проверки: во внутреннюю сеть пускает оператор
          // списком пар, а не пользователь адресом.
          const aliased = applyHostAlias(requested, this.hostAliases)
          // Цель алиаса разрешена явно: её назвал оператор, а не пользователь
          // адресом. Проверку приватных сетей для остальных адресов не трогаем.
          if (this.allowedTargets.has(browserTarget(aliased))) {
            return aliased.toString() === requested.toString() ? route.continue() : route.continue({ url: aliased.toString() })
          }
          // Несуществующий домен и запрещённый политикой — разные беды, и раньше
          // обе давали ERR_BLOCKED_BY_CLIENT: человек думал, что его адрес в
          // чёрном списке, хотя тот просто не резолвится.
          let addresses
          try { addresses = await lookup(aliased.hostname.replace(/^\[|\]$/g, ''), { all: true, verbatim: true }) }
          catch { return route.abort('namenotresolved') }
          if (addresses.some((entry) => isBlockedAddress(entry.address))) return route.abort('blockedbyclient')
          return route.continue()
        } catch {
          return route.abort('blockedbyclient')
        }
      })
      const register = (page: Page): string => {
        const known = session.pageIds.get(page)
        if (known) return known
        const id = randomUUID()
        session.pageIds.set(page, id)
        session.pages.set(id, page)
        session.dialogs.register(page, id)
        session.downloads.register(page, id)
        page.on('close', () => {
          session.pages.delete(id)
          session.activeTabId = nextActiveTab([...session.pages.keys()], session.activeTabId, id, session.openerIds.get(id))
          session.openerIds.delete(id)
        })
        page.on('framenavigated', frame => { const origin = httpOrigin(frame.url()); if (origin) session.origins.add(origin) })
        page.on('popup', (popup) => session.openerIds.set(register(popup), id))
        diagnostics.register(page, id)
        return id
      }
      for (const page of context.pages()) register(page)
      const initial = context.pages()[0] ?? await context.newPage()
      session.activeTabId = register(initial)
      context.on('page', (page) => register(page))
      const entry = this.sessions.get(request.sessionId)
      context.on('close', () => { if (this.sessions.get(request.sessionId) === entry) this.sessions.delete(request.sessionId); void rm(downloadsPath, { recursive: true, force: true }).catch(() => undefined) })
      if (saved?.cookies.length) await context.addCookies(saved.cookies).catch(() => undefined)
      await this.applyCookies(session, request.cookies)
      if (saved?.url && saved.url !== 'about:blank') {
        const savedUrl = saved.url
        try { await session.dialogs.run(initial, () => initial.goto(applyHostAlias(validatePublicUrl(savedUrl, this.allowedTargets), this.hostAliases).toString(), { ...NAVIGATION_OPTIONS, timeout: 10000 })) }
        catch (error) { session.console.push({ level: 'warning', text: `Последняя страница не восстановлена: ${error instanceof Error ? error.message.split('\n')[0] : 'ошибка перехода'}`, at: Date.now() }) }
      }
      return session
    } catch (error) {
      await context.close().catch(() => undefined)
      await rm(downloadsPath, { recursive: true, force: true }).catch(() => undefined)
      if (profileMode !== 'persistent') await rm(path, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
  }

  private validCookies(cookies: StartSessionCookie[] | undefined): StartSessionCookie[] {
    if (cookies === undefined) return []
    if (!Array.isArray(cookies)) throw new Error('invalid session cookies')
    for (const cookie of cookies) {
      if (!cookie || typeof cookie.name !== 'string' || !cookie.name || typeof cookie.value !== 'string' || /[\r\n;]/.test(cookie.name) || /[\r\n]/.test(cookie.value) || typeof cookie.url !== 'string') throw new Error('invalid session cookies')
      try { validatePublicUrl(cookie.url, this.allowedTargets) } catch { throw new Error('invalid session cookie URL') }
    }
    return cookies.map(cookie => ({ ...cookie }))
  }

  /** Весь вход уже проверен до запуска Chromium; здесь обновляется ключ прокси. */
  private async applyCookies(session: Session, cookies: StartSessionCookie[] | undefined): Promise<void> {
    if (!cookies?.length) return
    await session.context.addCookies(cookies.map(cookie => ({ name: cookie.name, value: cookie.value, url: cookie.url })))
    session.bootstrapCookies = cookies.map(cookie => ({ name: cookie.name, host: new URL(cookie.url).hostname }))
  }

  async stop(sessionId: string): Promise<boolean> {
    const current = this.stopping.get(sessionId)
    if (current) return current
    const pending = this.sessions.get(sessionId)
    if (!pending) return false
    // Новый start ждёт закрытия и очистки каталога. Старый close не должен
    // удалить уже запущенную новую incarnation или её файлы.
    const task = (async () => {
      const session = await pending.catch(() => null)
      if (!session) return false
      session.queue.cancel()
      let saveError: unknown
      if (session.profileMode === 'persistent') {
        try { await writeReaderProfile(session.profileDir, { cookies: await session.context.cookies(), origins: [...session.origins], viewport: session.viewport, url: this.publicUrl(session.pages.get(session.activeTabId)?.url() ?? 'about:blank') }) }
        catch (error) { saveError = error }
      }
      await session.context.close()
      if (session.downloadsPath) await rm(session.downloadsPath, { recursive: true, force: true }).catch(() => undefined)
      if (session.profileMode !== 'persistent') await rm(session.profileDir, { recursive: true, force: true }).catch(() => undefined)
      if (this.sessions.get(sessionId) === pending) this.sessions.delete(sessionId)
      if (saveError) throw new Error('Профиль Reader не удалось сохранить')
      return true
    })()
    this.stopping.set(sessionId, task)
    void task.finally(() => { if (this.stopping.get(sessionId) === task) this.stopping.delete(sessionId) }).catch(() => undefined)
    return task
  }

  /**
   * Уборка брошенных сессий. Chromium держится до явного `stop`, а его никто не
   * зовёт, когда пользователь просто закрыл вкладку или сервер перезапустился:
   * процесс браузера жил до перезапуска контейнера.
   */
  async sweepIdle(idleMs: number, at = Date.now()): Promise<string[]> {
    const stale: string[] = []
    for (const [id, pending] of this.sessions) {
      const session = await pending.catch(() => null)
      if (session && at - session.lastUsedAt >= idleMs) stale.push(id)
    }
    for (const id of stale) await this.stop(id).catch(() => undefined)
    return stale
  }

  async command(sessionId: string, request: BrowserCommandRequest): Promise<BrowserSessionMetadata | BrowserCapture | BrowserSelectorResult | BrowserInspectResult | BrowserFramesResult | BrowserSiteDataResetResult | BrowserDialogListResult | BrowserDownloadResult> {
    const session = await this.require(sessionId)
    if (request.incarnation !== session.incarnation) throw new Error('stale_incarnation')
    session.lastUsedAt = Date.now()
    const command = request.command
    if (command.type === 'control' || command.type === 'cancel') {
      if (command.frame !== undefined) throw new Error('Управление очередью не поддерживает frame')
      if (request.actor !== 'user') throw new Error('human_control: Управление может передать только пользователь')
      if (command.type === 'control') {
        if (command.owner !== 'shared' && command.owner !== 'user') throw new Error('invalid_control')
        session.queue.control(command.owner)
      } else session.queue.cancel()
      return this.metadata(session)
    }
    const observing = command.type === 'status' || command.type === 'screenshot' || command.type === 'dialogs' || command.type === 'downloads' || command.type === 'readDownload' || (command.type === 'inspect' && ['console', 'network', 'audit'].includes(command.action.kind))
    if (!observing && request.actor === 'assistant' && session.queue.owner === 'user') throw new Error('human_control: Управление у пользователя. Дождитесь возврата управления модели.')
    if (command.type === 'inspect' && command.action.kind === 'evaluate') {
      const target = session.pages.get(request.tabId ?? session.activeTabId)
      if (target && isEvaluating(target)) return { ok: false, error: 'Во вкладке уже выполняется evaluate' }
    }
    if (command.type === 'inspect' && (command.action.kind === 'console' || command.action.kind === 'network')) {
      if (command.frame !== undefined) throw new Error('Журнал не поддерживает frame; используйте frameUrl и source для вложенных документов')
      const action = command.action
      if (action.tabId !== undefined && request.tabId !== undefined && action.tabId !== request.tabId) throw new Error('Неоднозначная вкладка журнала')
      const tabId = action.tabId ?? request.tabId ?? session.activeTabId
      if (!action.allTabs && tabId && !session.pages.has(tabId) && !session.diagnostics.hasTab(tabId)) throw new Error('stale_tab')
      return session.diagnostics.read(action, tabId)
    }
    if (['downloads', 'readDownload', 'cancelDownload', 'deleteDownload'].includes(command.type) && command.frame !== undefined) throw new Error('Скачивания принадлежат вкладке; frame здесь не поддерживается')
    if (command.type === 'downloads') {
      if (command.tabId !== undefined && !session.pages.has(command.tabId) && !session.downloads.list(command.tabId).length) throw new Error('stale_tab')
      return browserDownloadList(session.downloads.list(), command)
    }
    if (command.type === 'readDownload') return session.downloads.read(command.downloadId, command)
    if (command.type === 'cancelDownload') { const result = await session.downloads.cancel(command.downloadId); session.lastActor = request.actor; return result }
    if (command.type === 'deleteDownload') { const result = await session.downloads.remove(command.downloadId); session.lastActor = request.actor; return result }
    if ((command.type === 'dialogs' || command.type === 'handleDialog') && command.frame !== undefined) throw new Error('Диалоги принадлежат вкладке; frame здесь не поддерживается')
    if (command.type === 'dialogs') {
      if (command.tabId !== undefined && !session.pages.has(command.tabId)) throw new Error('stale_tab')
      return boundedBrowserDialogs(session.dialogs.list(command.tabId), session.activeTabId)
    }
    if (command.type === 'handleDialog') { await session.dialogs.handle(command); session.lastActor = request.actor; return this.metadata(session) }
    if (command.type === 'status') return this.executeCommand(sessionId, request)
    // Ответ диалогу и status идут выше очереди: иначе ожидающий prompt заблокирует собственный ответ.
    // Вкладка определяется при начале операции, после предшествующего selectTab/newTab.
    return session.queue.enqueue(request.actor, () => {
      // Открытый диалог прежней вкладки не мешает выбрать другое окно.
      if (command.type === 'selectTab') return this.executeCommand(sessionId, request)
      const targetId = command.type === 'closeTab' ? command.tabId : request.tabId ?? session.activeTabId
      const page = command.type === 'newTab' ? undefined : session.pages.get(targetId)
      return session.dialogs.run(page, () => this.executeCommand(sessionId, request), command.type === 'closeTab')
    }, observing)
  }

  private async executeCommand(sessionId: string, request: BrowserCommandRequest): Promise<BrowserSessionMetadata | BrowserCapture | BrowserSelectorResult | BrowserInspectResult | BrowserFramesResult | BrowserSiteDataResetResult> {
    const session = await this.require(sessionId)
    if (request.incarnation !== session.incarnation) throw new Error('stale_incarnation')
    // Отметка обращения ставится здесь, а не в `metadata`: селекторные команды,
    // разбор журналов и снимок экрана возвращаются раньше метаданных, а именно
    // из них состоит прогон сценария. Сборщик считал такую сессию брошенной и
    // закрывал Chromium посреди работы.
    session.lastUsedAt = Date.now()
    const command = request.command
    if (command.frame !== undefined) {
      framePath(command.frame)
      if (!['navigate', 'selector', 'inspect', 'screenshot'].includes(command.type)) throw new Error('Эта команда не поддерживает frame')
    }
    // Наблюдение панели не должно стирать отметку о действии модели.
    if (command.type === 'status') return this.metadata(session)
    if (command.type !== 'screenshot' && !(command.type === 'inspect' && command.action.kind === 'audit')) session.lastActor = request.actor
    // Управление вкладками не требует существования прежней активной страницы:
    // после закрытия последней пользователь всё ещё должен суметь открыть новую.
    if (command.type === 'newTab') {
      const url = command.url ? applyHostAlias(validatePublicUrl(command.url, this.allowedTargets), this.hostAliases).toString() : null
      const created = await session.context.newPage()
      // Размер контекста остался исходным после resize существующих страниц.
      await created.setViewportSize(session.viewport)
      const id = session.pageIds.get(created) ?? randomUUID()
      session.pageIds.set(created, id); session.pages.set(id, created); session.activeTabId = id
      if (url) await session.downloads.navigate(created, () => created.goto(url, NAVIGATION_OPTIONS))
      return this.metadata(session)
    }
    if (command.type === 'selectTab' || command.type === 'closeTab') {
      const target = session.pages.get(command.tabId)
      if (!target || target.isClosed()) throw new Error('stale_tab')
      if (command.type === 'selectTab') session.activeTabId = command.tabId
      else await target.close({ runBeforeUnload: !session.dialogs.forPage(target) })
      return this.metadata(session)
    }
    if (command.type === 'clearSiteData') return clearSiteData(session, session.pages.get(request.tabId ?? session.activeTabId), command, raw => this.publicUrl(raw))
    const tabId = request.tabId ?? session.activeTabId
    const page = session.pages.get(tabId)
    if (!page) throw new Error('stale_tab')
    if (command.type === 'frames') return { ...await listFrames(page, raw => this.publicUrl(raw)), page: { url: this.publicUrl(page.url()), title: await page.title() } }
    if (command.frame !== undefined) {
      if (command.type === 'screenshot') return captureFrame(page, command as typeof command & { frame: NonNullable<typeof command.frame> }, raw => this.publicUrl(raw))
      if (!['navigate', 'selector', 'inspect'].includes(command.type) || (command.type === 'inspect' && !['styles', 'evaluate'].includes(command.action.kind))) throw new Error('Эта команда не поддерживает frame')
      const timeout = command.type === 'selector' && command.action.kind === 'wait' ? command.action.timeoutMs ?? 5000 : command.type === 'navigate' ? 30000 : 5000
      const started = performance.now(), deadline = started + timeout
      const selected = await resolveFrame(page, command.frame, timeout)
      let result: BrowserSelectorResult | BrowserInspectResult
      if (command.type === 'navigate') {
        await session.downloads.navigate(page, () => selected.goto(applyHostAlias(validatePublicUrl(command.url, this.allowedTargets), this.hostAliases).toString(), { ...NAVIGATION_OPTIONS, timeout: Math.max(1, deadline - performance.now()) }))
        result = { ok: true }
      } else if (command.type === 'selector') {
        if (command.action.kind === 'describe') throw new Error('describe использует координаты всей страницы и автоматически определяет frame')
        const action = command.action.kind === 'wait' ? { ...command.action, timeoutMs: Math.max(1, Math.floor(deadline - performance.now())) } : command.action
        const content = await runSelectorAction(framePage(page, selected), action, raw => this.publicUrl(raw))
        if (content.links) content.links = content.links.map(link => ({ ...link, href: this.publicUrl(link.href) }))
        if (content.frames) content.frames = content.frames.map(frame => ({ ...frame, src: frame.src ? this.publicUrl(frame.src) : '' }))
        if (command.action.kind === 'wait' && content.ok) content.waitedMs = Math.round(performance.now() - started)
        result = content
      } else if (command.type === 'inspect') result = command.action.kind === 'evaluate' ? await runEvaluation(page, selected, command.action, () => Boolean(session.dialogs.forPage(page))) : await runInspectAction({ console: session.console, network: session.network }, selected, command.action)
      else throw new Error('Эта команда не поддерживает frame')
      return { ...result, page: { url: this.publicUrl(page.url()), title: await session.dialogs.title(page) }, frame: { path: framePath(command.frame), url: this.publicUrl(selected.url()), title: await session.dialogs.title(page, selected), ...(selected.isDetached() ? { detached: true } : {}) } }
    }
    if (command.type === 'navigate') await session.downloads.navigate(page, () => page.goto(applyHostAlias(validatePublicUrl(command.url, this.allowedTargets), this.hostAliases).toString(), NAVIGATION_OPTIONS))
    else if (command.type === 'back') await session.downloads.navigate(page, () => page.goBack(NAVIGATION_OPTIONS))
    else if (command.type === 'forward') await session.downloads.navigate(page, () => page.goForward(NAVIGATION_OPTIONS))
    else if (command.type === 'reload') await session.downloads.navigate(page, () => page.reload(NAVIGATION_OPTIONS))
    else if (command.type === 'stop') await page.evaluate('window.stop()')
    else if (command.type === 'resize') {
      session.viewport = { ...session.viewport, ...command.viewport }
      await Promise.all([...session.pages.values()].map((item) => item.setViewportSize(session.viewport)))
    } else if (command.type === 'input') {
      await runBrowserInput(page, command.action)
    } else if (command.type === 'selector') {
      const result = command.action.kind === 'describe' ? await describeFramePoint(page, command.action.x, command.action.y) : await runSelectorAction(page, command.action, raw => this.publicUrl(raw))
      if (result.links) result.links = result.links.map(link => ({ ...link, href: this.publicUrl(link.href) }))
      if (result.frames) result.frames = result.frames.map(frame => ({ ...frame, src: frame.src ? this.publicUrl(frame.src) : '' }))
      return { ...result, page: { url: this.publicUrl(page.url()), title: await session.dialogs.title(page) } }
    } else if (command.type === 'inspect') {
      const result = command.action.kind === 'evaluate' ? await runEvaluation(page, page.mainFrame(), command.action, () => Boolean(session.dialogs.forPage(page))) : await runInspectAction({ console: session.console, network: session.network }, page, command.action)
      if (result.page) result.page.url = this.publicUrl(result.page.url)
      return result
    } else if (command.type === 'screenshot') {
      return capturePage(page, command, (raw) => this.publicUrl(raw))
    }
    return await this.metadata(session)
  }

  /**
   * Адрес наружу: алиас оператора разворачивается обратно. Иначе внутреннее имя
   * сети compose уезжает в панель и в `startUrl` записанного сценария, а такой
   * сценарий не открывается нигде, кроме этого же контейнера.
   */
  private publicUrl(raw: string): string {
    try {
      const url = new URL(raw), target = url.searchParams.get('url')
      const address = url.hostname.toLowerCase() + ':' + (url.port || (url.protocol === 'https:' ? '443' : '80'))
      // Модель получает адрес проекта, а не техническую обёртку его доставки.
      if (address === this.previewOrigin && url.pathname === '/api/preview' && target) {
        const logical = new URL(target)
        if (logical.protocol === 'http:' || logical.protocol === 'https:') {
          if (url.hash) logical.hash = url.hash
          return logical.toString()
        }
      }
      return restoreHostAlias(url, this.hostAliases).toString()
    } catch { return raw }
  }

  private hostOf(raw: string): string {
    try { return new URL(raw).host } catch { return '' }
  }

  count(): number { return this.sessions.size }

  async close(): Promise<void> {
    this.closing = true
    const results = await Promise.allSettled([...this.sessions.keys()].map((id) => this.stop(id)).concat([...this.stopping.values()]))
    const failed = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failed.length) throw new AggregateError(failed.map(result => result.reason), 'Не все Chromium-сессии закрылись')
  }

  private async require(id: string): Promise<Session> {
    if (this.stopping.has(id)) throw new Error('not_ready')
    const session = await this.sessions.get(id)
    if (this.stopping.has(id)) throw new Error('not_ready')
    if (!session) throw new Error('not_found')
    return session
  }

  /**
   * Заголовки читаются у страницы, а не подставляются литералами: до этого
   * `title` был жёстко `null`, поэтому поле заголовка в панели всегда пустовало,
   * а модель заголовка не видела. `page.title()` асинхронен и на закрывающейся
   * вкладке бросает — отсюда `catch`, а не жёсткий отказ всей команды.
   */
  private async metadata(session: Session): Promise<BrowserSessionMetadata> {
    session.lastUsedAt = Date.now()
    const tabs: BrowserTab[] = await Promise.all([...session.pages].map(async ([id, page]) => ({
      id, url: this.publicUrl(page.url()), title: await session.dialogs.title(page), active: id === session.activeTabId,
      ...(session.openerIds.get(id) ? { openerTabId: session.openerIds.get(id) } : {}),
      ...(session.dialogs.forPage(page) ? { dialogId: session.dialogs.forPage(page)!.id } : {})
    })))
    const active = tabs.find((tab) => tab.active)
    const activePage = session.pages.get(session.activeTabId)
    const rawActive = activePage?.url() ?? ''
    const aliasedHost = rawActive && this.publicUrl(rawActive) !== rawActive ? this.hostOf(rawActive) : ''
    return {
      id: session.id,
      profileMode: session.profileMode,
      downloads: browserDownloadList(session.downloads.list()).downloads,
      downloadCount: session.downloads.list().length,
      dialogs: boundedBrowserDialogs(session.dialogs.list(), session.activeTabId).dialogs,
      dialogCount: session.dialogs.list().length,
      conversationId: session.conversationKey,
      incarnation: session.incarnation,
      state: 'ready',
      control: session.queue.owner, queuedCommands: session.queue.size,
      activeTabId: session.activeTabId,
      tabs,
      viewport: session.viewport,
      currentUrl: active?.url ?? null,
      title: active?.title || null,
      ...(session.lastActor ? { lastActor: session.lastActor } : {}),
      ...(aliasedHost ? { aliasedHost } : {})
    }
  }
}
