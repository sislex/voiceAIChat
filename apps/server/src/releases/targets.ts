// Куда выпускать релиз: рабочая копия релизной машины и production-цель.
//
// Живёт отдельно от роутов, потому что теперь это спрашивают двое: REST
// (кнопки Release Center) и канбан-ассистент (инструменты release_*). Правила
// «какая машина, какой путь, что обязательно настроено» обязаны быть одни —
// иначе ассистент выпускает не туда, куда кнопка.

import { DEFAULT_RELEASE_TIMEOUTS, type ApplicationEnvironmentName } from '@voicechat/shared'
import type { ReleaseMachineCatalog } from '@voicechat/shared'
import type { VoiceChatDb } from '../db/database.js'
import type { ManagedEnvironmentResolver } from './managedEnvironmentResolver.js'
import type { ProductionTarget, ReleaseManager, ReleaseProjectTarget } from './releaseManager.js'

const DEFAULT_TEST_COMMAND = 'npm run gate:all'

export async function releaseMachineCatalog(
  db: VoiceChatDb,
  releases: Pick<ReleaseManager, 'isOnline'>,
  userId: string,
  projectId: string
): Promise<ReleaseMachineCatalog> {
  const project = await db.projects.getProject(userId, projectId)
  if (!project) throw new Error('Проект не найден или недоступен')
  const usable = await db.machines.listUsableAgents(userId, projectId)
  const machines = await Promise.all(usable.map(async (agent) => {
    const configured = project.machines.find((item) => item.agentId === agent.id)
    const access = await db.machines.machineAccess(userId, agent.id, projectId)
    const online = releases.isOnline(agent.id)
    const path = configured?.path?.trim() ?? ''
    const reposRoot = configured?.reposRoot?.trim() ?? ''
    const unavailableReason = access !== 'owner' && access !== 'full'
      ? 'Только чтение: для сборки нужен полный доступ'
      : !online
        ? 'Машина offline'
        : !path && !reposRoot
          ? 'Не настроена папка проекта или reposRoot'
          : null
    return {
      agentId: agent.id,
      name: agent.name,
      ownership: access === 'owner' ? 'mine' as const : 'project' as const,
      access: access ?? 'read',
      online,
      path,
      reposRoot,
      eligible: unavailableReason === null,
      unavailableReason
    }
  }))
  return { machines, lastAgentId: await db.machines.getUserProjectReleaseMachine(userId, projectId) }
}

/** Бросает с человеческим текстом: он же уходит и в 400 REST, и в ответ инструмента. */
export async function releaseCiTarget(
  db: VoiceChatDb,
  releases: Pick<ReleaseManager, 'isOnline'>,
  userId: string,
  projectId: string,
  requestedAgentId?: string
): Promise<ReleaseProjectTarget> {
  const value = await db.projects.getProject(userId, projectId)
  if (!value) throw new Error('Проект не найден или недоступен')
  const catalog = await releaseMachineCatalog(db, releases, userId, projectId)
  const selected = requestedAgentId
    ? catalog.machines.find((item) => item.agentId === requestedAgentId)
    : catalog.machines.find((item) => item.agentId === catalog.lastAgentId && item.eligible) ?? catalog.machines.find((item) => item.eligible)
  if (!selected) throw new Error(requestedAgentId ? 'Выбранная машина недоступна для этого проекта' : 'Нет пригодной машины для сборки релиза')
  if (!selected.eligible) throw new Error(selected.unavailableReason ?? 'Выбранная машина непригодна для сборки релиза')
  if (!await db.machines.canWriteAgent(userId, selected.agentId, projectId)) throw new Error('Для сборки релиза нужен полный доступ к машине')
  if (!value.gitUrl) throw new Error('Для проекта не задан gitUrl')
  const root = selected.reposRoot.replace(/[\\/]+$/, '')
  return {
    projectId,
    agentId: selected.agentId,
    path: selected.path || `${root}/.release_repo`,
    prepareCheckout: !selected.path,
    gitUrl: value.gitUrl,
    baseBranch: value.ciBaseBranch || 'main',
    testCommand: value.testCommand?.trim() || DEFAULT_TEST_COMMAND,
    limits: value.releaseTimeouts ?? DEFAULT_RELEASE_TIMEOUTS
  }
}

/** null — выкладывать некуда: production не настроен до конца. */
export async function releaseProductionTarget(
  db: VoiceChatDb,
  managed: ManagedEnvironmentResolver,
  userId: string,
  projectId: string
): Promise<ProductionTarget | null> {
  const value = await db.projects.getProject(userId, projectId)
  const agentId = value?.productionAgentId
  const linked = agentId ? value?.machines.some((item) => item.agentId === agentId) : false
  if (!value || !agentId || !linked || !value.productionDeployCommand || !value.productionHealthCheckCommand || !value.gitUrl) return null
  if (value.productionEnvironmentMode === 'managed') return (await managed.resolve(userId, projectId, 'production')).target
  if (!value.productionCheckoutPath) return null
  return {
    projectId,
    agentId,
    path: value.productionCheckoutPath,
    prepareCheckout: false,
    gitUrl: value.gitUrl,
    baseBranch: value.ciBaseBranch || 'main',
    testCommand: value.testCommand?.trim() || DEFAULT_TEST_COMMAND,
    deployCommand: value.productionDeployCommand,
    healthCheckCommand: value.productionHealthCheckCommand,
    expectedRepository: value.gitUrl,
    limits: value.releaseTimeouts ?? DEFAULT_RELEASE_TIMEOUTS,
    mode: 'legacy'
  }
}

/** Компонентный исполнитель использует applications.json, а не legacy deployCommand. */
export async function releaseApplicationTarget(db: VoiceChatDb, managed: ManagedEnvironmentResolver, userId: string, projectId: string, kind: ApplicationEnvironmentName): Promise<(ReleaseProjectTarget & {managedRoot?: string}) | null> {
  const project = await db.projects.getProject(userId, projectId)
  if (!project) return null
  if (project.productionEnvironmentMode === 'managed') return (await managed.resolve(userId, projectId, kind)).target
  if (kind !== 'production' || !project.productionAgentId || !project.productionCheckoutPath || !project.gitUrl || !project.machines.some(item => item.agentId === project.productionAgentId)) return null
  return {projectId, agentId: project.productionAgentId, path: project.productionCheckoutPath, gitUrl: project.gitUrl, prepareCheckout: false, baseBranch: project.ciBaseBranch || 'main', testCommand: DEFAULT_TEST_COMMAND, limits: project.releaseTimeouts ?? DEFAULT_RELEASE_TIMEOUTS}
}
