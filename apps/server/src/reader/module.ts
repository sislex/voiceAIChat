// Сборка Web Reader: прокси превью `/api/preview*` (сайты и dev-серверы машин через компаньон-агента) и
// MCP «browser» `/mcp/preview` (инструменты `mcp__browser__*`: панель пользователя или изолированный
// Chromium). Раньше всё это собиралось прямо в `buildServer`; теперь зависимости от ядра перечислены явно
// в `ReaderDeps` — состояние процесса ядра только через порт `ReaderCore`, остальное (база, машины,
// browser-runner) отдельный процесс ридера поднимает сам (docs/plans/web-reader-service.md).
import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { DEFAULT_CI_BROWSER_CHECK, evaluateCommandLayers, isPlaywrightReaderConversation, planModelAction } from '@voicechat/shared'
import type { VoiceChatDb } from '../db/database.js'
import type { MachinesService } from '../machines/service.js'
import type { BrowserRunnerClient } from '../browser/runnerClient.js'
import { browserCheckTarget, withMachinePreviewTarget, type BrowserCheckTarget } from '../browser/checkTarget.js'
import { PREVIEW_RUN_COOKIE } from '../browser/machinePreview.js'
import { clearPreviewCookies, registerPreviewProxy } from '../routes/previewProxy.js'
import { registerPreviewMcp, type PreviewTurnContext } from '../mcp/previewMcp.js'
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
  /** Изолированный Chromium (Playwright Reader, браузерная проверка задач); без него — только панель пользователя. */
  browserRunner?: BrowserRunnerClient
  /** Адрес прокси превью глазами browser-runner: машины он открывает через `/api/preview`. */
  runnerFacingBase: string
  /** Таймаут ожидания панели (тесты). */
  actionTimeoutMs?: number
}

export function createReaderModule(deps: ReaderDeps): void {
  const { app, db, core, browserRunner, runnerFacingBase } = deps

  registerPreviewProxy(app, {
    machines: {
      bridge: deps.machines,
      canUse: async (userId, agentId) => await db.machines.canUseAgentForPreview(userId, agentId)
    }
  })

  // Ключ Chromium к прокси превью: реестр ключей — у авторизации ядра, cookie ставится на путь прокси.
  const previewRunCookie = async (userId: string): Promise<{ name: string; value: string; url: string }> =>
    ({ name: PREVIEW_RUN_COOKIE, value: await core.issuePreviewRunKey(userId), url: `${runnerFacingBase.replace(/\/+$/, '')}/api/preview` })

  /**
   * Изолированный Chromium обслуживает два входа: разговор Playwright Reader и браузерную проверку
   * задачи (её режим — настройка CI задачи). Всё остальное идёт прежним путём — в панель пользователя.
   */
  const browserCheckTargetOf = async (userId: string, conversationId: string): Promise<BrowserCheckTarget | null> => {
    const conversation = await db.chat.getConversation(userId, conversationId)
    if (!conversation) return null
    const taskId = conversation.taskId ?? null
    return browserCheckTarget({
      conversationId,
      taskId,
      playwrightReader: isPlaywrightReaderConversation(conversation),
      check: taskId ? await db.ci.getTaskBrowserCheck(taskId) : DEFAULT_CI_BROWSER_CHECK
    })
  }

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
    clearCookies: ({ userId }, host) => clearPreviewCookies(userId, host),
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
    // Разговоры Playwright Reader исполняются в изолированном Chromium сервера:
    // relay пушит действие в браузер пользователя, а страницы там нет.
    browserExecutor: async (userId, conversationId, action) => {
      if (!browserRunner) return null
      const target = await browserCheckTargetOf(userId, conversationId)
      if (!target) return null
      const plan = planModelAction(withMachinePreviewTarget(action, runnerFacingBase))
      if (plan.kind === 'unsupported') return { ok: false, error: plan.reason }
      try {
        // start идемпотентен: живая сессия переиспользуется, incarnation берём из неё.
        const session = await browserRunner.start({
          sessionId: target.sessionId, userKey: userId, conversationKey: target.conversationKey,
          cookies: [await previewRunCookie(userId)]
        })
        const result = await browserRunner.command(target.sessionId, {
          requestId: randomUUID(), incarnation: session.incarnation, actor: 'assistant', command: plan.command
        })
        return { ok: true, data: result as unknown as Record<string, unknown> }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Действие в Chromium не выполнено' }
      }
    },
    // Снимок из изолированного Chromium: отдельным входом, потому что он
    // возвращает картинку, а не структуру действия.
    browserScreenshot: async (userId, conversationId, args) => {
      if (!browserRunner) return null
      const target = await browserCheckTargetOf(userId, conversationId)
      if (!target) return null
      try {
        const session = await browserRunner.start({
          sessionId: target.sessionId, userKey: userId, conversationKey: target.conversationKey,
          cookies: [await previewRunCookie(userId)]
        })
        const shot = await browserRunner.screenshot(target.sessionId, {
          requestId: randomUUID(), incarnation: session.incarnation, actor: 'assistant',
          command: { type: 'screenshot', format: 'png', ...(args.selector ? { selector: args.selector } : {}) }
        })
        await core.logBrowserShot(userId, conversationId, shot.buffer.toString('base64'))
        return {
          ok: true,
          result: {
            page: { url: session.currentUrl ?? '', title: session.title ?? '' },
            rect: { x: 0, y: 0, width: session.viewport.width, height: session.viewport.height },
            dataUrl: `data:${shot.mimeType};base64,${shot.buffer.toString('base64')}`
          }
        }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Снимок в Chromium не сделан' }
      }
    },
    context
  })
}
