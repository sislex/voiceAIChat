// REST для машин-агентов: список (с онлайн-статусом), создание (одноразовый
// токен), удаление (отзыв токена + разрыв соединения).

import { createReadStream, existsSync } from 'node:fs'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  REST,
  AGENT_VERSION,
  agentOsFromPlatform,
  installCommand,
  installScriptUrl,
  type AgentInfo,
  type AgentPolicy
} from '@voicechat/shared'
import type { VoiceChatDb } from '../db/database.js'
import { uid } from '../users/auth.js'
import type { AgentRegistry } from '../agents/registry.js'
import { buildAgentScript } from '../agents/agentScript.js'
import { buildAndroidInstallScript } from '../agents/androidInstall.js'
import { buildWindowsInstallScript } from '../agents/windowsInstall.js'
import { buildUnixInstallScript } from '../agents/unixInstall.js'

/** Кавычим строку для одинарных кавычек bash. */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'"'"'`)}'`
}

/** Запуск обновления отвязан от exec'а, поэтому ждать долго не нужно. */
const UPDATE_EXEC_TIMEOUT_MS = 30_000

/** Пути к собранным .dmg (undefined — не собрано). */
export interface AppArtifacts {
  agentApp?: string
  desktopApp?: string
}

/** Отдаёт .dmg на скачивание или 404 с подсказкой, как собрать. */
function sendDmg(
  reply: FastifyReply,
  path: string | undefined,
  filename: string,
  buildHint: string
): FastifyReply {
  if (!path || !existsSync(path)) {
    return reply.code(404).send({ error: `Приложение не собрано. Соберите: ${buildHint}` })
  }
  return reply
    .header('content-type', 'application/x-apple-diskimage')
    .header('content-disposition', `attachment; filename="${filename}"`)
    .send(createReadStream(path))
}

export async function registerAgentRoutes(
  app: FastifyInstance,
  db: VoiceChatDb,
  registry: AgentRegistry,
  artifacts: AppArtifacts = {}
): Promise<void> {
  app.get(REST.agents, async (req): Promise<AgentInfo[]> => {
    const online = registry.onlineIds()
    return db.listAgents(uid(req)).map((a) => ({
      ...a,
      online: online.has(a.id),
      version: registry.versionOf(a.id),
      telemetry: registry.telemetryOf(a.id),
      imageHost: registry.imageHostOf(a.id)
    }))
  })

  // Владеет ли текущий пользователь машиной id (для операций над ней).
  const ownsAgent = (userId: string, id: string): boolean =>
    db.listAgents(userId).some((a) => a.id === id)

  // Последняя доступная версия агента (публично — трей проверяет обновления).
  app.get(REST.agentLatestVersion, async () => ({ version: AGENT_VERSION }))

  // Собранные .dmg. Собираются заранее (npm --prefix … run dist).
  app.get(REST.agentApp, async (_req, reply) =>
    sendDmg(reply, artifacts.agentApp, 'voicechat-agent.dmg', 'npm --prefix apps/agent-tray run dist')
  )
  app.get(REST.desktopApp, async (_req, reply) =>
    sendDmg(reply, artifacts.desktopApp, 'voicechat-desktop.dmg', 'npm --prefix apps/desktop run dist')
  )

  // Бандл компаньон-агента (.cjs, без токена — настраивается строкой подключения).
  app.get(REST.agentScript, async (_req, reply) => {
    try {
      const script = await buildAgentScript()
      return reply
        .header('content-type', 'application/javascript; charset=utf-8')
        .header('content-disposition', 'attachment; filename="voicechat-agent.cjs"')
        .send(script)
    } catch (err) {
      return reply
        .code(500)
        .send({ error: `Не удалось собрать агента: ${err instanceof Error ? err.message : err}` })
    }
  })

  // Внешняя база сервера для установщиков: за прокси (Caddy) — из X-Forwarded-*.
  /**
   * Годится ли база для команды, которую выполнит ДРУГАЯ машина. `Host` запроса —
   * это адрес, по которому открыт браузер: на dev-машине это localhost, и такая
   * команда на телефоне ушла бы в него самого (реальный случай: curl молча не
   * находил сервер, обновление «проходило» без эффекта).
   */
  const reachableFromMachine = (base: string): boolean => {
    try {
      const host = new URL(base).hostname.replace(/^\[|\]$/g, '')
      return !(host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost'))
    } catch {
      return false
    }
  }

  const externalBase = (req: FastifyRequest): string => {
    const fwdProto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim()
    const fwdHost = String(req.headers['x-forwarded-host'] ?? '').split(',')[0].trim()
    const proto = fwdProto || req.protocol
    const host = fwdHost || req.headers.host || ''
    return `${proto}://${host}`
  }

  // Установщики агента (Termux/Android — bash, Windows — PowerShell) с адресом сервера.
  // Строка подключения передаётся аргументом при запуске, в endpoint не вшивается.
  app.get(REST.agentInstallAndroid, async (req, reply) =>
    reply
      .header('content-type', 'text/x-shellscript; charset=utf-8')
      .send(buildAndroidInstallScript(externalBase(req)))
  )
  app.get(REST.agentInstallWindows, async (req, reply) =>
    reply
      .header('content-type', 'text/x-powershell; charset=utf-8')
      .send(buildWindowsInstallScript(externalBase(req)))
  )
  app.get(REST.agentInstallLinux, async (req, reply) =>
    reply
      .header('content-type', 'text/x-shellscript; charset=utf-8')
      .send(buildUnixInstallScript(externalBase(req), 'linux'))
  )
  app.get(REST.agentInstallMacos, async (req, reply) =>
    reply
      .header('content-type', 'text/x-shellscript; charset=utf-8')
      .send(buildUnixInstallScript(externalBase(req), 'macos'))
  )

  app.post<{ Body: { name?: string } }>(REST.agents, async (req, reply) => {
    const name = req.body?.name?.trim()
    if (!name) return reply.code(400).send({ error: 'name required' })
    return db.createAgent(uid(req), name)
  })

  app.delete<{ Params: { id: string } }>('/api/agents/:id', async (req, reply) => {
    const u = uid(req)
    const id = req.params.id
    if (!ownsAgent(u, id)) return reply.code(404).send({ error: 'not found' })
    registry.disconnect(id)
    db.deleteAgent(u, id)
    db.clearConversationExecTargetForAgent(u, id)
    // Удалили legacy-цель выполнения — возвращаемся на сервер.
    const settings = db.getSettings(u)
    if (settings.execTarget === id) db.saveSettings(u, { ...settings, execTarget: null })
    return { ok: true }
  })

  // Политика возможностей машины: сохранить в БД и сразу отправить онлайн-агенту.
  app.post<{ Params: { id: string }; Body: { policy: AgentPolicy } }>(
    '/api/agents/:id/policy',
    async (req, reply) => {
      const u = uid(req)
      const policy = req.body?.policy
      if (!policy) return reply.code(400).send({ error: 'policy required' })
      if (!ownsAgent(u, req.params.id)) return reply.code(404).send({ error: 'not found' })
      db.setAgentPolicy(u, req.params.id, policy)
      registry.updatePolicy(req.params.id, policy)
      return { ok: true }
    }
  )

  /**
   * Обновление агента на машине: сервер выполняет на ней РОВНО ту команду, которую
   * пользователь мог бы скопировать и вставить руками. Строку подключения не
   * передаём — установщик сам достанет её из файла или из аргументов живого агента
   * (иначе пришлось бы перевыпускать токен, а при осечке машина осталась бы без него).
   *
   * Команда должна пережить смерть агента, который её же и запустил: на unix
   * заворачиваем в setsid+nohup, на Windows — в Start-Process. Поэтому ответ
   * приходит сразу, а результат виден по тому, что машина вернулась в сеть с новой
   * версией. Ошибку самого обновления смотреть в agent.log на машине.
   */
  app.post<{ Params: { id: string } }>('/api/agents/:id/update', async (req, reply) => {
    const u = uid(req)
    const id = req.params.id
    if (!ownsAgent(u, id)) return reply.code(404).send({ error: 'not found' })
    if (!registry.isOnline(id)) {
      return reply.code(409).send({ error: 'Машина не в сети — обновить можно только запущенного агента' })
    }
    const telemetry = registry.telemetryOf(id)
    const os = telemetry ? agentOsFromPlatform(telemetry.os.platform, telemetry.os.isAndroid) : null
    if (!os) {
      return reply.code(409).send({
        error: 'Не удалось определить ОС машины (нужна телеметрия агента 0.4+). Обновите вручную командой из настроек.'
      })
    }
    // Адрес, по которому машина достанет установщик. Берём тот, по которому пришёл
    // запрос; если он локальный (dev, проброс порта) — нужен явный VC_PUBLIC_URL,
    // иначе команда уйдёт в саму машину и обновление тихо не случится.
    const requestBase = externalBase(req)
    const base = reachableFromMachine(requestBase)
      ? requestBase
      : (process.env.VC_PUBLIC_URL ?? '').replace(/\/+$/, '')
    if (!base) {
      return reply.code(409).send({
        error:
          `Сервер видит себя как ${requestBase} — с машины такой адрес недостижим. ` +
          'Задайте VC_PUBLIC_URL или скопируйте команду обновления и запустите её на машине.'
      })
    }
    // Установщик должен пережить смерть агента, который его запустил: на unix —
    // setsid+nohup, на Windows — Start-Process (он и так отвязывает процесс).
    const detached =
      os === 'windows'
        ? `powershell -NoProfile -ExecutionPolicy Bypass -Command "$p = Join-Path $env:TEMP 'vc-agent-install.ps1'; ` +
          `curl.exe -fsSLk ${installScriptUrl(os, base)} -o $p; ` +
          `Start-Process -WindowStyle Hidden powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',$p"`
        : `(setsid nohup bash -lc ${shellQuote(installCommand(os, base))} > /dev/null 2>&1 < /dev/null &) ; echo update-started`
    try {
      const res = await registry.exec(id, detached, UPDATE_EXEC_TIMEOUT_MS)
      return { ok: true, os, output: res.output.slice(0, 2000) }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // Гейт политики проверяется и на сервере, и на агенте: обновление качает
      // скрипт и пишет файлы, поэтому машине с запретом сети/записи оно не пройдёт.
      const hint = msg.includes('политикой')
        ? ' Разрешите машине сеть и запись файлов (или обновите вручную командой из списка машин).'
        : ''
      return reply.code(502).send({ error: msg + hint })
    }
  })

  // Перевыпуск токена: старый перестаёт работать, текущее соединение рвём.
  app.post<{ Params: { id: string } }>('/api/agents/:id/token', async (req, reply) => {
    const u = uid(req)
    if (!ownsAgent(u, req.params.id)) return reply.code(404).send({ error: 'not found' })
    const { token } = db.regenerateAgentToken(u, req.params.id)
    registry.disconnect(req.params.id)
    return { token }
  })

  // --- Файловый проводник по машине (все под проверкой владения) ---
  /** Проверка владения + читаемый ответ на ошибки агента (офлайн/политика). */
  const withFs = async (
    req: { params: { id: string } },
    reply: FastifyReply,
    run: (id: string) => Promise<unknown>
  ): Promise<unknown> => {
    const u = uid(req as never)
    if (!ownsAgent(u, req.params.id)) return reply.code(404).send({ error: 'not found' })
    try {
      return await run(req.params.id)
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) })
    }
  }

  app.get<{ Params: { id: string }; Querystring: { path?: string } }>(
    '/api/agents/:id/fs',
    async (req, reply) => withFs(req, reply, (id) => registry.fsList(id, req.query.path ?? ''))
  )
  app.get<{ Params: { id: string }; Querystring: { path?: string } }>(
    '/api/agents/:id/fs/file',
    async (req, reply) => withFs(req, reply, (id) => registry.fsRead(id, req.query.path ?? ''))
  )
  app.post<{ Params: { id: string }; Body: { path?: string; dataBase64?: string } }>(
    '/api/agents/:id/fs/file',
    { bodyLimit: 48 * 1024 * 1024 }, // ~32 МБ файла + запас base64
    async (req, reply) =>
      withFs(req, reply, (id) => registry.fsWrite(id, req.body?.path ?? '', req.body?.dataBase64 ?? ''))
  )
  app.delete<{ Params: { id: string }; Querystring: { path?: string } }>(
    '/api/agents/:id/fs',
    async (req, reply) => withFs(req, reply, (id) => registry.fsDelete(id, req.query.path ?? ''))
  )
  app.post<{ Params: { id: string }; Body: { from?: string; to?: string } }>(
    '/api/agents/:id/fs/rename',
    async (req, reply) =>
      withFs(req, reply, (id) => registry.fsRename(id, req.body?.from ?? '', req.body?.to ?? ''))
  )
  app.post<{ Params: { id: string }; Body: { path?: string } }>(
    '/api/agents/:id/fs/mkdir',
    async (req, reply) => withFs(req, reply, (id) => registry.fsMkdir(id, req.body?.path ?? ''))
  )

  // Утилита «Консоль»: выполнить команду на своей машине (проверка политики — в registry.exec).
  app.post<{ Params: { id: string }; Body: { command?: string } }>(
    '/api/agents/:id/exec',
    async (req, reply) =>
      withFs(req, reply, (id) => registry.exec(id, req.body?.command ?? '', EXEC_TIMEOUT_MS))
  )
}

/** Таймаут пользовательской команды консоли. */
const EXEC_TIMEOUT_MS = 60_000
