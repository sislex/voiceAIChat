// REST для машин-агентов: список (с онлайн-статусом), создание (одноразовый
// токен), удаление (отзыв токена + разрыв соединения).

import { randomUUID } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  REST,
  AGENT_VERSION,
  MACHINE_STORAGE_FORMAT_VERSION,
  recommendedChatStoragePath,
  managedChatAttachmentsPath,
  managedChatArtifactsPath,
  managedChatTemporaryPath,
  MANAGED_ENVIRONMENT_DIRECTORIES,
  validateStorageRelativePath,
  isMachineStoragePathAllowed,
  normalizeMachineStoragePath,
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
  const withLiveStatus = (agents: ReturnType<VoiceChatDb['listAgents']>): AgentInfo[] => {
    const online = registry.onlineIds()
    return agents.map((a) => ({
      ...a,
      online: online.has(a.id),
      version: registry.versionOf(a.id),
      telemetry: registry.telemetryOf(a.id),
      imageHost: registry.imageHostOf(a.id)
    }))
  }

  app.get(REST.agents, async (req): Promise<AgentInfo[]> =>
    withLiveStatus(db.listAgents(uid(req)))
  )

  const storagePath = (rootPath: string, platform: string, name: string): string => {
    const separator = platform === 'win32' ? '\\' : '/'
    return rootPath + separator + name.replace(/[\\/]/g, separator)
  }
  const markerAt = async (machineId: string, rootPath: string, platform: string): Promise<{ id: string; formatVersion: number } | null> => {
    try {
      const result = await registry.fsRead(machineId, storagePath(rootPath, platform, '.voicechat/storage.json'))
      const raw = Buffer.from(result.dataBase64 ?? '', 'base64').toString('utf8')
      const marker = JSON.parse(raw) as { id?: unknown; formatVersion?: unknown }
      if (typeof marker.id !== 'string' || !marker.id || !Number.isInteger(marker.formatVersion)) {
        throw new Error('Повреждён marker .voicechat/storage.json')
      }
      return { id: marker.id, formatVersion: marker.formatVersion as number }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/ENOENT|not found|не найден/i.test(message)) return null
      if (/marker/.test(message)) throw error
      if (/JSON|Unexpected token|Unexpected end/i.test(message)) throw new Error('Повреждён marker .voicechat/storage.json')
      throw error
    }
  }
  const storageError = (error: unknown): string => {
    const message = error instanceof Error ? error.message : String(error)
    if (/EACCES|EPERM|permission|denied|доступ/i.test(message)) return 'Нет прав чтения или записи в выбранной директории'
    if (/ENOENT|ENODEV|ENXIO|not found|no such|не найден/i.test(message)) return 'Директория или диск недоступны'
    return message
  }

  const ensureManagedChat = async (
    userId: string,
    machineId: string,
    storageId: string,
    relativePath: string,
    conversation: { id: string; projectId?: string | null; taskId?: string | null }
  ): Promise<void> => {
    const storage = db.listMachineStorages(userId, machineId).find((item) => item.id === storageId)
    if (!storage) throw new Error('Хранилище не найдено')
    if (!registry.isOnline(machineId)) throw new Error('Машина не в сети')
    const platform = registry.platformOf(machineId) ?? 'linux'
    const rel = validateStorageRelativePath(relativePath)
    const absolute = (path: string): string => storagePath(storage.rootPath, platform, path)
    const directories = new Set<string>([
      'global', 'chats', 'projects', rel,
      managedChatAttachmentsPath(rel), managedChatArtifactsPath(rel), managedChatTemporaryPath(rel)
    ])
    const environmentRoots: Array<{ path: string; kind: string }> = []
    if (conversation.projectId) {
      directories.add(`projects/${conversation.projectId}`)
      directories.add(`projects/${conversation.projectId}/shared`)
      directories.add(`projects/${conversation.projectId}/chats`)
      directories.add(`projects/${conversation.projectId}/tasks`)
      directories.add(`projects/${conversation.projectId}/environments/previews`)
      for (const kind of ['production', 'staging'] as const) {
        const path = `projects/${conversation.projectId}/environments/${kind}`
        environmentRoots.push({ path, kind })
        for (const directory of MANAGED_ENVIRONMENT_DIRECTORIES) directories.add(`${path}/${directory}`)
      }
    }
    if (conversation.projectId && conversation.taskId) {
      const taskRoot = `projects/${conversation.projectId}/tasks/${conversation.taskId}`
      for (const path of ['attachments', 'artifacts', 'chats', 'runs']) directories.add(`${taskRoot}/${path}`)
      const testPath = `${taskRoot}/environments/test`
      environmentRoots.push({ path: testPath, kind: 'test' })
      for (const directory of MANAGED_ENVIRONMENT_DIRECTORIES) directories.add(`${testPath}/${directory}`)
    }
    for (const directory of directories) await registry.fsMkdir(machineId, absolute(directory))
    const writeJsonIfMissing = async (path: string, value: unknown): Promise<void> => {
      const target = absolute(path)
      try {
        await registry.fsRead(machineId, target)
      } catch (error) {
        if (!/ENOENT|not found|no such|не найден/i.test(error instanceof Error ? error.message : String(error))) throw error
        await registry.fsWrite(machineId, target, Buffer.from(JSON.stringify(value, null, 2) + '\n').toString('base64'))
      }
    }
    const now = new Date().toISOString()
    await writeJsonIfMissing(`${rel}/chat.json`, { formatVersion: MACHINE_STORAGE_FORMAT_VERSION, conversationId: conversation.id, createdAt: now })
    if (conversation.projectId) await writeJsonIfMissing(`projects/${conversation.projectId}/project.json`, { formatVersion: MACHINE_STORAGE_FORMAT_VERSION, projectId: conversation.projectId, createdAt: now })
    if (conversation.projectId && conversation.taskId) await writeJsonIfMissing(`projects/${conversation.projectId}/tasks/${conversation.taskId}/task.json`, { formatVersion: MACHINE_STORAGE_FORMAT_VERSION, projectId: conversation.projectId, taskId: conversation.taskId, createdAt: now })
    for (const environment of environmentRoots) {
      await writeJsonIfMissing(`${environment.path}/environment.json`, { formatVersion: MACHINE_STORAGE_FORMAT_VERSION, projectId: conversation.projectId, taskId: conversation.taskId ?? null, kind: environment.kind, createdAt: now })
    }
  }

  app.get<{ Params: { id: string } }>('/api/agents/:id/storages', async (req, reply) => {
    const userId = uid(req)
    if (!db.listAgents(userId).some((agent) => agent.id === req.params.id)) return reply.code(404).send({ error: 'not found' })
    const storages = db.listMachineStorages(userId, req.params.id)
    if (!registry.isOnline(req.params.id)) return storages.map((storage, index) => ({ ...storage, primary: index === 0, status: 'offline' as const }))
    const platform = registry.platformOf(req.params.id) ?? 'linux'
    return Promise.all(storages.map(async (storage, index) => {
      try {
        await registry.fsList(storage.machineId, storage.rootPath)
        const marker = await markerAt(storage.machineId, storage.rootPath, platform)
        if (!marker || marker.id !== storage.id || marker.formatVersion !== storage.formatVersion) {
          return { ...storage, primary: index === 0, status: 'unavailable' as const, error: 'Marker хранилища отсутствует или конфликтует' }
        }
        const probe = storagePath(storage.rootPath, platform, `.voicechat/temporary/write-probe-${randomUUID()}`)
        try {
          await registry.fsWrite(storage.machineId, probe, Buffer.from('ok').toString('base64'))
          await registry.fsDelete(storage.machineId, probe)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          if (/EACCES|EPERM|read.only|permission|denied|доступ/i.test(message)) return { ...storage, primary: index === 0, status: 'read-only' as const, error: 'Хранилище доступно только для чтения' }
          throw error
        }
        return { ...storage, primary: index === 0, status: 'ready' as const }
      } catch (error) {
        return { ...storage, primary: index === 0, status: 'unavailable' as const, error: storageError(error) }
      }
    }))
  })

  app.post<{ Params: { id: string }; Body: { rootPath?: string } }>(
    '/api/agents/:id/storages',
    async (req, reply) => {
      const userId = uid(req)
      const machineId = req.params.id
      const agent = db.listAgents(userId).find((item) => item.id === machineId)
      if (!agent) return reply.code(404).send({ error: 'not found' })
      if (!registry.isOnline(machineId)) return reply.code(409).send({ error: 'Машина не в сети' })
      const platform = registry.platformOf(machineId) ?? 'linux'
      let rootPath: string
      try {
        rootPath = normalizeMachineStoragePath(req.body?.rootPath ?? '', platform)
      } catch (error) {
        return reply.code(400).send({ error: storageError(error) })
      }
      if (!isMachineStoragePathAllowed(rootPath, agent.policy.allowedDirs, platform)) {
        return reply.code(403).send({ error: 'Путь находится вне разрешённых директорий машины' })
      }
      const existing = db.listMachineStorages(userId)
      const registered = existing.find((storage) => storage.machineId === machineId && storage.rootPath === rootPath)
      const separator = platform === 'win32' ? '\\' : '/'
      const child = (name: string): string => rootPath + separator + name.replace(/[\\/]/g, separator)
      try {
        const foundMarker = await markerAt(machineId, rootPath, platform)
        if (foundMarker) {
          const owner = existing.find((storage) => storage.id === foundMarker.id)
          if (owner && (owner.machineId !== machineId || owner.rootPath !== rootPath)) {
            return reply.code(409).send({ error: 'Конфликт marker: storageId уже зарегистрирован для другого каталога' })
          }
          if (registered && foundMarker.id !== registered.id) {
            return reply.code(409).send({ error: 'Конфликт marker: каталог и запись сервера относятся к разным хранилищам' })
          }
          if (foundMarker.formatVersion !== MACHINE_STORAGE_FORMAT_VERSION) {
            return reply.code(409).send({ error: `Неподдерживаемая версия marker: ${foundMarker.formatVersion}` })
          }
        }
        const storageId = registered?.id ?? foundMarker?.id ?? randomUUID()
        for (const directory of [rootPath, child('.voicechat'), child('.voicechat/index'), child('.voicechat/locks'), child('.voicechat/migrations'), child('.voicechat/temporary')]) {
          await registry.fsMkdir(machineId, directory)
        }
        await registry.fsList(machineId, rootPath)
        if (!foundMarker) {
          const marker = JSON.stringify({ id: storageId, formatVersion: MACHINE_STORAGE_FORMAT_VERSION }, null, 2) + '\n'
          await registry.fsWrite(machineId, child('.voicechat/storage.json'), Buffer.from(marker).toString('base64'))
          const verified = await markerAt(machineId, rootPath, platform)
          if (!verified || verified.id !== storageId) throw new Error('Не удалось проверить записанный marker хранилища')
        }
        return db.saveMachineStorage(userId, machineId, rootPath, MACHINE_STORAGE_FORMAT_VERSION, storageId)
      } catch (error) {
        return reply.code(400).send({ error: storageError(error) })
      }
    }
  )

  app.get<{ Params: { id: string } }>('/api/conversations/:id/storage', async (req, reply) => {
    const binding = db.getChatStorageBinding(uid(req), req.params.id)
    if (!binding) return reply.code(404).send({ error: 'not found' })
    return binding
  })

  app.put<{ Params: { id: string }; Body: { machineId?: string; storageId?: string; relativePath?: string } }>(
    '/api/conversations/:id/storage',
    async (req, reply) => {
      const userId = uid(req)
      const conversation = db.getConversation(userId, req.params.id)
      if (!conversation) return reply.code(404).send({ error: 'not found' })
      const machineId = req.body?.machineId
      const storageId = req.body?.storageId
      let relativePath = req.body?.relativePath
      if (!machineId || !storageId) return reply.code(400).send({ error: 'machineId and storageId required' })
      if (!relativePath) {
        relativePath = conversation.taskId && conversation.projectId
          ? recommendedChatStoragePath({ kind: 'task', projectId: conversation.projectId, taskId: conversation.taskId, conversationId: conversation.id })
          : conversation.projectId
            ? recommendedChatStoragePath({ kind: 'project', projectId: conversation.projectId, conversationId: conversation.id })
            : recommendedChatStoragePath({ kind: 'chat', conversationId: conversation.id })
      }
      try {
        await ensureManagedChat(userId, machineId, storageId, relativePath, conversation)
        return db.saveChatStorageBinding(userId, {
          conversationId: conversation.id,
          machineId,
          storageId,
          relativePath
        })
      } catch (error) {
        return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) })
      }
    }
  )

  app.get<{ Params: { id: string }; Querystring: { projectId?: string } }>(
    '/api/conversations/:id/machines',
    async (req, reply) => {
      const userId = uid(req)
      const conversation = db.getConversation(userId, req.params.id)
      if (!conversation) return reply.code(404).send({ error: 'not found' })
      const projectId = req.query.projectId ?? conversation.projectId
      const machines = withLiveStatus(db.listUsableAgents(userId, projectId))
      const personalDefault = projectId
        ? db.getUserProjectDefaultMachine(userId, projectId)
        : db.getSettings(userId).defaultAgentId
      // Каталог помечает effective именно для опции «наследовать»; явный
      // conversation.execTarget выбран самим <select> и не подменяет её подпись.
      const resolution = db.resolveConversationMachine(userId, conversation.id, {
        execTarget: null,
        projectId,
        isOnline: (agentId) => registry.isOnline(agentId)
      })
      return machines.map((machine) => ({
        ...machine,
        isDefault: machine.id === personalDefault,
        isEffective: machine.id === resolution?.agentId && resolution.error === null,
        ...(machine.id === resolution?.agentId && resolution.error === null && (resolution.source === 'personal_default' || resolution.source === 'fallback')
          ? { effectiveSource: resolution.source }
          : {})
      }))
    }
  )

  // Управление машиной — только владелец; использование может быть делегировано
  // проектом, но лишь при явном projectId в конкретной операции.
  const ownsAgent = (userId: string, id: string): boolean =>
    db.listAgents(userId).some((a) => a.id === id)
  const canUseAgent = (userId: string, id: string, projectId?: string): boolean =>
    db.canUseAgent(userId, id, projectId)

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
    // Удалили legacy-цель выполнения или машину по умолчанию — возвращаемся на
    // сервер. Дефолт обязателен: он подставляется в новые разговоры, и висячий id
    // удалённой машины давал бы ход с ошибкой «машина не найдена».
    const settings = db.getSettings(u)
    if (settings.execTarget === id || settings.defaultAgentId === id) {
      db.saveSettings(u, {
        ...settings,
        ...(settings.execTarget === id ? { execTarget: null } : {}),
        ...(settings.defaultAgentId === id ? { defaultAgentId: null } : {})
      })
    }
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
          `Start-Process -WindowStyle Hidden powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',$p -RedirectStandardOutput \"$env:USERPROFILE\\voicechat-update.log\" -RedirectStandardError \"$env:USERPROFILE\\voicechat-update.err.log\""`
        : `(setsid nohup bash -lc ${shellQuote(installCommand(os, base))} > "$HOME/voicechat-update.log" 2>&1 < /dev/null &) ; echo update-started`
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
    req: { params: { id: string }; query?: { projectId?: string } },
    reply: FastifyReply,
    run: (id: string) => Promise<unknown>
  ): Promise<unknown> => {
    const u = uid(req as never)
    if (!canUseAgent(u, req.params.id, req.query?.projectId)) return reply.code(404).send({ error: 'not found' })
    try {
      return await run(req.params.id)
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) })
    }
  }

  app.get<{ Params: { id: string }; Querystring: { path?: string; projectId?: string } }>(
    '/api/agents/:id/fs',
    async (req, reply) => withFs(req, reply, (id) => registry.fsList(id, req.query.path ?? ''))
  )
  app.get<{ Params: { id: string }; Querystring: { path?: string; projectId?: string } }>(
    '/api/agents/:id/fs/file',
    async (req, reply) => withFs(req, reply, (id) => registry.fsRead(id, req.query.path ?? ''))
  )
  app.post<{ Params: { id: string }; Querystring: { projectId?: string }; Body: { path?: string; dataBase64?: string } }>(
    '/api/agents/:id/fs/file',
    { bodyLimit: 48 * 1024 * 1024 }, // ~32 МБ файла + запас base64
    async (req, reply) =>
      withFs(req, reply, (id) => registry.fsWrite(id, req.body?.path ?? '', req.body?.dataBase64 ?? ''))
  )
  app.delete<{ Params: { id: string }; Querystring: { path?: string; projectId?: string } }>(
    '/api/agents/:id/fs',
    async (req, reply) => withFs(req, reply, (id) => registry.fsDelete(id, req.query.path ?? ''))
  )
  app.post<{ Params: { id: string }; Querystring: { projectId?: string }; Body: { from?: string; to?: string } }>(
    '/api/agents/:id/fs/rename',
    async (req, reply) =>
      withFs(req, reply, (id) => registry.fsRename(id, req.body?.from ?? '', req.body?.to ?? ''))
  )
  app.post<{ Params: { id: string }; Querystring: { projectId?: string }; Body: { path?: string } }>(
    '/api/agents/:id/fs/mkdir',
    async (req, reply) => withFs(req, reply, (id) => registry.fsMkdir(id, req.body?.path ?? ''))
  )

  // Утилита «Консоль»: выполнить команду на своей машине (проверка политики — в registry.exec).
  app.post<{ Params: { id: string }; Querystring: { projectId?: string }; Body: { command?: string } }>(
    '/api/agents/:id/exec',
    async (req, reply) => {
      // Кнопка «Стоп» в консоли = обрыв этого запроса: сигнал доходит до
      // registry.exec, тот шлёт агенту exec.cancel и снимает дерево процессов
      // на машине. Слушаем close ОТВЕТА, а не запроса: у req.raw 'close'
      // срабатывает сразу после чтения тела и отменял бы команду мгновенно
      // (та же грабля, что в mcp/remoteBashMcp.ts).
      const abort = new AbortController()
      reply.raw.on('close', () => {
        if (!reply.raw.writableEnded) abort.abort()
      })
      return withFs(req, reply, (id) =>
        registry.exec(id, req.body?.command ?? '', EXEC_TIMEOUT_MS, abort.signal)
      )
    }
  )
}

/** Таймаут пользовательской команды консоли. */
const EXEC_TIMEOUT_MS = 60_000
