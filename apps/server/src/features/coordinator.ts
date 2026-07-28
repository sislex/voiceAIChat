import type { FeatureRun } from '@voicechat/shared'
import type { VoiceChatDb } from '../db/database.js'
import type { PullRequestService } from './pullRequests.js'
import type { WorkspaceExecutor } from './workspace.js'

const mergeLocks = new Set<string>()

export type FeatureTurnStarter = (input: { userId: string; conversationId: string; text: string }) => Promise<void>

export class FeatureCoordinator {
  constructor(private readonly db: VoiceChatDb, private readonly workspace: WorkspaceExecutor, private readonly pullRequests: PullRequestService, private readonly onChange: (projectId: string) => void = () => {}, private readonly startTurn: FeatureTurnStarter = async () => {}) {}

  async prepare(userId: string, feature: FeatureRun): Promise<void> {
    let slot
    try {
      const project = this.db.getProject(userId, feature.projectId)
      if (!project?.gitUrl) throw new Error('У проекта не задан Git URL')
      slot = this.db.reserveRepositorySlot(userId, feature.id)
      if (!slot) throw new Error('Не удалось зарезервировать рабочую копию')
      const machine = project.machines.find((m) => m.agentId === slot!.agentId)
      if (!machine?.featureReposRoot) throw new Error('Не задан корень репозиториев Feature Run')
      const prepared = await this.workspace.prepare({ agentId: slot.agentId, root: machine.featureReposRoot, path: slot.path, gitUrl: project.gitUrl, baseBranch: feature.baseBranch, featureBranch: feature.featureBranch })
      this.db.setRepositorySlotState(feature.id, 'busy', { branch: feature.featureBranch })
      this.db.setFeatureBaseCommit(userId, feature.id, prepared.baseCommitSha)
      const planned = this.db.transitionFeature(userId, feature.id, 'planning')!
      this.db.createAgentTask(userId, feature.id, { title: `Реализовать: ${feature.title}`, description: feature.description, kind: 'implementation', createdBy: 'system' })
      // Ручное подтверждение плана: фича остаётся в `planning`, а первый ход агента идёт
      // в режиме плана (read-only) — задача «начинается в режиме планирования». Пользователь
      // сам двигает planning → awaiting_plan_approval → development существующими кнопками UI.
      // Автоматический режим пропускает планирование и сразу идёт в разработку.
      if (planned.agentPlanApprovalMode === 'automatic') this.db.transitionFeature(userId, feature.id, 'development')
      const conversationId = feature.conversationId
      const initialMessage = conversationId ? this.db.listMessages(userId, conversationId).at(-1) : undefined
      if (conversationId && initialMessage) {
        try {
          await this.startTurn({ userId, conversationId, text: initialMessage.text })
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          this.db.addMessage(userId, conversationId, 'ai', `Не удалось автоматически запустить агента: ${message}`, new Date().toISOString().slice(11, 16))
        }
      }
    } catch (err) {
      if (slot) this.db.setRepositorySlotState(feature.id, 'repair_required', { error: err instanceof Error ? err.message : String(err) })
      this.db.failFeature(userId, feature.id, err instanceof Error ? err.message : String(err))
    } finally { this.onChange(feature.projectId) }
  }

  async finishDevelopment(userId: string, featureId: string, confirmedCommit = false): Promise<void> {
    const feature = this.db.getFeature(userId, featureId)
    const slot = this.db.getRepositorySlotForFeature(userId, featureId)
    const project = feature ? this.db.getProject(userId, feature.projectId) : null
    if (!feature || !slot || !project) throw new Error('Фича или рабочая копия не найдена')
    if (feature.status === 'development' && feature.commitPolicy === 'manual_user_confirmation' && !confirmedCommit) {
      this.db.transitionFeature(userId, featureId, 'awaiting_commit')
      this.onChange(feature.projectId)
      return
    }
    if (feature.status !== 'development' && feature.status !== 'awaiting_commit') throw new Error('Фича не находится в разработке')
    const sha = await this.workspace.commit({ agentId: slot.agentId, path: slot.path, policy: feature.commitPolicy, message: `feat(${feature.id}): ${feature.title}` })
    this.db.transitionFeature(userId, featureId, 'testing')
    if (!project.testCommand) {
      this.db.transitionFeature(userId, featureId, 'development')
      this.onChange(feature.projectId)
      throw new Error('В проекте не настроена команда тестирования')
    }
    try {
      await this.workspace.run({ agentId: slot.agentId, path: slot.path, command: project.testCommand })
      this.db.setFeatureTestedCommit(userId, featureId, sha)
      const ready = this.db.transitionFeature(userId, featureId, 'awaiting_merge')!
      if (ready.autoMerge) await this.merge(userId, featureId)
      this.onChange(feature.projectId)
    } catch (err) {
      this.db.createAgentTask(userId, featureId, { title: 'Исправить ошибки тестирования', description: err instanceof Error ? err.message : String(err), kind: 'bugfix', createdBy: 'system' })
      this.db.transitionFeature(userId, featureId, 'development')
      this.onChange(feature.projectId)
      throw err
    }
  }

  async merge(userId: string, featureId: string): Promise<void> {
    const feature = this.db.getFeature(userId, featureId)
    const slot = this.db.getRepositorySlotForFeature(userId, featureId)
    if (!feature || !slot) throw new Error('Фича или рабочая копия не найдена')
    if (mergeLocks.has(feature.projectId)) throw new Error('Другой merge этого проекта уже выполняется')
    mergeLocks.add(feature.projectId)
    try {
      this.db.transitionFeature(userId, featureId, 'merging')
      let sha: string
      if (feature.mergeTransport === 'github_pull_request') {
        const project = this.db.getProject(userId, feature.projectId)
        if (!project?.gitUrl) throw new Error('У проекта не задан Git URL')
        await this.workspace.pushFeature({ agentId: slot.agentId, path: slot.path, featureBranch: feature.featureBranch })
        sha = (await this.pullRequests.merge({ gitUrl: project.gitUrl, base: feature.baseBranch, head: feature.featureBranch, title: feature.title })).mergeCommitSha
      } else {
        const project = this.db.getProject(userId, feature.projectId)
        sha = await this.workspace.mergeLocal({ agentId: slot.agentId, path: slot.path, baseBranch: feature.baseBranch, featureBranch: feature.featureBranch, message: `Merge ${feature.featureBranch}`, testCommand: project?.testCommand })
      }
      this.db.setFeatureMergedCommit(userId, featureId, sha)
      this.db.transitionFeature(userId, featureId, 'completed')
      try {
        await this.workspace.cleanup({ agentId: slot.agentId, path: slot.path, baseBranch: feature.baseBranch, featureBranch: feature.featureBranch })
        this.db.setRepositorySlotState(featureId, 'available', { branch: feature.baseBranch })
        this.onChange(feature.projectId)
      } catch (cleanupError) {
        this.db.setRepositorySlotState(featureId, 'repair_required', { error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError) })
      }
      const done = this.db.getFeature(userId, featureId)!
      this.db.setFeatureDeployStatus(userId, featureId, done.autoDeployProduction ? 'queued' : 'awaiting_confirmation')
      if (done.autoDeployProduction) await this.deploy(userId, featureId, 'automatic')
    } catch (err) {
      const current = this.db.getFeature(userId, featureId)
      if (current?.status === 'merging') this.db.transitionFeature(userId, featureId, 'awaiting_merge')
      throw err
    } finally { mergeLocks.delete(feature.projectId); this.onChange(feature.projectId) }
  }

  async cancel(userId: string, featureId: string): Promise<void> {
    const feature = this.db.getFeature(userId, featureId)
    if (!feature) throw new Error('Фича не найдена')
    this.db.transitionFeature(userId, featureId, 'cancelled')
    this.db.setRepositorySlotState(featureId, 'blocked', { blockReason: 'cancelled_feature_requires_resolution' })
    this.onChange(feature.projectId)
  }

  async deploy(userId: string, featureId: string, trigger: 'manual' | 'automatic' = 'manual'): Promise<void> {
    const feature = this.db.getFeature(userId, featureId)
    if (!feature) throw new Error('Фича не найдена')
    let deploymentId: string | undefined
    try {
      const project = this.db.getProject(userId, feature.projectId)
      if (!project) throw new Error('Проект не найден')
      if (feature.status !== 'completed') throw new Error('Деплой возможен только после merge')
      if (!project.productionDeployCommand) throw new Error('Не настроена команда production-деплоя')
      const slot = this.db.reserveRepositorySlot(userId, featureId)
      if (!slot) throw new Error('Не удалось зарезервировать workspace для деплоя')
      this.db.setFeatureDeployStatus(userId, featureId, 'deploying')
      // SHA фиксируется именно при постановке конкретного запуска в очередь.
      const requestedSha = await this.workspace.remoteMainSha({ agentId: slot.agentId, path: slot.path, baseBranch: feature.baseBranch })
      const deployment = this.db.createFeatureDeployment(userId, featureId, requestedSha, trigger)
      if (!deployment) throw new Error('Не удалось создать запись деплоя')
      deploymentId = deployment.id
      this.db.updateFeatureDeployment(deployment.id, 'running')
      await this.workspace.checkout({ agentId: slot.agentId, path: slot.path, sha: requestedSha })
      await this.workspace.run({ agentId: slot.agentId, path: slot.path, command: project.productionDeployCommand })
      await this.workspace.cleanup({ agentId: slot.agentId, path: slot.path, baseBranch: feature.baseBranch, featureBranch: feature.featureBranch })
      this.db.updateFeatureDeployment(deployment.id, 'succeeded', { deployedMainSha: requestedSha })
      this.db.setFeatureDeployStatus(userId, featureId, 'succeeded')
      this.db.setRepositorySlotState(featureId, 'available', { branch: feature.baseBranch })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.db.setFeatureDeployStatus(userId, featureId, 'failed', message)
      if (deploymentId) this.db.updateFeatureDeployment(deploymentId, 'failed', { error: message })
      const slot = this.db.getRepositorySlotForFeature(userId, featureId)
      if (slot) this.db.setRepositorySlotState(featureId, 'repair_required', { error: message })
      throw err
    } finally {
      this.onChange(feature.projectId)
    }
  }

}
