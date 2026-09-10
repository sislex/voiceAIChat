// Сборка Web Reader: прокси превью `/api/preview*` (сайты и dev-серверы машин через компаньон-агента) и
// MCP «browser» `/mcp/preview` (инструменты `mcp__browser__*`: панель пользователя или изолированный
// Chromium). Раньше всё это собиралось прямо в `buildServer`; теперь зависимости от ядра перечислены явно
// в `ReaderDeps` — состояние процесса ядра только через порт `ReaderCore`, остальное (база,
// машины) отдельный процесс ридера поднимает сам. Chromium — через PlaywrightReaderService.
import type { FastifyInstance } from 'fastify'
import { parseHostAliases } from '@voicechat/browser-runner/security'
import { evaluateCommandLayers } from '@voicechat/shared'
import type { VoiceChatDb } from '../db/database.js'
import type { MachinesService } from '../machines/service.js'
import type { PlaywrightReaderService } from '@voicechat/playwright-reader'
import { registerPreviewProxy } from '../routes/previewProxy.js'
import { registerPreviewMcp, type PreviewTurnContext } from '../mcp/previewMcp.js'
import { PreviewCookieStore } from '../routes/previewCookies.js'
import type { ReaderCore } from './core.js'

/**
 * Всё, что ридер берёт у ядра. Состояние процесса ядра — портом `core`; остальное — клиенты и настройки,
 * которые отдельный процесс поднимет из своего env. Снимок ключей — в `boundary.test.ts`.
 */
export interface ReaderDeps {
  app: FastifyInstance
  db: VoiceChatDb
  core: ReaderCore
  /** Машины для тестовых окружений `<agentId>.machine.internal`: онлайн и HTTP через компаньон-агента. */
  machines: Pick<MachinesService, 'isOnline' | 'http'>
  /** Секрет MCP-эндпоинта `/mcp/preview` (им же подписаны токены ходов). */
  mcpSecret: string
  /** Изолированный Chromium живёт в приложении Playwright Reader. */
  browser: PlaywrightReaderService
  /** Таймаут ожидания панели (тесты). */
  actionTimeoutMs?: number
}

export function createReaderModule(deps: ReaderDeps): void {
  const { app, db, core, browser } = deps

  const cookies = new PreviewCookieStore()
  registerPreviewProxy(app, {
    cookies,
    projectResource: (request) => core.projectResource(request),
    hostAliases: parseHostAliases(process.env.VC_BROWSER_HOST_ALIASES),
    machines: {
      bridge: deps.machines,
      canUse: async (userId, agentId) => await db.machines.canUseAgentForPreview(userId, agentId)
    }
  })

  const context: PreviewTurnContext = {
    // Машина алиаса machine.internal: execTarget разговора (agentId) с гейтом доступа.
    machineOf: async ({ userId, conversationId }) => {
      const conversation = await db.chat.getConversation(userId, conversationId)
      const target = conversation?.execTarget
      if (!target || target === 'none' || target === 'server') return null
      return await db.machines.canUseAgentForPreview(userId, target) || await db.machines.canUseAgent(userId, target, conversation?.projectId ?? null) ? target : null
    },
    testUsersOf: async ({ userId, conversationId }) => {
      const projectId = (await db.chat.getConversation(userId, conversationId))?.projectId
      if (!projectId) return []
      return (await db.projects.getProject(userId, projectId))?.testUsers ?? []
    },
    environmentsOf: async ({ userId, conversationId }) => {
      const projectId = (await db.chat.getConversation(userId, conversationId))?.projectId
      if (!projectId || !await db.projects.getProject(userId, projectId)) return []
      const toMachineUrl = (agentId: string, raw: string | null): string | null => {
        if (!raw) return null
        try {
          const url = new URL(raw)
          url.hostname = agentId + '.machine.internal'
          return url.toString()
        } catch { return null }
      }
      // Превью живут у канбана: список идёт через порт ядра, а не по ссылке на менеджер.
      return (await core.listPreviews())
        .filter((env) => env.projectId === projectId)
        .map((env) => ({
          taskId: env.taskId,
          branch: env.branch,
          state: env.state,
          healthy: env.healthStatus === 'healthy',
          appUrl: toMachineUrl(env.agentId, env.appUrl),
          storybookUrl: toMachineUrl(env.agentId, env.storybookUrl)
        }))
    },
    clearCookies: ({ userId }, host) => cookies.clear(userId, host),
    gateEvaluate: async ({ userId, conversationId }, code, confirmed) => {
      const conversation = await db.chat.getConversation(userId, conversationId)
      const project = conversation?.projectId ? await db.projects.getProject(userId, conversation.projectId) : null
      const policy = project?.commandPolicy
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
