import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { isPreviewAccessibilityResult, isPreviewProbeResult, machinePreviewUrl, planModelAction } from '@voicechat/shared'
import type { BrowserRunnerClient } from '@voicechat/browser-contracts/client'
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
    async control(userId, conversationId, command) {
      try {
        const active = await start(userId, conversationId)
        if (!active) return null
        const result = await runner!.command(active.target.sessionId, {
          requestId: randomUUID(), incarnation: active.session.incarnation, actor: 'assistant',
          command: command.type === 'newTab' && command.url
            ? { ...command, url: machinePreviewUrl(runnerFacingBase, command.url) } : command
        })
        if ('ok' in result && !result.ok) return { ok: false, error: result.error ?? 'Команда Chromium не выполнена' }
        return { ok: true, result }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Команда Chromium не выполнена' }
      }
    },
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
        if (action.kind === 'audit' && (!('audit' in result) || result.audit?.version !== 1 || result.audit.surface !== 'chromium')) return { ok: false, error: 'This browser runner does not support native audits. Update browser-runner and retry.' }
        if (action.kind === 'accessibility' && (!('accessibility' in result) || !isPreviewAccessibilityResult({ page: result.page, accessibility: result.accessibility }))) return { ok: false, error: 'This browser runner did not return native accessibility evidence. Update browser-runner and retry.' }
        if (action.kind === 'probe' && (!('probe' in result) || !isPreviewProbeResult({ page: result.page, probe: result.probe }) || result.probe?.surface !== 'chromium')) return { ok: false, error: 'This browser runner did not return a valid native control probe. Update browser-runner and retry.' }
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
          command: { type: 'screenshot', ...args, format: 'png', scale: 'css' }
        })
        await core.logBrowserShot(userId, conversationId, shot.buffer.toString('base64'))
        return {
          ok: true,
          result: {
            ...shot.metadata,
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
