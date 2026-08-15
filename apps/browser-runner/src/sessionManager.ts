import { mkdir } from 'node:fs/promises'
import { lookup } from 'node:dns/promises'
import { randomUUID } from 'node:crypto'
import { chromium, type BrowserContext, type Page } from 'playwright'
import type { BrowserCommandRequest, BrowserSessionMetadata, BrowserTab, BrowserViewport } from '@voicechat/shared'
import { isBlockedAddress, profilePath, validatePublicUrl } from './security.js'

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
}

export interface StartSessionRequest {
  sessionId: string
  userKey: string
  conversationKey: string
  viewport?: BrowserViewport
}

export class BrowserSessionManager {
  private readonly sessions = new Map<string, Promise<Session>>()

  constructor(private readonly profilesRoot: string) {}

  async start(request: StartSessionRequest): Promise<BrowserSessionMetadata> {
    let pending = this.sessions.get(request.sessionId)
    if (!pending) {
      pending = this.create(request)
      this.sessions.set(request.sessionId, pending)
      pending.catch(() => this.sessions.delete(request.sessionId))
    }
    const session = await pending
    if (session.userKey !== request.userKey || session.conversationKey !== request.conversationKey) throw new Error('session identity mismatch')
    return this.metadata(session)
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
      activeTabId: '',
      viewport
    }
    await context.route('**/*', async (route) => {
      try {
        const url = validatePublicUrl(route.request().url())
        const addresses = await lookup(url.hostname, { all: true, verbatim: true })
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
    return true
  }

  async command(sessionId: string, request: BrowserCommandRequest): Promise<BrowserSessionMetadata | Buffer> {
    const session = await this.require(sessionId)
    if (request.incarnation !== session.incarnation) throw new Error('stale_incarnation')
    const tabId = request.tabId ?? session.activeTabId
    const page = session.pages.get(tabId)
    if (!page) throw new Error('stale_tab')
    const command = request.command
    if (command.type === 'navigate') await page.goto(validatePublicUrl(command.url).toString(), { waitUntil: 'domcontentloaded', timeout: 30_000 })
    else if (command.type === 'back') await page.goBack()
    else if (command.type === 'forward') await page.goForward()
    else if (command.type === 'reload') await page.reload()
    else if (command.type === 'stop') await page.evaluate('window.stop()')
    else if (command.type === 'newTab') {
      const created = await session.context.newPage()
      const id = session.pageIds.get(created) ?? randomUUID()
      session.pageIds.set(created, id); session.pages.set(id, created); session.activeTabId = id
      if (command.url) await created.goto(validatePublicUrl(command.url).toString())
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
    } else if (command.type === 'screenshot') {
      return page.screenshot({ type: command.format === 'jpeg' ? 'jpeg' : command.format === 'webp' ? 'webp' : 'png', fullPage: command.fullPage, quality: command.format === 'png' ? undefined : command.quality })
    }
    return this.metadata(session)
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

  private metadata(session: Session): BrowserSessionMetadata {
    const tabs: BrowserTab[] = [...session.pages].map(([id, page]) => ({ id, url: page.url(), title: '', active: id === session.activeTabId }))
    const active = session.pages.get(session.activeTabId)
    return {
      id: session.id,
      conversationId: session.conversationKey,
      incarnation: session.incarnation,
      state: 'ready',
      activeTabId: session.activeTabId,
      tabs,
      viewport: session.viewport,
      currentUrl: active?.url() ?? null,
      title: null
    }
  }
}
