import type { FastifyInstance } from 'fastify'
import { parseHostAliases } from '@voicechat/browser-contracts/security'
import { evaluateCommandLayers } from '@voicechat/shared'
import type { PlaywrightReaderService } from '@voicechat/playwright-reader-contracts'
import { registerPreviewProxy } from './routes/previewProxy.js'
import { registerPreviewMcp, type PreviewTurnContext } from './mcp/previewMcp.js'
import { PreviewCookieStore } from './routes/previewCookies.js'
import type { ReaderCore } from '@voicechat/web-reader-contracts'

/**
 * Всё, что ридер берёт у ядра. Состояние процесса ядра — портом `core`; остальное — клиенты и настройки,
 * которые отдельный процесс поднимет из своего env. База и реестр машин остаются в ядре.
 */
export interface ReaderDeps {
  app: FastifyInstance
  core: ReaderCore
  /** Секрет MCP-эндпоинта `/mcp/preview` (им же подписаны токены ходов). */
  mcpSecret: string
  /** Изолированный Chromium живёт в приложении Playwright Reader. */
  browser: PlaywrightReaderService
  /** Таймаут ожидания панели (тесты). */
  actionTimeoutMs?: number
}

export function createReaderModule(deps: ReaderDeps): void {
  const { app, core, browser } = deps

  const cookies = new PreviewCookieStore()
  registerPreviewProxy(app, {
    cookies,
    projectResource: (request) => core.projectResource(request),
    hostAliases: parseHostAliases(process.env.VC_BROWSER_HOST_ALIASES),
    machines: {
      bridge: { isOnline: (agentId) => core.machineOnline(agentId), http: (agentId, request, userId) => core.machineHttp(userId, agentId, request) },
      canUse: async (userId, agentId) => await core.canUseMachine(userId, agentId)
    }
  })

  const context: PreviewTurnContext = {
    machineOf: async (entry) => (await core.context(entry))?.machineId ?? null,
    testUsersOf: async (entry) => (await core.context(entry))?.testUsers ?? [],
    environmentsOf: async (entry) => (await core.context(entry))?.environments ?? [],
    clearCookies: ({ userId }, host) => cookies.clear(userId, host),
    gateEvaluate: async ({ userId, conversationId }, code, confirmed) => {
      const context = await core.context({ userId, conversationId })
      if (!context) return { allowed: false, reason: 'Разговор недоступен этому пользователю.' }
      const policy = context.commandPolicy
      if (policy) {
        const verdict = evaluateCommandLayers(code, [{ ...policy, name: 'project' }])
        if (!verdict.allowed) return verdict
      }
      const mutating = /(?:\.remove\s*\(|\.delete\s*\(|\.setItem\s*\(|\.clear\s*\(|document\.(?:write|cookie)\s*=|innerHTML\s*=|outerHTML\s*=|fetch\s*\(|XMLHttpRequest|location\s*=)/i.test(code)
      if (mutating && policy?.confirmDangerous !== false && !confirmed) {
        return { allowed: false, needsConfirmation: true, reason: 'Код изменяет DOM/хранилище либо выполняет сетевой запрос; спроси пользователя и повтори с confirm=true.' }
      }
      return { allowed: true }
    }
  }

  registerPreviewMcp(app, {
    secret: deps.mcpSecret,
    // Действие в панели пользователя: сокеты живут у ядра — через порт.
    relay: { request: (userId, conversationId, action, timeoutMs) => core.previewAction(userId, conversationId, action, timeoutMs) },
    ...(deps.actionTimeoutMs ? { timeoutMs: deps.actionTimeoutMs } : {}),
    browserExecutor: (...args) => browser.execute(...args),
    browserControl: (...args) => browser.control(...args),
    browserScreenshot: (...args) => browser.screenshot(...args),
    context
  })
}
