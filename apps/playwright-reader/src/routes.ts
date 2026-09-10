// REST-оркестрация Playwright Reader: сервер держит изолированную Chromium-сессию
// разговора в browser-runner. Доступ строго свой — сессия привязана к разговору
// (владение проверяется по БД), и только при выбранном движке Chromium.
// Ключи изоляции раннера: sessionId = conversationId, userKey = uid.
//
// Без сконфигурированного раннера роуты отвечают 501 — UI показывает «Chromium
// недоступен» той же деградацией, что и при выключенной capability.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  isChromiumReaderConversation, isBrowserSessionMetadata,
  BROWSER_COMMAND_BODY_LIMIT,
  machinePreviewUrl,
  type BrowserCommand,
  type BrowserScreenshotOptions,
  type BrowserViewport
} from '@voicechat/shared'
import { randomUUID } from 'node:crypto'
import type { PlaywrightReaderCore } from './core.js'
import { BrowserRunnerError, type BrowserRunnerClient } from '@voicechat/browser-contracts/client'
import { previewSessionCookies } from './sessionAccess.js'

const uid = (req: FastifyRequest): string => (req as unknown as { user: { name: string } }).user.name

export interface BrowserRoutesDeps {
  core: PlaywrightReaderCore
  runner?: BrowserRunnerClient
  runnerFacingBase: string
}

/** Разумные границы вьюпорта: панель не должна просить у Chromium гигантский кадр. */
function normalizeViewport(value: unknown): BrowserViewport | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const v = value as Record<string, unknown>
  const width = Number(v.width), height = Number(v.height)
  const scale = Number(v.deviceScaleFactor)
  if (!Number.isFinite(width) || !Number.isFinite(height)) return undefined
  return {
    width: Math.max(320, Math.min(3840, Math.round(width))),
    height: Math.max(240, Math.min(2160, Math.round(height))),
    deviceScaleFactor: Number.isFinite(scale) && scale >= 1 && scale <= 3 ? scale : 1
  }
}

export function registerBrowserRoutes(app: FastifyInstance, deps: BrowserRoutesDeps): void {
  const { core, runner, runnerFacingBase } = deps

  // Общая проверка: разговор существует, принадлежит пользователю и это
  // Playwright Reader; иначе ни сессии, ни команд к чужому Chromium.
  const guard = async (req: FastifyRequest, id: string, stopping = false): Promise<string> => {
    if (!runner) throw new BrowserRunnerError(501, 'Browser Runner не настроен на этом сервере')
    const conversation = await core.conversation(uid(req), id)
    if (!conversation) throw new BrowserRunnerError(404, 'Разговор не найден')
    if (!isChromiumReaderConversation(conversation) && !(stopping && conversation.assistantKind === 'web-recorder')) throw new BrowserRunnerError(403, 'Для этого разговора не выбран Chromium')
    return id
  }

  const fail = (reply: FastifyReply, err: unknown): unknown => {
    const known = err instanceof BrowserRunnerError ? err : new BrowserRunnerError(502, 'Browser Runner недоступен')
    return reply.code(known.status).send({ error: 'browser_runner', message: known.message })
  }

  app.post<{ Params: { id: string }; Body: { viewport?: unknown } }>('/api/browser/:id/start', async (req, reply) => {
    try {
      const id = await guard(req, req.params.id)
      const viewport = normalizeViewport(req.body?.viewport)
      return await runner!.start({ sessionId: id, userKey: uid(req), conversationKey: id, profileMode: 'persistent', ...(viewport ? { viewport } : {}), cookies: await previewSessionCookies(core, uid(req), runnerFacingBase) })
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.post<{ Params: { id: string }; Body: { incarnation?: string; tabId?: string; command?: BrowserCommand } }>('/api/browser/:id/command', { bodyLimit: BROWSER_COMMAND_BODY_LIMIT }, async (req, reply) => {
    try {
      const id = await guard(req, req.params.id)
      const { incarnation, tabId, command } = req.body ?? {}
      if (typeof incarnation !== 'string' || !command || typeof command !== 'object' || command.type === 'screenshot') {
        throw new BrowserRunnerError(400, 'Нужны incarnation и command (кроме screenshot — для него отдельный роут)')
      }
      // Селекторное действие возвращает результат чтения/поиска, а не метаданные
      // сессии: модели нужен текст страницы, а не её заголовок.
      if (command.type === 'selector' && !command.action) {
        throw new BrowserRunnerError(400, 'Селекторной команде нужен action')
      }
      // Адрес машины существует только через прокси ядра; ручная панель должна
      // открывать его тем же путём, что browser.open у модели.
      const resolved = (command.type === 'navigate' || command.type === 'newTab') && command.url
        ? { ...command, url: machinePreviewUrl(runnerFacingBase, command.url) } : command
      return await runner!.command(id, { requestId: randomUUID(), incarnation, ...(tabId ? { tabId } : {}), actor: 'user', command: resolved })
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.post<{ Params: { id: string }; Body: { incarnation?: string; tabId?: string } & BrowserScreenshotOptions }>('/api/browser/:id/screenshot', async (req, reply) => {
    try {
      const id = await guard(req, req.params.id)
      const { incarnation, tabId, ...options } = req.body ?? {}
      if (typeof incarnation !== 'string') throw new BrowserRunnerError(400, 'Нужен incarnation')
      const shot = await runner!.screenshot(id, {
        requestId: randomUUID(),
        incarnation,
        ...(tabId ? { tabId } : {}),
        actor: 'user',
        command: { ...options, type: 'screenshot' }
      })
      // Координаты и страница снимка принадлежат самому кадру; статус нужен для управления очередью.
      let page = shot.metadata?.page
      let control: 'shared' | 'user' | undefined, queuedCommands: number | undefined
      try {
        const metadata = await runner!.command(id, { requestId: randomUUID(), incarnation, ...(tabId ? { tabId } : {}), actor: 'user', command: { type: 'status' } })
        if (isBrowserSessionMetadata(metadata)) {
          control = metadata.control; queuedCommands = metadata.queuedCommands
          if (!page && metadata.currentUrl) page = { url: metadata.currentUrl, title: metadata.title ?? '' }
        }
      } catch { /* Готовый кадр остаётся полезным при недоступном status. */ }
      return { dataUrl: `data:${shot.mimeType};base64,${shot.buffer.toString('base64')}`, ...(page ? { page } : {}), ...(control ? { control } : {}), ...(typeof queuedCommands === 'number' ? { queuedCommands } : {}) }
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.delete<{ Params: { id: string } }>('/api/browser/:id', async (req, reply) => {
    try {
      const id = await guard(req, req.params.id, true)
      return { stopped: await runner!.stop(id) }
    } catch (err) {
      return fail(reply, err)
    }
  })
}
