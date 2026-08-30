import { mkdir, rm } from 'node:fs/promises'
import { lookup } from 'node:dns/promises'
import { randomUUID } from 'node:crypto'
import { chromium, type BrowserContext, type Locator, type Page } from 'playwright'
import type { BrowserCommandRequest, BrowserConsoleEntry, BrowserInspectResult, BrowserNetworkEntry, BrowserSelectorResult, BrowserSessionMetadata, BrowserTab, BrowserViewport } from '@voicechat/shared'
import { aliasTargets, applyHostAlias, isBlockedAddress, profilePath, restoreHostAlias, validatePublicUrl, type HostAliases } from './security.js'
import { runSelectorAction } from './selectorActions.js'
import { runInspectAction } from './inspectActions.js'

interface Session {
  id: string
  userKey: string
  conversationKey: string
  incarnation: string
  context: BrowserContext
  pages: Map<string, Page>
  pageIds: WeakMap<Page, string>
  activeTabId: string
  viewport: BrowserViewport
  /** Кольцевые журналы страницы: без них модели нечем проверять поведение. */
  console: BrowserConsoleEntry[]
  network: BrowserNetworkEntry[]
  /** Каталог профиля: после остановки его надо удалить, иначе том растёт. */
  profileDir: string
  /** Последнее обращение — по нему сборщик находит брошенные сессии. */
  lastUsedAt: number
  /** Кто выполнял последнюю команду: человек из панели или модель. */
  lastActor?: 'user' | 'assistant'
}

/** Держим последние записи: журнал живой страницы иначе растёт без предела. */
const LOG_LIMIT = 500

export interface StartSessionRequest {
  sessionId: string
  userKey: string
  conversationKey: string
  viewport?: BrowserViewport
}

export class BrowserSessionManager {
  private readonly sessions = new Map<string, Promise<Session>>()

  private readonly allowedTargets: Set<string>

  constructor(private readonly profilesRoot: string, private readonly hostAliases: HostAliases = new Map()) {
    this.allowedTargets = aliasTargets(hostAliases)
  }

  async start(request: StartSessionRequest): Promise<BrowserSessionMetadata> {
    let pending = this.sessions.get(request.sessionId)
    if (!pending) {
      pending = this.create(request)
      this.sessions.set(request.sessionId, pending)
      pending.catch(() => this.sessions.delete(request.sessionId))
    }
    const session = await pending
    if (session.userKey !== request.userKey || session.conversationKey !== request.conversationKey) throw new Error('session identity mismatch')
    return await this.metadata(session)
  }

  private async create(request: StartSessionRequest): Promise<Session> {
    const viewport = request.viewport ?? { width: 1280, height: 800, deviceScaleFactor: 1 }
    const path = profilePath(this.profilesRoot, request.userKey, request.conversationKey)
    await mkdir(path, { recursive: true, mode: 0o700 })
    const context = await chromium.launchPersistentContext(path, {
      headless: true,
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: viewport.deviceScaleFactor,
      acceptDownloads: false,
      permissions: [],
      serviceWorkers: 'allow'
    })
    const session: Session = {
      id: request.sessionId,
      userKey: request.userKey,
      conversationKey: request.conversationKey,
      incarnation: randomUUID(),
      context,
      pages: new Map(),
      pageIds: new WeakMap(),
      console: [],
      network: [],
      activeTabId: '',
      viewport,
      profileDir: path,
      lastUsedAt: Date.now()
    }
    await context.route('**/*', async (route) => {
      try {
        const requested = validatePublicUrl(route.request().url())
        // Алиас применяется после проверки: во внутреннюю сеть пускает оператор
        // списком пар, а не пользователь адресом.
        const aliased = applyHostAlias(requested, this.hostAliases)
        // Цель алиаса разрешена явно: её назвал оператор, а не пользователь
        // адресом. Проверку приватных сетей для остальных адресов не трогаем.
        const port = aliased.port || (aliased.protocol === 'https:' ? '443' : '80')
        if (this.allowedTargets.has(`${aliased.hostname.toLowerCase()}:${port}`) || this.allowedTargets.has(aliased.hostname.toLowerCase())) {
          return aliased.toString() === requested.toString() ? route.continue() : route.continue({ url: aliased.toString() })
        }
        // Несуществующий домен и запрещённый политикой — разные беды, и раньше
        // обе давали ERR_BLOCKED_BY_CLIENT: человек думал, что его адрес в
        // чёрном списке, хотя тот просто не резолвится.
        let addresses
        try { addresses = await lookup(aliased.hostname, { all: true, verbatim: true }) }
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
      page.on('close', () => session.pages.delete(id))
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
    context.on('close', () => this.sessions.delete(request.sessionId))
    return session
  }

  async stop(sessionId: string): Promise<boolean> {
    const pending = this.sessions.get(sessionId)
    if (!pending) return false
    this.sessions.delete(sessionId)
    const session = await pending
    await session.context.close()
    // Каталог профиля детерминирован от пары ключей, а у QA-рана вторым ключом
    // идёт id прогона — значит, каждый прогон оставлял бы свой каталог навсегда.
    await rm(session.profileDir, { recursive: true, force: true }).catch(() => undefined)
    return true
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

  async command(sessionId: string, request: BrowserCommandRequest): Promise<BrowserSessionMetadata | Buffer | BrowserSelectorResult | BrowserInspectResult> {
    const session = await this.require(sessionId)
    if (request.incarnation !== session.incarnation) throw new Error('stale_incarnation')
    session.lastActor = request.actor
    // Отметка обращения ставится здесь, а не в `metadata`: селекторные команды,
    // разбор журналов и снимок экрана возвращаются раньше метаданных, а именно
    // из них состоит прогон сценария. Сборщик считал такую сессию брошенной и
    // закрывал Chromium посреди работы.
    session.lastUsedAt = Date.now()
    const tabId = request.tabId ?? session.activeTabId
    const page = session.pages.get(tabId)
    if (!page) throw new Error('stale_tab')
    const command = request.command
    if (command.type === 'navigate') await page.goto(applyHostAlias(validatePublicUrl(command.url), this.hostAliases).toString(), { waitUntil: 'domcontentloaded', timeout: 30_000 })
    else if (command.type === 'back') await page.goBack()
    else if (command.type === 'forward') await page.goForward()
    else if (command.type === 'reload') await page.reload()
    else if (command.type === 'stop') await page.evaluate('window.stop()')
    else if (command.type === 'newTab') {
      const created = await session.context.newPage()
      const id = session.pageIds.get(created) ?? randomUUID()
      session.pageIds.set(created, id); session.pages.set(id, created); session.activeTabId = id
      // Тот же путь, что у navigate: без подстановки алиаса новая вкладка шла
      // на внешний адрес, до которого контейнер не достаёт, и держалась на нём
      // только благодаря перехватчику маршрутов — то есть по случайности.
      if (command.url) await created.goto(applyHostAlias(validatePublicUrl(command.url), this.hostAliases).toString())
    } else if (command.type === 'selectTab') session.activeTabId = command.tabId
    else if (command.type === 'closeTab') await session.pages.get(command.tabId)?.close()
    else if (command.type === 'resize') {
      session.viewport = command.viewport
      await Promise.all([...session.pages.values()].map((item) => item.setViewportSize(command.viewport)))
    } else if (command.type === 'input') {
      const action = command.action
      if (action.type === 'mouseMove') await page.mouse.move(action.x, action.y)
      else if (action.type === 'mouseDown') await page.mouse.down({ button: action.button })
      else if (action.type === 'mouseUp') await page.mouse.up({ button: action.button })
      else if (action.type === 'click') await page.mouse.click(action.x, action.y, { button: action.button, clickCount: action.clickCount })
      else if (action.type === 'wheel') await page.mouse.wheel(action.deltaX, action.deltaY)
      else if (action.type === 'type') await page.keyboard.type(action.text)
      else if (action.type === 'press') await page.keyboard.press(action.key)
      else if (action.type === 'keyDown') await page.keyboard.down(action.key)
      else await page.keyboard.up(action.key)
    } else if (command.type === 'selector') {
      return runSelectorAction(page, command.action)
    } else if (command.type === 'inspect') {
      return runInspectAction({ console: session.console, network: session.network }, page, command.action)
    } else if (command.type === 'screenshot') {
      const options = { type: command.format === 'jpeg' ? 'jpeg' as const : command.format === 'webp' ? 'webp' as const : 'png' as const, quality: command.format === 'png' ? undefined : command.quality }
      // Снимок узла: раньше на запрос по селектору отдавался весь вьюпорт с
      // оговоркой в тексте — у Playwright для этого есть locator.screenshot().
      if (command.selector) return page.locator(command.selector).first().screenshot({ ...options, timeout: 10_000 })
      return page.screenshot({ ...options, fullPage: command.fullPage })
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
    await Promise.all([...this.sessions.keys()].map((id) => this.stop(id)))
  }

  private async require(id: string): Promise<Session> {
    const session = await this.sessions.get(id)
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
      id, url: this.publicUrl(page.url()), title: await page.title().catch(() => ''), active: id === session.activeTabId
    })))
    const active = tabs.find((tab) => tab.active)
    const activePage = session.pages.get(session.activeTabId)
    const rawActive = activePage?.url() ?? ''
    const aliasedHost = rawActive && this.publicUrl(rawActive) !== rawActive ? this.hostOf(rawActive) : ''
    return {
      id: session.id,
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
