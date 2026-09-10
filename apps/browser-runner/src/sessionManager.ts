import { normalizeBrowserProfileMode, type BrowserProfileMode, type BrowserSiteDataResetResult } from '@voicechat/shared'
import { clearSiteData, httpOrigin } from './siteData.js'
import { readReaderProfile, writeReaderProfile } from './profileState.js'
import { resolveFrame, framePage, listFrames, framePath } from './frames.js'
import { describeFramePoint } from './frameDescription.js'
import { captureFrame } from './frameCapture.js'
import { mkdir, rm } from 'node:fs/promises'
import { lookup } from 'node:dns/promises'
import { randomUUID } from 'node:crypto'
import { chromium, type BrowserContext, type Locator, type Page } from 'playwright'
import type { BrowserCommandRequest, BrowserFramesResult, BrowserConsoleEntry, BrowserInspectResult, BrowserNetworkEntry, BrowserSelectorResult, BrowserSessionMetadata, BrowserTab, BrowserViewport } from '@voicechat/shared'
import { aliasTargets, applyHostAlias, browserTarget, isBlockedAddress, profilePath, restoreHostAlias, validatePublicUrl, type HostAliases } from './security.js'
import { runSelectorAction } from './selectorActions.js'
import { runInspectAction } from './inspectActions.js'
import { capturePage, type BrowserCapture } from './screenshots.js'

interface Session {
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

/** Держим последние записи: журнал живой страницы иначе растёт без предела. */
const LOG_LIMIT = 500
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
    previewOrigin: string | null = null
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
    const context = await chromium.launchPersistentContext(path, {
      headless: true,
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: viewport.deviceScaleFactor,
      acceptDownloads: false,
      permissions: [],
      serviceWorkers: 'allow'
    })
    try {
      const session: Session = {
        id: request.sessionId,
        userKey: request.userKey,
        conversationKey: request.conversationKey,
        incarnation: randomUUID(),
        context,
        pages: new Map(),
        pageIds: new WeakMap(),
        openerIds: new Map(),
        console: [],
        network: [],
        activeTabId: '',
        viewport,
        profileDir: path, profileMode,
        origins: new Set(saved?.origins ?? []), bootstrapCookies: [],
        lastUsedAt: Date.now()
      }
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
        page.on('close', () => {
          session.pages.delete(id)
          session.activeTabId = nextActiveTab([...session.pages.keys()], session.activeTabId, id, session.openerIds.get(id))
          session.openerIds.delete(id)
        })
        page.on('framenavigated', frame => { const origin = httpOrigin(frame.url()); if (origin) session.origins.add(origin) })
        page.on('popup', (popup) => session.openerIds.set(register(popup), id))
        // Журналы собираются с момента открытия страницы: спросить их задним
        // числом нельзя, а этапу автотестов нужны именно они.
        page.on('console', (message) => {
          session.console.push({ level: message.type(), text: message.text().slice(0, 2000), at: Date.now() })
          if (session.console.length > LOG_LIMIT) session.console.splice(0, session.console.length - LOG_LIMIT)
        })
        page.on('response', (response) => {
          session.network.push({
            method: response.request().method(), url: response.url().slice(0, 500),
            status: response.status(), ok: response.ok(), at: Date.now()
          })
          if (session.network.length > LOG_LIMIT) session.network.splice(0, session.network.length - LOG_LIMIT)
        })
        page.on('pageerror', (err) => {
          session.console.push({ level: 'error', text: String(err.message).slice(0, 2000), at: Date.now() })
          if (session.console.length > LOG_LIMIT) session.console.splice(0, session.console.length - LOG_LIMIT)
        })
        return id
      }
      for (const page of context.pages()) register(page)
      const initial = context.pages()[0] ?? await context.newPage()
      session.activeTabId = register(initial)
      context.on('page', (page) => register(page))
      const entry = this.sessions.get(request.sessionId)
      context.on('close', () => { if (this.sessions.get(request.sessionId) === entry) this.sessions.delete(request.sessionId) })
      if (saved?.cookies.length) await context.addCookies(saved.cookies).catch(() => undefined)
      await this.applyCookies(session, request.cookies)
      if (saved?.url && saved.url !== 'about:blank') {
        try { await initial.goto(applyHostAlias(validatePublicUrl(saved.url, this.allowedTargets), this.hostAliases).toString(), { ...NAVIGATION_OPTIONS, timeout: 10000 }) }
        catch (error) { session.console.push({ level: 'warning', text: `Последняя страница не восстановлена: ${error instanceof Error ? error.message.split('\n')[0] : 'ошибка перехода'}`, at: Date.now() }) }
      }
      return session
    } catch (error) {
      await context.close().catch(() => undefined)
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
      let saveError: unknown
      if (session.profileMode === 'persistent') {
        try { await writeReaderProfile(session.profileDir, { cookies: await session.context.cookies(), origins: [...session.origins], viewport: session.viewport, url: this.publicUrl(session.pages.get(session.activeTabId)?.url() ?? 'about:blank') }) }
        catch (error) { saveError = error }
      }
      await session.context.close()
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

  async command(sessionId: string, request: BrowserCommandRequest): Promise<BrowserSessionMetadata | BrowserCapture | BrowserSelectorResult | BrowserInspectResult | BrowserFramesResult | BrowserSiteDataResetResult> {
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
    if (command.type !== 'screenshot') session.lastActor = request.actor
    // Управление вкладками не требует существования прежней активной страницы:
    // после закрытия последней пользователь всё ещё должен суметь открыть новую.
    if (command.type === 'newTab') {
      const url = command.url ? applyHostAlias(validatePublicUrl(command.url, this.allowedTargets), this.hostAliases).toString() : null
      const created = await session.context.newPage()
      // Размер контекста остался исходным после resize существующих страниц.
      await created.setViewportSize(session.viewport)
      const id = session.pageIds.get(created) ?? randomUUID()
      session.pageIds.set(created, id); session.pages.set(id, created); session.activeTabId = id
      if (url) await created.goto(url, NAVIGATION_OPTIONS)
      return this.metadata(session)
    }
    if (command.type === 'selectTab' || command.type === 'closeTab') {
      const target = session.pages.get(command.tabId)
      if (!target || target.isClosed()) throw new Error('stale_tab')
      if (command.type === 'selectTab') session.activeTabId = command.tabId
      else await target.close()
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
        await selected.goto(applyHostAlias(validatePublicUrl(command.url, this.allowedTargets), this.hostAliases).toString(), { ...NAVIGATION_OPTIONS, timeout: Math.max(1, deadline - performance.now()) })
        result = { ok: true }
      } else if (command.type === 'selector') {
        if (command.action.kind === 'describe') throw new Error('describe использует координаты всей страницы и автоматически определяет frame')
        const action = command.action.kind === 'wait' ? { ...command.action, timeoutMs: Math.max(1, Math.floor(deadline - performance.now())) } : command.action
        const content = await runSelectorAction(framePage(page, selected), action, raw => this.publicUrl(raw))
        if (content.links) content.links = content.links.map(link => ({ ...link, href: this.publicUrl(link.href) }))
        if (content.frames) content.frames = content.frames.map(frame => ({ ...frame, src: frame.src ? this.publicUrl(frame.src) : '' }))
        if (command.action.kind === 'wait' && content.ok) content.waitedMs = Math.round(performance.now() - started)
        result = content
      } else if (command.type === 'inspect') result = await runInspectAction({ console: session.console, network: session.network }, selected, command.action)
      else throw new Error('Эта команда не поддерживает frame')
      return { ...result, page: { url: this.publicUrl(page.url()), title: await page.title().catch(() => '') }, frame: { path: framePath(command.frame), url: this.publicUrl(selected.url()), title: await selected.title().catch(() => ''), ...(selected.isDetached() ? { detached: true } : {}) } }
    }
    if (command.type === 'navigate') await page.goto(applyHostAlias(validatePublicUrl(command.url, this.allowedTargets), this.hostAliases).toString(), NAVIGATION_OPTIONS)
    else if (command.type === 'back') await page.goBack(NAVIGATION_OPTIONS)
    else if (command.type === 'forward') await page.goForward(NAVIGATION_OPTIONS)
    else if (command.type === 'reload') await page.reload(NAVIGATION_OPTIONS)
    else if (command.type === 'stop') await page.evaluate('window.stop()')
    else if (command.type === 'resize') {
      session.viewport = { ...session.viewport, ...command.viewport }
      await Promise.all([...session.pages.values()].map((item) => item.setViewportSize(session.viewport)))
    } else if (command.type === 'input') {
      const action = command.action
      if (action.type === 'mouseMove') await page.mouse.move(action.x, action.y)
      else if (action.type === 'mouseDown') await page.mouse.down({ button: action.button })
      else if (action.type === 'mouseUp') await page.mouse.up({ button: action.button })
      else if (action.type === 'click') await page.mouse.click(action.x, action.y, { button: action.button, clickCount: action.clickCount })
      else if (action.type === 'wheel') await page.mouse.wheel(action.deltaX, action.deltaY)
      else if (action.type === 'drag') {
        await page.mouse.move(action.from.x, action.from.y)
        await page.mouse.down()
        try { await page.mouse.move(action.to.x, action.to.y, { steps: 10 }) }
        finally { await page.mouse.up() }
      }
      else if (action.type === 'type') await page.keyboard.type(action.text)
      else if (action.type === 'press') await page.keyboard.press(action.key)
      else if (action.type === 'keyDown') await page.keyboard.down(action.key)
      else await page.keyboard.up(action.key)
    } else if (command.type === 'selector') {
      const result = command.action.kind === 'describe' ? await describeFramePoint(page, command.action.x, command.action.y) : await runSelectorAction(page, command.action, raw => this.publicUrl(raw))
      if (result.links) result.links = result.links.map(link => ({ ...link, href: this.publicUrl(link.href) }))
      if (result.frames) result.frames = result.frames.map(frame => ({ ...frame, src: frame.src ? this.publicUrl(frame.src) : '' }))
      return { ...result, page: { url: this.publicUrl(page.url()), title: await page.title().catch(() => '') } }
    } else if (command.type === 'inspect') {
      return runInspectAction({ console: session.console, network: session.network }, page, command.action)
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
    try { return restoreHostAlias(new URL(raw), this.hostAliases).toString() } catch { return raw }
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
      id, url: this.publicUrl(page.url()), title: await page.title().catch(() => ''), active: id === session.activeTabId,
      ...(session.openerIds.get(id) ? { openerTabId: session.openerIds.get(id) } : {})
    })))
    const active = tabs.find((tab) => tab.active)
    const activePage = session.pages.get(session.activeTabId)
    const rawActive = activePage?.url() ?? ''
    const aliasedHost = rawActive && this.publicUrl(rawActive) !== rawActive ? this.hostOf(rawActive) : ''
    return {
      id: session.id,
      profileMode: session.profileMode,
      conversationId: session.conversationKey,
      incarnation: session.incarnation,
      state: 'ready',
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
