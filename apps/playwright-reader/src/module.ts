import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { machinePreviewUrl, planModelAction } from '@voicechat/shared'
import type { BrowserRunnerClient } from '@voicechat/browser-runner/client'
import type { PlaywrightReaderCore } from './core.js'
import type { PlaywrightReaderService } from './service.js'
import { registerBrowserRoutes } from './routes.js'
import { previewSessionCookies } from './sessionAccess.js'

export interface PlaywrightReaderOptions {
  core: PlaywrightReaderCore
  runner?: BrowserRunnerClient
  /** Прокси ядра или Web Reader глазами Chromium, совпадает с разрешённым origin раннера. */
  runnerFacingBase: string
}

export function createPlaywrightReaderModule({ core, runner, runnerFacingBase }: PlaywrightReaderOptions): {
  service: PlaywrightReaderService
  register(app: FastifyInstance): void
} {
  const start = async (userId: string, conversationId: string) => {
    const target = await core.modelTarget(userId, conversationId)
    if (!target) return null
    if (!runner) throw new Error('Browser Runner не настроен на этом сервере')
    const session = await runner.start({
      ...target, userKey: userId,
      cookies: await previewSessionCookies(core, userId, runnerFacingBase)
    })
    return { target, session }
  }
  const service: PlaywrightReaderService = {
    async execute(userId, conversationId, action) {
      try {
        const active = await start(userId, conversationId)
        if (!active) return null
        const plan = planModelAction(action.kind === 'open' ? { ...action, url: machinePreviewUrl(runnerFacingBase, action.url) } : action)
        if (plan.kind === 'unsupported') return { ok: false, error: plan.reason }
        const result = await runner!.command(active.target.sessionId, {
          requestId: randomUUID(), incarnation: active.session.incarnation, actor: 'assistant', command: plan.command
        })
        // Селекторные ошибки приходят значением. Их нельзя превращать в успешный ответ MCP.
        if ('ok' in result && !result.ok) return { ok: false, error: result.error ?? 'Действие в Chromium не выполнено' }
        return { ok: true, result }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Действие в Chromium не выполнено' }
      }
    },
    async screenshot(userId, conversationId, args) {
      try {
        const active = await start(userId, conversationId)
        if (!active) return null
        const { target, session } = active
        const shot = await runner!.screenshot(target.sessionId, {
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
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Снимок в Chromium не сделан' }
      }
    }
  }
  return { service, register: (app) => registerBrowserRoutes(app, { core, runner, runnerFacingBase }) }
}
