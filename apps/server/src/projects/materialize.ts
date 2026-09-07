// Подготовка managed-каталогов машины проекта: создаёт каноническое дерево
// директорий и marker project.json на машине через companion-агента. Вынесено из
// registerProjectRoutes, чтобы тем же кодом пользовался bootstrap прод-машины —
// иначе привязка через UI и авто-подготовка разошлись бы по логике каталогов.

import {
  isMachineStoragePathAllowed,
  recommendedProjectMachineDirectories,
  validateProjectMachineDirectories,
  type ProjectMachineDirectoryAssignments,
  type ProjectMachineDirectoryKind
} from '@voicechat/shared'
import type { VoiceChatDb } from '../db/database.js'
import type { AgentRegistry } from '../agents/registry.js'

export async function materializeProjectMachine(
  db: VoiceChatDb,
  agents: AgentRegistry,
  userId: string,
  projectId: string,
  agentId: string,
  storageId: string,
  directories?: ProjectMachineDirectoryAssignments
): Promise<void> {
  if (!agents.isOnline(agentId)) throw new Error('Машина не в сети: каталоги нельзя подготовить')
  const storage = db.machines.listMachineStorages(userId, agentId).find((item) => item.id === storageId)
  if (!storage) throw new Error('Хранилище не принадлежит выбранной машине')
  const platform = agents.platformOf(agentId) ?? 'linux'
  const separator = platform === 'win32' ? '\\' : '/'
  const storageMarkerPath = storage.rootPath + separator + ['.voicechat', 'storage.json'].join(separator)
  const storageMarkerResult = await agents.fsRead(agentId, storageMarkerPath)
  let storageMarker: { id?: unknown; formatVersion?: unknown }
  try { storageMarker = JSON.parse(Buffer.from(storageMarkerResult.dataBase64 ?? '', 'base64').toString('utf8')) as { id?: unknown; formatVersion?: unknown } }
  catch { throw new Error('Повреждён marker .voicechat/storage.json') }
  if (storageMarker.id !== storage.id || storageMarker.formatVersion !== storage.formatVersion) throw new Error('Marker хранилища отсутствует или конфликтует')
  const recommendations = recommendedProjectMachineDirectories(storage.rootPath, projectId, platform)
  const defaults = Object.fromEntries(Object.entries(recommendations).map(([kind, path]) => [kind, { path, override: false }])) as ProjectMachineDirectoryAssignments
  const current = db.projects.getProject(userId, projectId)?.machines.find((item) => item.agentId === agentId)
  const changingStorage = !!current?.storageId && current.storageId !== storageId
  let candidate = directories && changingStorage
    ? Object.fromEntries(Object.entries(defaults).map(([kind, value]) => [kind, directories[kind as ProjectMachineDirectoryKind]?.override ? directories[kind as ProjectMachineDirectoryKind] : value])) as ProjectMachineDirectoryAssignments
    : directories ?? defaults
  if (!directories && current && !current.storageId) {
    candidate = structuredClone(defaults)
    if (current.path.trim()) candidate.projectWorkdir = { path: current.path, override: true }
    if (current.reposRoot.trim()) candidate.reposRoot = { path: current.reposRoot, override: true }
  }
  const assignments = validateProjectMachineDirectories(candidate, storage.rootPath, projectId, platform)
  const allowedDirs = agents.policyOf(agentId)?.allowedDirs ?? []
  for (const assignment of Object.values(assignments)) {
    if (!isMachineStoragePathAllowed(assignment.path, allowedDirs, platform)) throw new Error('Каталог находится вне разрешённых директорий машины')
  }
  for (const assignment of Object.values(assignments)) await agents.fsMkdir(agentId, assignment.path)
  const projectRoot = storage.rootPath + separator + ['projects', projectId].join(separator)
  await agents.fsMkdir(agentId, projectRoot)
  const markerPath = projectRoot + separator + 'project.json'
  try {
    const result = await agents.fsRead(agentId, markerPath)
    const marker = JSON.parse(Buffer.from(result.dataBase64 ?? '', 'base64').toString('utf8')) as { projectId?: unknown; formatVersion?: unknown }
    if (marker.projectId !== projectId || marker.formatVersion !== 1) throw new Error('Конфликт marker project.json')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!/ENOENT|not found|no such|не найден/i.test(message)) throw error
    const marker = JSON.stringify({ formatVersion: 1, projectId }, null, 2) + '\n'
    await agents.fsWrite(agentId, markerPath, Buffer.from(marker).toString('base64'))
  }
}
