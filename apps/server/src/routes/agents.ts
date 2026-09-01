// REST для машин-агентов: список (с онлайн-статусом), создание (одноразовый
// токен), удаление (отзыв токена + разрыв соединения).

import { randomUUID } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  REST,
  AGENT_VERSION,
  MACHINE_STORAGE_FORMAT_VERSION,
  chatStorageDirectories,
  type ChatStorageView,
  type FsCopyResult,
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
  type AgentPolicy,
  BATCH_MAX_MACHINES,
  BATCH_OUTPUT_LIMIT,
  type BatchExecItem,
  type BatchExecResult,
  LOGIN_ENROLLMENT_TTL_MS,
  loginEnrollmentDeepLink,
} from '@voicechat/shared'
import type { VoiceChatDb } from '../db/database.js'
import { uid } from '../users/auth.js'
import type { AgentRegistry } from '../agents/registry.js'
import { ensureDefaultStorage } from '../agents/defaultStorage.js'
import type { CommandGate } from '../agents/commandGate.js'
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
  loginApplicationMacosArm64?: string
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

/** Внешний адрес сервера, каким его видит машина (учитывает x-forwarded-*). */
function externalBase(req: FastifyRequest): string {
  const fwdProto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim()
  const fwdHost = String(req.headers['x-forwarded-host'] ?? '').split(',')[0].trim()
  const proto = fwdProto || req.protocol
  const host = fwdHost || req.headers.host || ''
  return `${proto}://${host}`
}

/** Локальные адреса машине недостижимы — тогда нужен VC_PUBLIC_URL. */
function reachableFromMachine(base: string): boolean {
  try {
    const host = new URL(base).hostname.replace(/^\[|\]$/g, '')
    return !(host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost'))
  } catch {
    return false
  }
}

/**
 * Обновление агента на машине: тот же установщик, что при первой установке, запущенный detached,
 * чтобы пережить смерть старого агента. Общий для владельца (`/api/agents/:id/update`) и админки
 * (`/api/admin/machines/:id/update`). Ошибки возвращаются как {status, error} — роут решает, как ответить.
 */
export async function updateAgentOnMachine(registry: AgentRegistry, id: string, req: FastifyRequest): Promise<{ ok: true; os: string; output: string } | { status: number; error: string }> {
  if (!registry.isOnline(id)) {
    return { status: 409, error: 'Машина не в сети — обновить можно только запущенного агента' }
  }
  const telemetry = registry.telemetryOf(id)
  const os = telemetry ? agentOsFromPlatform(telemetry.os.platform, telemetry.os.isAndroid) : null
  if (!os) {
    return { status: 409, error: 'Не удалось определить ОС машины (нужна телеметрия агента 0.4+). Обновите вручную командой из настроек.'
    }
  }
  // Адрес, по которому машина достанет установщик. Берём тот, по которому пришёл
  // запрос; если он локальный (dev, проброс порта) — нужен явный VC_PUBLIC_URL,
  // иначе команда уйдёт в саму машину и обновление тихо не случится.
  const requestBase = externalBase(req)
  const base = reachableFromMachine(requestBase)
    ? requestBase
    : (process.env.VC_PUBLIC_URL ?? '').replace(/\/+$/, '')
  if (!base) {
    return { status: 409, error: `Сервер видит себя как ${requestBase} — с машины такой адрес недостижим. ` +
        'Задайте VC_PUBLIC_URL или скопируйте команду обновления и запустите её на машине.'
    }
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
    return { ok: true as const, os, output: res.output.slice(0, 2000) }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // Гейт политики проверяется и на сервере, и на агенте: обновление качает
    // скрипт и пишет файлы, поэтому машине с запретом сети/записи оно не пройдёт.
    const hint = msg.includes('политикой')
      ? ' Разрешите машине сеть и запись файлов (или обновите вручную командой из списка машин).'
      : ''
    return { status: 502, error: msg + hint }
  }
}

export async function registerAgentRoutes(
  app: FastifyInstance,
  db: VoiceChatDb,
  registry: AgentRegistry,
  artifacts: AppArtifacts = {},
  commandGate?: CommandGate
): Promise<void> {
  const withLiveStatus = (agents: ReturnType<VoiceChatDb['listAgents']>, userId?: string, projectId?: string | null): AgentInfo[] => {
    const online = registry.onlineIds()
    return agents.map((a) => ({
      ...a,
      // Личная машина или предоставленная проектом, и права на неё (п.18).
      ...(userId ? { ownership: (a.userId === userId ? 'personal' : 'project') as 'personal' | 'project', access: db.machineAccess(userId, a.id, projectId) ?? undefined } : {}),
      online: online.has(a.id),
      version: registry.versionOf(a.id),
      telemetry: registry.telemetryOf(a.id),
      imageHost: registry.imageHostOf(a.id)
    }))
  }

  app.get(REST.agents, async (req): Promise<AgentInfo[]> =>
    withLiveStatus(db.listAgents(uid(req)), uid(req))
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
    // environment.json managed-окружений НЕ пишем здесь: его identity (machineId,
    // storageId, canonical createdAt) знают только релиз- и preview-менеджеры,
    // и они стамповывают манифест лениво. Заглушка bootstrap с другой формой
    // (без machineId/storageId, taskId:null, createdAt=now) «отравляла» каталог —
    // релиз-менеджер не перезаписывает существующий файл (if [ ! -e ]), и preflight
    // деплоя падал на сравнении манифеста (400). Каталоги окружений создаются выше.
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
    const userId = uid(req)
    const binding = db.getChatStorageBinding(userId, req.params.id)
    if (!binding) return reply.code(404).send({ error: 'not found' })
    // Карточке чата нужны абсолютные каталоги и состояние хранилища, а не только id.
    const storage = db.listMachineStorages(userId, binding.machineId).find((item) => item.id === binding.storageId)
    if (!storage) return binding satisfies ChatStorageView
    const status: ChatStorageView['status'] = registry.isOnline(binding.machineId) ? storage.status : 'offline'
    return { ...binding, rootPath: storage.rootPath, status, directories: chatStorageDirectories(storage.rootPath, binding.relativePath) } satisfies ChatStorageView
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
      const machines = withLiveStatus(db.listUsableAgents(userId, projectId), userId, projectId)
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

  // Реестр расширяем по platform/arch; на первом этапе доступна только macOS ARM64.
  app.get<{ Querystring: { platform?: string; arch?: string } }>(REST.loginApplicationArtifacts, async (req) => {
    const entries = [{
      platform: 'macos' as const,
      arch: 'arm64' as const,
      available: Boolean(artifacts.loginApplicationMacosArm64 && existsSync(artifacts.loginApplicationMacosArm64)),
      downloadUrl: REST.loginApplicationDownload + '?platform=macos&arch=arm64',
      filename: 'voicechat-login-macos-arm64.dmg'
    }]
    if (!req.query.platform && !req.query.arch) return entries
    return entries.filter((item) =>
      (!req.query.platform || item.platform === req.query.platform) &&
      (!req.query.arch || item.arch === req.query.arch)
    )
  })
  app.get<{ Querystring: { platform?: string; arch?: string } }>(REST.loginApplicationDownload, async (req, reply) => {
    if (req.query.platform !== 'macos' || req.query.arch !== 'arm64') {
      return reply.code(404).send({ error: 'Сборка для этой платформы и архитектуры недоступна' })
    }
    return sendDmg(reply, artifacts.loginApplicationMacosArm64, 'voicechat-login-macos-arm64.dmg', 'npm --prefix apps/login-application run dist')
  })

  app.post(REST.loginEnrollmentIssue, async (req) => {
    const enrollment = db.createLoginEnrollment(uid(req), LOGIN_ENROLLMENT_TTL_MS)
    return {
      enrollmentToken: enrollment.token,
      statusId: enrollment.statusId,
      expiresAt: enrollment.expiresAt,
      deepLink: loginEnrollmentDeepLink(enrollment.token, enrollment.statusId, externalBase(req))
    }
  })
  app.get<{ Params: { id: string } }>('/api/login-application/enrollments/:id', async (req, reply) => {
    const status = db.getLoginEnrollmentStatus(uid(req), req.params.id)
    return status ?? reply.code(404).send({ error: 'not found' })
  })
  app.post<{ Body: { token?: string; name?: string } }>(REST.loginEnrollmentRedeem, async (req, reply) => {
    const token = req.body?.token?.trim() ?? ''
    const name = req.body?.name?.trim() ?? ''
    if (!token || !name) return reply.code(400).send({ error: 'token and name required' })
    const result = db.redeemLoginEnrollment(token, name)
    if (!result) return reply.code(409).send({ error: 'Enrollment недействителен, просрочен или уже использован' })
    return { agentId: result.id, name: result.name, machineToken: result.token, serverUrl: externalBase(req) }
  })

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
    const result = await updateAgentOnMachine(registry, id, req)
    if ('status' in result) return reply.code(result.status).send({ error: result.error })
    return result
  })

  // Перевыпуск токена: старый перестаёт работать, текущее соединение рвём.
  app.post<{ Params: { id: string }; Body: { ttlDays?: number } | undefined }>('/api/agents/:id/token', async (req, reply) => {
    const u = uid(req)
    if (!ownsAgent(u, req.params.id)) return reply.code(404).send({ error: 'not found' })
    const ttlDays = typeof req.body?.ttlDays === 'number' && Number.isFinite(req.body.ttlDays) ? Math.max(0, Math.min(3650, req.body.ttlDays)) : undefined
    const { token, expiresAt } = db.regenerateAgentToken(u, req.params.id, ttlDays ? ttlDays * 24 * 60 * 60_000 : undefined)
    registry.disconnect(req.params.id)
    db.logSecurityEvent({ user: u, type: 'agent_token_rotated', details: `${registry.nameOf(req.params.id) ?? req.params.id}${expiresAt ? ` до ${new Date(expiresAt).toISOString()}` : ' (бессрочный)'}` })
    return { token, expiresAt }
  })

  // Отзыв токена (п.11): агент отключается и больше не подключится, пока токен не перевыпустят.
  app.delete<{ Params: { id: string } }>('/api/agents/:id/token', async (req, reply) => {
    const u = uid(req)
    if (!ownsAgent(u, req.params.id)) return reply.code(404).send({ error: 'not found' })
    const name = db.listAgents(u).find((a) => a.id === req.params.id)?.name ?? req.params.id
    db.revokeAgentToken(req.params.id)
    registry.disconnect(req.params.id)
    db.logSecurityEvent({ user: u, type: 'agent_token_revoked', details: name })
    return { ok: true }
  })

  app.post<{ Params: { id: string }; Body: { pin?: boolean } | undefined }>(REST.agentPinIp(':id').replace('%3Aid', ':id'), async (req, reply) => {
    const u = uid(req)
    if (!ownsAgent(u, req.params.id)) return reply.code(404).send({ error: 'not found' })
    db.setAgentPinIp(u, req.params.id, req.body?.pin === true)
    return { ok: true }
  })

  // --- Файловый проводник по машине (все под проверкой владения) ---
  /** Проверка владения + читаемый ответ на ошибки агента (офлайн/политика). */
  /** Только чтение (машина предоставлена проекту в режиме `read`) — мутации запрещены (п.18). */
  const READ_ONLY_ERROR = 'Машина предоставлена проекту только для чтения: команды, терминал и запись файлов запрещены'
  const withFs = async (
    req: { params: { id: string }; query?: { projectId?: string } },
    reply: FastifyReply,
    run: (id: string) => Promise<unknown>,
    mutates = false
  ): Promise<unknown> => {
    const u = uid(req as never)
    if (!canUseAgent(u, req.params.id, req.query?.projectId)) return reply.code(404).send({ error: 'not found' })
    if (mutates && !db.canWriteAgent(u, req.params.id, req.query?.projectId)) return reply.code(403).send({ error: READ_ONLY_ERROR })
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
      withFs(req, reply, (id) => registry.fsWrite(id, req.body?.path ?? '', req.body?.dataBase64 ?? ''), true)
  )
  app.delete<{ Params: { id: string }; Querystring: { path?: string; projectId?: string } }>(
    '/api/agents/:id/fs',
    async (req, reply) => withFs(req, reply, (id) => registry.fsDelete(id, req.query.path ?? ''), true)
  )
  app.post<{ Params: { id: string }; Querystring: { projectId?: string }; Body: { from?: string; to?: string } }>(
    '/api/agents/:id/fs/rename',
    async (req, reply) =>
      withFs(req, reply, (id) => registry.fsRename(id, req.body?.from ?? '', req.body?.to ?? ''), true)
  )
  app.post<{ Params: { id: string }; Querystring: { projectId?: string }; Body: { path?: string } }>(
    '/api/agents/:id/fs/trash',
    async (req, reply) => withFs(req, reply, (id) => registry.fsTrash(id, req.body?.path ?? ''), true)
  )
  // Копирование между машинами: сервер — посредник (fs.read на источнике → fs.mkdir/fs.write на цели),
  // прямого канала между агентами нет. Без targetDir файл ложится в `<ChatAI цели>/incoming`.
  app.post<{ Params: { id: string }; Querystring: { projectId?: string }; Body: { path?: string; targetAgentId?: string; targetDir?: string } }>(
    '/api/agents/:id/fs/copy-to',
    async (req, reply) => {
      const u = uid(req)
      const { path, targetAgentId, targetDir } = req.body ?? {}
      if (!path || !targetAgentId) return reply.code(400).send({ error: 'нужны path и targetAgentId' })
      if (!canUseAgent(u, req.params.id, req.query?.projectId) || !canUseAgent(u, targetAgentId, req.query?.projectId)) return reply.code(404).send({ error: 'not found' })
      if (!db.canWriteAgent(u, targetAgentId, req.query?.projectId)) return reply.code(403).send({ error: READ_ONLY_ERROR })
      if (targetAgentId === req.params.id) return reply.code(400).send({ error: 'Источник и цель — одна машина' })
      if (!registry.isOnline(targetAgentId)) return reply.code(409).send({ error: 'Целевая машина не в сети' })
      if (registry.policyOf(targetAgentId)?.allowWrite === false) return reply.code(403).send({ error: 'Запись на целевую машину запрещена политикой' })
      try {
        const source = await registry.fsRead(req.params.id, path)
        const name = source.name ?? path.split(/[\\/]/).pop() ?? 'file'
        let dir = targetDir?.trim() ?? ''
        if (!dir) {
          const storage = await ensureDefaultStorage({ db, registry }, u, targetAgentId)
          if (!storage) return reply.code(409).send({ error: 'На целевой машине нет хранилища ChatAI — укажите каталог' })
          dir = storagePath(storage.rootPath, registry.platformOf(targetAgentId) ?? 'linux', 'incoming')
        }
        await registry.fsMkdir(targetAgentId, dir)
        const separator = dir.includes('\\') && !dir.includes('/') ? '\\' : '/'
        const dest = `${dir.replace(/[\\/]+$/, '')}${separator}${name}`
        await registry.fsWrite(targetAgentId, dest, source.dataBase64 ?? '')
        const result: FsCopyResult = { path: dest, targetAgentId, size: Buffer.from(source.dataBase64 ?? '', 'base64').byteLength }
        return result
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) })
      }
    }
  )
  app.post<{ Params: { id: string }; Querystring: { projectId?: string }; Body: { path?: string } }>(
    '/api/agents/:id/fs/mkdir',
    async (req, reply) => withFs(req, reply, (id) => registry.fsMkdir(id, req.body?.path ?? ''), true)
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
      if (commandGate) {
        const verdict = commandGate({ command: req.body?.command ?? '', userId: uid(req), projectId: req.query?.projectId ?? null, source: 'console' })
        if (!verdict.allowed) return reply.code(403).send({ error: `Запрещено: ${verdict.reason ?? 'политика команд'}` })
      }
      return withFs(req, reply, (id) =>
        registry.exec(id, req.body?.command ?? '', EXEC_TIMEOUT_MS, abort.signal, { source: 'console', userId: uid(req) })
      , true)
    }
  )

  // Групповая команда (п.15): одна команда на несколько машин пользователя, сводка по каждой.
  app.post<{ Querystring: { projectId?: string }; Body: { machineIds?: string[]; command?: string } }>(
    REST.agentsExecBatch,
    async (req, reply) => {
      const u = uid(req)
      const command = (req.body?.command ?? '').trim()
      const ids = [...new Set(req.body?.machineIds ?? [])].slice(0, BATCH_MAX_MACHINES)
      if (!command || ids.length === 0) return reply.code(400).send({ error: 'нужны machineIds и command' })
      if (commandGate) {
        const verdict = commandGate({ command, userId: u, projectId: req.query?.projectId ?? null, source: 'console' })
        if (!verdict.allowed) return reply.code(403).send({ error: `Запрещено: ${verdict.reason ?? 'политика команд'}` })
      }
      const startedAt = Date.now()
      const items: BatchExecItem[] = await Promise.all(ids.map(async (machineId) => {
        const machineName = registry.nameOf(machineId) ?? db.listAgents(u).find((a) => a.id === machineId)?.name ?? machineId
        const base = { machineId, machineName, exitCode: null, timedOut: false, output: '', durationMs: 0 }
        if (!canUseAgent(u, machineId, req.query?.projectId)) return { ...base, ran: false, error: 'Машина недоступна' }
        if (!db.canWriteAgent(u, machineId, req.query?.projectId)) return { ...base, ran: false, error: 'Только чтение: команды запрещены' }
        const at = Date.now()
        try {
          const res = await registry.exec(machineId, command, EXEC_TIMEOUT_MS, undefined, { source: 'console', userId: u })
          return { machineId, machineName, ran: true, exitCode: res.exitCode, timedOut: res.timedOut, output: res.output.slice(0, BATCH_OUTPUT_LIMIT), error: null, durationMs: Date.now() - at }
        } catch (err) {
          return { ...base, ran: false, error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - at }
        }
      }))
      const result: BatchExecResult = {
        command, startedAt, items,
        totals: {
          requested: ids.length,
          ok: items.filter((i) => i.ran && i.exitCode === 0 && !i.timedOut).length,
          failed: items.filter((i) => i.ran && (i.exitCode !== 0 || i.timedOut)).length,
          skipped: items.filter((i) => !i.ran).length
        }
      }
      return result
    }
  )

  // Журнал команд машины (п.4): новые сверху, фильтр по подстроке и источнику; ?format=csv — экспорт.
  app.get<{ Params: { id: string }; Querystring: { projectId?: string; limit?: string; q?: string; source?: string; format?: string } }>(
    '/api/agents/:id/commands',
    async (req, reply) => {
      const u = uid(req)
      if (!canUseAgent(u, req.params.id, req.query?.projectId)) return reply.code(404).send({ error: 'not found' })
      const source = req.query.source === 'console' || req.query.source === 'chat' || req.query.source === 'system' ? req.query.source : undefined
      const limit = req.query.limit ? Number(req.query.limit) : undefined
      const rows = db.listMachineCommands(req.params.id, { limit: Number.isFinite(limit) ? limit : undefined, q: req.query.q, source })
      if (req.query.format === 'csv') {
        const cell = (v: unknown): string => `"${String(v ?? '').replace(/"/g, '""')}"`
        const lines = ['startedAt,user,source,command,exitCode,timedOut,durationMs,conversationId,error']
        for (const r of rows) lines.push([new Date(r.startedAt).toISOString(), r.userId, r.source, r.command, r.exitCode ?? '', r.timedOut, r.durationMs, r.conversationId ?? '', r.error ?? ''].map(cell).join(','))
        return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="commands-${req.params.id}.csv"`).send(lines.join('\n') + '\n')
      }
      return rows
    }
  )
}

/** Таймаут пользовательской команды консоли. */
const EXEC_TIMEOUT_MS = 60_000
