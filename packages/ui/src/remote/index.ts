// Установка мостов window.* поверх REST+WS сервера — удалённый режим.
// Используется веб-клиентом (same-origin/VITE_SERVER_URL) и десктопом в роли
// тонкого клиента (URL сервера задаётся пользователем). Формы совпадают с
// @shared/ipc, поэтому UI/стор работают без изменений.

import type {
  RendererAgentsBridge,
  RendererBoardBridge,
  RendererAudioBridge,
  RendererAuthBridge,
  RendererBrowserBridge,
  RendererCcBridge,
  RendererClaudeBridge,
  RendererCodexBridge,
  RendererFilesBridge,
  RendererFsBridge,
  RendererPreviewBridge,
  RendererRealtimeBridge,
  RendererPtyBridge,
  RendererSessionBridge,
  RendererSttBridge,
  RendererTtsBridge,
  RendererMakeBridge
} from '@shared/ipc'
import { REST, type DesktopMigrationBundle, type ServerFileInfo } from '@shared/protocol'
import type { FsResult } from '@shared/agentProtocol'
import type { SessionUser, SessionInfo } from '@shared/types'
import { WsClient } from './wsClient'
import { createHttpApi, createCiRest, createKbUsageRest } from './httpApi'
import type { RendererCiBridge } from './ciBridge'
import type { RendererKbBridge } from './kbBridge'
import { createFeaturePreviewRest } from './featurePreviewBridge'
import { createQaRest } from './qaBridge'
import { authHeaders as sessionHeaders, dropLegacyToken, getCsrf, getToken, hasSession, legacyToken, setToken } from './session'
import { base64ToArrayBuffer } from './decode'

function makeAuthBridge(ws: WsClient): RendererAuthBridge {
  return { onStatus: (cb) => ws.on('auth.status', (m) => cb(m.status)) }
}

function makeAudioBridge(ws: WsClient): RendererAudioBridge {
  return {
    audioStart: ({ sampleRate }) => ws.send({ t: 'audio.start', sampleRate }),
    audioChunk: ({ pcm }) => ws.sendBinary(pcm),
    audioStop: () => ws.send({ t: 'audio.stop' })
  }
}

function makeSttBridge(ws: WsClient): RendererSttBridge {
  return {
    onPartial: (cb) => ws.on('stt.partial', (m) => cb(m.update)),
    onFinal: (cb) => ws.on('stt.final', (m) => cb(m.update)),
    onError: (cb) => ws.on('stt.error', (m) => cb({ message: m.message })),
    download: () => ws.send({ t: 'stt.download' }),
    onDownloadProgress: (cb) => ws.on('stt.downloadProgress', (m) => cb({ percent: m.percent })),
    onDownloadDone: (cb) => ws.on('stt.downloadDone', () => cb()),
    onDownloadError: (cb) => ws.on('stt.downloadError', (m) => cb({ message: m.message }))
  }
}

export function makeClaudeBridge(ws: WsClient): RendererClaudeBridge {
  return {
    send: ({ conversationId, messageId, segments, attachments, verbose, execTarget, assistantContext }) =>
      ws.send({ t: 'claude.send', conversationId, messageId, segments, attachments, verbose, execTarget, assistantContext }),
    cancel: (payload) =>
      ws.send({
        t: 'claude.cancel',
        ...(payload?.conversationId ? { conversationId: payload.conversationId } : {})
      }),
    editQueued: (payload) => ws.send({ t: 'claude.queue.edit', ...payload }),
    deleteQueued: (payload) => ws.send({ t: 'claude.queue.delete', ...payload }),
    reorderQueued: (payload) => ws.send({ t: 'claude.queue.reorder', ...payload }),
    sendQueuedNow: (payload) => ws.send({ t: 'claude.queue.now', ...payload }),
    onToken: (cb) =>
      ws.on('claude.token', (m) => cb({ conversationId: m.conversationId, delta: m.delta })),
    onDone: (cb) =>
      ws.on('claude.done', (m) =>
        cb({
          conversationId: m.conversationId,
          text: m.text,
          meta: m.meta,
          engine: m.engine,
          message: m.message
        })
      ),
    onError: (cb) =>
      ws.on('claude.error', (m) => cb({ conversationId: m.conversationId, message: m.message })),
    onLog: (cb) =>
      ws.on('claude.log', (m) => cb({ conversationId: m.conversationId, entry: m.entry })),
    onStart: (cb) => ws.on('claude.start', (m) => cb({ conversationId: m.conversationId, provider: m.provider, model: m.model, execTarget: m.execTarget })),
    onActive: (cb) => ws.on('claude.active', (m) => cb({ turns: m.turns })),
    onQueue: (cb) => ws.on('claude.queue', (m) => cb({ conversationId: m.conversationId, items: m.items, paused: m.paused, published: m.published, removedMessageIds: m.removedMessageIds })),
    onUsage: (cb) =>
      ws.on('claude.usage', (m) => cb({ conversationId: m.conversationId, usage: m.usage }))
  }
}

function makeMakeBridge(ws: WsClient): RendererMakeBridge {
  return {
    onChanged: (cb) => ws.on('make.changed', (m) => cb({ conversationId: m.conversationId, rev: m.rev, paths: m.paths })),
    onPresence: (cb) => ws.on('make.presence', (m) => cb({ conversationId: m.conversationId, clients: m.clients }))
  }
}

function makeTtsBridge(ws: WsClient): RendererTtsBridge {
  return {
    speak: ({ text, voice }) => ws.send({ t: 'tts.speak', text, voice }),
    cancel: () => ws.send({ t: 'tts.cancel' }),
    onAudio: (cb) => ws.on('tts.audio', (m) => cb({ audio: base64ToArrayBuffer(m.audio) })),
    onError: (cb) => ws.on('tts.error', (m) => cb({ message: m.message })),
    downloadVoice: ({ id }) => ws.send({ t: 'tts.downloadVoice', id }),
    onVoiceProgress: (cb) => ws.on('tts.voiceProgress', (m) => cb({ id: m.id, percent: m.percent })),
    onVoiceDone: (cb) => ws.on('tts.voiceDone', (m) => cb({ id: m.id })),
    onVoiceError: (cb) => ws.on('tts.voiceError', (m) => cb({ id: m.id, message: m.message }))
  }
}

function makeCcBridge(ws: WsClient): RendererCcBridge {
  return {
    tailStart: ({ slug, id }) => ws.send({ t: 'cc.tail.start', slug, id }),
    tailStop: () => ws.send({ t: 'cc.tail.stop' }),
    onTail: (cb) => ws.on('cc.tail', (m) => cb({ slug: m.slug, id: m.id, items: m.items }))
  }
}

function makeCodexBridge(ws: WsClient): RendererCodexBridge {
  return {
    tailStart: ({ id }) => ws.send({ t: 'cx.tail.start', id }),
    tailStop: () => ws.send({ t: 'cx.tail.stop' }),
    onTail: (cb) => ws.on('cx.tail', (m) => cb({ id: m.id, items: m.items }))
  }
}

function makeAgentsBridge(ws: WsClient): RendererAgentsBridge {
  return { onChange: (cb) => ws.on('agents', (m) => cb(m.agents)) }
}

/** Мост действий веб-превью: приём preview.action, ответ preview.result. */
export function makePreviewBridge(ws: WsClient): RendererPreviewBridge {
  return {
    onAction: (cb) =>
      ws.on('preview.action', (m) => cb({ conversationId: m.conversationId, requestId: m.requestId, action: m.action })),
    result: (m) =>
      ws.send({
        t: 'preview.result',
        requestId: m.requestId,
        ...(m.conversationId ? { conversationId: m.conversationId } : {}),
        ...(m.registrationId ? { registrationId: m.registrationId } : {}),
        ok: m.ok,
        ...(m.result !== undefined ? { result: m.result } : {}),
        ...(m.error !== undefined ? { error: m.error } : {})
      })
  }
}

export function makeRealtimeBridge(ws: WsClient): RendererRealtimeBridge {
  return {
    onConnected: (cb) => ws.onConnected(cb),
    connected: () => ws.isConnected(),
    onTaskPreparationNotificationsInvalidated: (cb) =>
      ws.on('task-preparation.notifications.invalidate', (m) => cb({ projectId: m.projectId }))
  }
}

export function makeBoardBridge(ws: WsClient): RendererBoardBridge {
  return {
    subscribe: (projectId) => ws.send({ t: 'board.subscribe', projectId }),
    unsubscribe: () => ws.send({ t: 'board.unsubscribe' }),
    onChanged: (cb) => ws.on('board.changed', (m) => cb({ projectId: m.projectId })),
    onConnected: (cb) => ws.onConnected(() => cb()),
    onPreparationRunUpdated: (cb) => ws.on('preparation.run.updated', (m) => cb({ projectId: m.projectId, taskId: m.taskId, runId: m.runId })),
    onTaskRepositoriesUpdated: (cb) => ws.on('task.repositories.updated', (m) => cb({ projectId: m.projectId, taskId: m.taskId })),
    onReconnect: (cb) => ws.onConnected((reconnected) => { if (reconnected) cb() })
  }
}

/** Мост CI-раннера: REST (createCiRest) + realtime WS поверх одного соединения. */
function makeCiBridge(httpBase: string, ws: WsClient): RendererCiBridge {
  return {
    ...createCiRest(httpBase),
    subscribe: (runId) => ws.send({ t: 'ci.subscribe', runId }),
    unsubscribe: (runId) => ws.send({ t: 'ci.unsubscribe', runId }),
    onMerge: (cb) => ws.on('merge.snapshot', (m) => cb({ runId: m.runId, run: m.run })),
    onSnapshot: (cb) => ws.on('ci.snapshot', (m) => cb({ runId: m.runId, detail: m.detail, log: m.log })),
    onRun: (cb) => ws.on('ci.run', (m) => cb({ runId: m.runId, run: m.run })),
    onStep: (cb) => ws.on('ci.step', (m) => cb({ runId: m.runId, step: m.step })),
    onLog: (cb) => ws.on('ci.log', (m) => cb({ runId: m.runId, line: m.line })),
    onFix: (cb) => ws.on('ci.fix', (m) => cb({ runId: m.runId, attempt: m.attempt })),
    onDone: (cb) => ws.on('ci.done', (m) => cb({ runId: m.runId, run: m.run, conclusion: m.conclusion })),
    onSummary: (cb) => ws.on('ci.summary', (m) => cb({ projectId: m.projectId, summary: m.summary })),
    onInteraction: (cb) => ws.on('ci.interaction', (m) => cb({ runId: m.runId, interaction: m.interaction })),
    onChatMessage: (cb) => ws.on('chat.message', (m) => cb({ conversationId: m.conversationId, message: m.message }))
  }
}

/**
 * Мост телеметрии БЗ: REST-снапшоты + инкременты kb.usage. Подписки на чат нет —
 * сервер рассылает кадры по пользователю, стор сам раскладывает их по чатам.
 */
function makeKbBridge(httpBase: string, ws: WsClient): RendererKbBridge {
  return {
    ...createKbUsageRest(httpBase),
    onUsage: (cb) => ws.on('kb.usage', (m) => cb({ conversationId: m.conversationId, projectId: m.projectId, query: m.query }))
  }
}

interface DesktopMigrationClient {
  exportLegacyData(): Promise<DesktopMigrationBundle | null>
  markLegacyMigrated(): Promise<void>
}

export async function migrateDesktopLegacy(httpBase: string, token: string): Promise<void> {
  const client = (window as unknown as { remoteClient?: DesktopMigrationClient }).remoteClient
  if (!client) return
  const bundle = await client.exportLegacyData()
  if (!bundle) return
  const response = await fetch(httpBase + REST.desktopMigration, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(bundle) })
  if (!response.ok) throw new Error(`desktop migration: HTTP ${response.status}`)
  await client.markLegacyMigrated()
}

/** Мост сессии поверх REST: логин сохраняет токен и перезапускает WS с ним. */
export function makeSessionBridge(httpBase: string, ws: WsClient): RendererSessionBridge {
  const authHeaders = (): Record<string, string> => sessionHeaders()
  return {
    login: async ({ name, password }) => {
      const res = await fetch(httpBase + REST.sessionLogin, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, password })
      })
      if (!res.ok) return null
      const body = (await res.json()) as { token?: string; user?: SessionUser; requires2fa?: true; ticket?: string }
      if (body.requires2fa && body.ticket) return { requires2fa: true, ticket: body.ticket }
      const { token, user } = body as { token: string; user: SessionUser }
      // Токен — в память (auth-roadmap п.5): сервер уже положил HttpOnly-cookie, localStorage больше не используем.
      setToken(token)
      ws.reconnect() // теперь есть сессия — поднимаем WS-соединение
      try {
        await migrateDesktopLegacy(httpBase, token)
      } catch (error) {
        console.warn('[desktop migration] импорт будет повторён после следующего входа', error)
      }
      return user
    },
    // Второй фактор (auth-roadmap п.6): код по тикету → та же сессия, что и после обычного входа.
    login2fa: async ({ ticket, code }) => {
      const res = await fetch(httpBase + REST.session2fa, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ticket, code }) })
      if (!res.ok) return null
      const { token, user } = (await res.json()) as { token: string; user: SessionUser }
      setToken(token)
      ws.reconnect()
      return user
    },
    inviteInfo: async (token) => {
      const r = await fetch(httpBase + REST.sessionInvite(token))
      return r.ok ? ((await r.json()) as { role: string; expiresAt: number; note: string }) : null
    },
    register: async ({ token, name, password }) => {
      const r = await fetch(httpBase + REST.sessionRegister, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, name, password }) })
      if (!r.ok) return { error: ((await r.json().catch(() => ({}))) as { error?: string }).error ?? `Ошибка ${r.status}` }
      const { token: t } = (await r.json()) as { token: string }
      setToken(t)
      ws.reconnect()
      return { ok: true }
    },
    twoFactor: {
      status: async () => { const r = await fetch(httpBase + REST.session2fa, { headers: authHeaders() }); if (!r.ok) throw new Error('Не удалось получить статус 2FA'); return (await r.json()) as { enabled: boolean } },
      setup: async () => { const r = await fetch(httpBase + REST.session2faSetup, { method: 'POST', headers: authHeaders() }); if (!r.ok) throw new Error('Не удалось создать секрет'); return (await r.json()) as { secret: string; otpauth: string } },
      enable: async (code) => { const r = await fetch(httpBase + REST.session2faEnable, { method: 'POST', headers: { ...authHeaders(), 'content-type': 'application/json' }, body: JSON.stringify({ code }) }); if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Не удалось включить 2FA') },
      disable: async (code) => { const r = await fetch(httpBase + REST.session2faDisable, { method: 'POST', headers: { ...authHeaders(), 'content-type': 'application/json' }, body: JSON.stringify({ code }) }); if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Не удалось выключить 2FA') }
    },
    me: async () => {
      if (!hasSession()) return null
      const res = await fetch(httpBase + REST.sessionMe, { headers: authHeaders() })
      if (!res.ok) return null
      const { user } = (await res.json()) as { user: SessionUser | null }
      return user ?? null
    },
    logout: async () => {
      const res = await fetch(httpBase + REST.sessionLogout, { method: 'POST', headers: authHeaders() })
      if (!res.ok) throw new Error('Не удалось завершить сессию. Попробуйте ещё раз.')
      setToken(null)
      ws.reconnect() // рвём авторизованное соединение
    },
    // Сессии (auth-roadmap п.4): список устройств, «выйти везде» (кроме текущей), отзыв одной.
    sessions: async () => {
      const res = await fetch(httpBase + REST.sessionList, { headers: authHeaders() })
      if (!res.ok) throw new Error('Не удалось получить список сессий')
      return ((await res.json()) as { sessions: SessionInfo[] }).sessions
    },
    logoutAll: async () => {
      const res = await fetch(httpBase + REST.sessionLogoutAll, { method: 'POST', headers: authHeaders() })
      if (!res.ok) throw new Error('Не удалось завершить другие сессии')
    },
    revokeSession: async (sid) => {
      const res = await fetch(httpBase + REST.sessionRevoke(sid), { method: 'DELETE', headers: authHeaders() })
      if (!res.ok) throw new Error('Не удалось завершить сессию')
    },
    // Выпускает preview-cookie из текущего Bearer-токена: восстановленная из
    // localStorage сессия иначе остаётся без cookie и iframe превью ловит 401.
    ensurePreview: async () => {
      if (!hasSession()) return false
      try {
        const res = await fetch(httpBase + REST.sessionPreview, { method: 'POST', headers: authHeaders() })
        return res.ok
      } catch {
        return false
      }
    }
  }
}

/**
 * Мост изолированного Chromium Playwright Reader (REST). Оркестрацию держит
 * сервер: start/command/stop проксируются в browser-runner, screenshot тянет
 * кадр (поллинг = screencast). Bearer из localStorage; incarnation даёт start.
 */
export function makeBrowserBridge(httpBase: string): RendererBrowserBridge {
  const authJson = (): Record<string, string> => ({ 'content-type': 'application/json', ...sessionHeaders() })
  const post = async <T>(path: string, body: unknown): Promise<T> => {
    const res = await fetch(httpBase + path, { method: 'POST', headers: authJson(), body: JSON.stringify(body) })
    if (!res.ok) {
      let message = `Browser Runner: ${res.status}`
      try { const data = await res.json() as { message?: string }; if (data.message) message = data.message } catch { /* не JSON */ }
      throw new Error(message)
    }
    return res.json() as Promise<T>
  }
  return {
    start: (conversationId, viewport) => post(REST.browserSessionStart(conversationId), viewport ? { viewport } : {}),
    command: (conversationId, req) => post(REST.browserSessionCommand(conversationId), req),
    screenshot: (conversationId, req) => post(REST.browserSessionScreenshot(conversationId), req),
    stop: async (conversationId) => {
      const t = getToken()
      await fetch(httpBase + REST.browserSession(conversationId), { method: 'DELETE', headers: t ? { authorization: `Bearer ${t}` } : {} })
    }
  }
}

/** Мост чтения файлов с диска сервера (картинки, созданные самим CLI). */
function makeFilesBridge(httpBase: string): RendererFilesBridge {
  return {
    read: async (path) => {
      const t = getToken()
      const res = await fetch(
        `${httpBase}${REST.serverFile}?path=${encodeURIComponent(path)}`,
        { headers: t ? { authorization: `Bearer ${t}` } : {} }
      )
      // 404 — «файла нет в моей области»; это штатный ответ, а не сбой: вызывающий
      // после него пробует прочитать тот же путь с машины.
      if (res.status === 404) return null
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error === 'too-large' ? 'файл слишком большой' : `HTTP ${res.status}`)
      }
      return res.json() as Promise<ServerFileInfo>
    }
  }
}

/** Мост файлового проводника поверх REST (с токеном сессии). */
function makeFsBridge(httpBase: string): RendererFsBridge {
  const authHeaders = (extra?: Record<string, string>): Record<string, string> => {
    const t = getToken()
    return { ...(t ? { authorization: `Bearer ${t}` } : {}), ...extra }
  }
  const asResult = async (res: Response): Promise<FsResult> => {
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(body.error ?? `HTTP ${res.status}`)
    }
    return res.json() as Promise<FsResult>
  }
  const projectQuery = (projectId?: string): string => projectId ? `&projectId=${encodeURIComponent(projectId)}` : ''
  const projectOnlyQuery = (projectId?: string): string => projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''
  const q = (agentId: string, path: string, projectId?: string): string =>
    `${httpBase}${REST.agentFs(agentId)}?path=${encodeURIComponent(path)}${projectQuery(projectId)}`
  return {
    list: (id, path, projectId) => fetch(q(id, path, projectId), { headers: authHeaders() }).then(asResult),
    read: (id, path, projectId) =>
      fetch(`${httpBase}${REST.agentFsFile(id)}?path=${encodeURIComponent(path)}${projectQuery(projectId)}`, {
        headers: authHeaders()
      }).then(asResult),
    write: (id, path, dataBase64, projectId) =>
      fetch(`${httpBase}${REST.agentFsFile(id)}${projectOnlyQuery(projectId)}`, {
        method: 'POST',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ path, dataBase64 })
      }).then(asResult),
    remove: (id, path, projectId) =>
      fetch(q(id, path, projectId), { method: 'DELETE', headers: authHeaders() }).then(asResult),
    rename: (id, from, to, projectId) =>
      fetch(`${httpBase}${REST.agentFsRename(id)}${projectOnlyQuery(projectId)}`, {
        method: 'POST',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ from, to })
      }).then(asResult),
    mkdir: (id, path, projectId) =>
      fetch(`${httpBase}${REST.agentFsMkdir(id)}${projectOnlyQuery(projectId)}`, {
        method: 'POST',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ path })
      }).then(asResult),
    exec: async (id, command, signal, projectId) => {
      const res = await fetch(`${httpBase}${REST.agentExec(id)}${projectOnlyQuery(projectId)}`, {
        method: 'POST',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ command }),
        // Отмена рвёт HTTP-запрос — по его закрытию сервер шлёт агенту exec.cancel.
        ...(signal ? { signal } : {})
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      return res.json()
    }
  }
}

/** Мост живого PTY-терминала поверх клиентского WS. */
function makePtyBridge(ws: WsClient): RendererPtyBridge {
  return {
    start: ({ agentId, ptyId, cols, rows, cwd, projectId }) =>
      ws.send({ t: 'pty.start', agentId, ptyId, cols, rows, ...(cwd ? { cwd } : {}), ...(projectId ? { projectId } : {}) }),
    input: ({ ptyId, data }) => ws.send({ t: 'pty.input', ptyId, data }),
    resize: ({ ptyId, cols, rows }) => ws.send({ t: 'pty.resize', ptyId, cols, rows }),
    kill: ({ ptyId }) => ws.send({ t: 'pty.kill', ptyId }),
    onConnected: (cb) => ws.onConnected(cb),
    onOutput: (cb) => ws.on('pty.output', (m) => cb({ ptyId: m.ptyId, data: m.data })),
    onExit: (cb) => ws.on('pty.exit', (m) => cb({ ptyId: m.ptyId, exitCode: m.exitCode })),
    onError: (cb) => ws.on('pty.error', (m) => cb({ ptyId: m.ptyId, message: m.message }))
  }
}

/** http→ws, same-origin если base пустой. */
function toWsBase(httpBase: string): string {
  if (httpBase) return httpBase.replace(/^http/, 'ws')
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}`
}

let ws: WsClient | null = null

/**
 * Ставит window.api/audio/stt/claude/tts/cc/agents поверх сервера по адресу
 * serverHttp ('' = same-origin). Идемпотентно на один процесс.
 */
/** Перенос унаследованного localStorage-токена в HttpOnly-cookie (auth-roadmap п.5); после успеха токен из localStorage удаляется. */
async function migrateLegacyToken(httpBase: string): Promise<void> {
  const legacy = legacyToken()
  if (!legacy) return
  try {
    const res = await fetch(httpBase + REST.sessionCookie, { method: 'POST', headers: { authorization: `Bearer ${legacy}` } })
    if (res.ok || res.status === 401) dropLegacyToken()
    if (res.ok) ws?.reconnect()
  } catch { /* сеть недоступна — попробуем при следующей загрузке */ }
}

export function installRemoteBridges(serverHttp: string, localAgentId: string | null = null): void {
  if (ws) return
  const httpBase = serverHttp.replace(/\/$/, '')
  const wsBase = toWsBase(httpBase)
  // WS дозванивается только при наличии токена сессии (getToken) — до логина ждём.
  // Провайдер отдаёт Bearer или маркер 'cookie' (п.5): при cookie-сессии браузер сам отправит vc_session на upgrade.
  ws = new WsClient(`${wsBase}/ws`, () => getToken() ?? (getCsrf() ? 'cookie' : null))
  void migrateLegacyToken(httpBase)
  window.api = createHttpApi(httpBase, `${wsBase}/agent`)
  window.audio = makeAudioBridge(ws)
  window.auth = makeAuthBridge(ws)
  window.stt = makeSttBridge(ws)
  window.claude = makeClaudeBridge(ws)
  window.tts = makeTtsBridge(ws)
  window.cc = makeCcBridge(ws)
  window.codex = makeCodexBridge(ws)
  window.agents = makeAgentsBridge(ws)
  window.realtime = makeRealtimeBridge(ws)
  window.board = makeBoardBridge(ws)
  window.ci = makeCiBridge(httpBase, ws)
  window.kb = makeKbBridge(httpBase, ws)
  window.session = makeSessionBridge(httpBase, ws)
  window.fs = makeFsBridge(httpBase)
  window.files = makeFilesBridge(httpBase)
  window.pty = makePtyBridge(ws)
  window.make = makeMakeBridge(ws)
  window.preview = makePreviewBridge(ws)
  window.browser = makeBrowserBridge(httpBase)
  window.featurePreview = createFeaturePreviewRest(httpBase, localAgentId)
  window.qa = createQaRest(httpBase)
}
