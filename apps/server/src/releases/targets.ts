// Куда выпускать релиз: рабочая копия релизной машины и production-цель.
//
// Живёт отдельно от роутов, потому что теперь это спрашивают двое: REST
// (кнопки Release Center) и канбан-ассистент (инструменты release_*). Правила
// «какая машина, какой путь, что обязательно настроено» обязаны быть одни —
// иначе ассистент выпускает не туда, куда кнопка.

import { DEFAULT_RELEASE_TIMEOUTS } from '@voicechat/shared'
import type { VoiceChatDb } from '../db/database.js'
import type { ManagedEnvironmentResolver } from './managedEnvironmentResolver.js'
import type { ProductionTarget, ReleaseManager, ReleaseProjectTarget } from './releaseManager.js'

const DEFAULT_TEST_COMMAND = 'npm run typecheck && npm run test'

/** Бросает с человеческим текстом: он же уходит и в 400 REST, и в ответ инструмента. */
export function releaseCiTarget(
  db: VoiceChatDb,
  releases: Pick<ReleaseManager, 'isOnline'>,
  userId: string,
  projectId: string
): ReleaseProjectTarget {
  const value = db.getProject(userId, projectId)
  const agentId = value?.defaultAgentId
  if (!value || !agentId) throw new Error('В настройках проекта не выбрана машина по умолчанию')
  const machine = value.machines.find((item) => item.agentId === agentId)
  if (!machine || !db.canUseAgent(userId, agentId, projectId)) throw new Error('Нет доступа к машине проекта по умолчанию или она не подключена к проекту')
  if (!releases.isOnline(agentId)) throw new Error('Машина проекта по умолчанию offline')
  if (!value.gitUrl) throw new Error('Для проекта не задан gitUrl')
  const existingPath = machine.path?.trim()
  const root = machine.reposRoot?.trim().replace(/[\\/]+$/, '')
  if (!existingPath && !root) throw new Error('У машины для этого проекта не настроена даже root-директория (repos_root)')
  return {
    projectId,
    agentId,
    path: existingPath || `${root}/.release_repo`,
    prepareCheckout: !existingPath,
    gitUrl: value.gitUrl,
    baseBranch: value.ciBaseBranch || 'main',
    testCommand: value.testCommand?.trim() || DEFAULT_TEST_COMMAND,
    limits: value.releaseTimeouts ?? DEFAULT_RELEASE_TIMEOUTS
  }
}

/** null — выкладывать некуда: production не настроен до конца. */
export function releaseProductionTarget(
  db: VoiceChatDb,
  managed: ManagedEnvironmentResolver,
  userId: string,
  projectId: string
): ProductionTarget | null {
  const value = db.getProject(userId, projectId)
  const agentId = value?.productionAgentId
  const linked = agentId ? value?.machines.some((item) => item.agentId === agentId) : false
  if (!value || !agentId || !linked || !value.productionDeployCommand || !value.productionHealthCheckCommand || !value.gitUrl) return null
  if (value.productionEnvironmentMode === 'managed') return managed.resolve(userId, projectId, 'production').target
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
