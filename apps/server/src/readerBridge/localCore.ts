// `ReaderCore` во встроенном режиме: ридер живёт в процессе ядра и берёт relay, ключи Chromium,
// канбан и шину кадров напрямую. Это единственное место, где ядро знает, что нужно ридеру.
import type { FastifyInstance } from 'fastify'
import { readerProjectResource } from './projectResource.js'
import type { PreviewEnvironment, ServerMessage } from '@voicechat/shared'
import type { VoiceChatDb } from '../db/database.js'
import type { PreviewActionRelay } from '@voicechat/web-reader-contracts'
import type { PreviewRunKeys } from '../browser/machinePreview.js'
import { saveBrowserShot } from '../browser/checkShots.js'
import type { MachinesService } from '../machines/service.js'
import { RpcError } from '@voicechat/shared'
import type { ReaderCore } from '@voicechat/web-reader-contracts'

export interface LocalReaderCoreDeps {
  app: FastifyInstance
  db: VoiceChatDb
  machines: Pick<MachinesService, 'isOnline' | 'http'>
  relay: Pick<PreviewActionRelay, 'request'>
  runKeys: Pick<PreviewRunKeys, 'issue'>
  /** Живые feature-preview: канбан ядра или его порт в режиме `remote`. */
  previews: () => Promise<PreviewEnvironment[]>
  /** Корень кадров браузерной проверки (`routes/browserShots.ts` отдаёт их по ссылке из лога). */
  shotsRoot: string
  publish: (message: ServerMessage, userId: string) => void
}

export function createLocalReaderCore(deps: LocalReaderCoreDeps): ReaderCore {
  return {
    async context({ userId, conversationId }) {
      const conversation = await deps.db.chat.getConversation(userId, conversationId)
      if (!conversation) return null
      const project = conversation.projectId ? await deps.db.projects.getProject(userId, conversation.projectId) : null
      const target = conversation.execTarget
      const machineId = target && target !== 'none' && target !== 'server' &&
        (await deps.db.machines.canUseAgentForPreview(userId, target) || await deps.db.machines.canUseAgent(userId, target, conversation.projectId ?? null)) ? target : null
      const machineUrl = (agentId: string, raw: string | null): string | null => {
        if (!raw) return null
        try { const url = new URL(raw); url.hostname = agentId + '.machine.internal'; return url.toString() } catch { return null }
      }
      const environments = project ? (await deps.previews()).filter((env) => env.projectId === project.id).map((env) => ({
        taskId: env.taskId, branch: env.branch, state: env.state, healthy: env.healthStatus === 'healthy',
        appUrl: machineUrl(env.agentId, env.appUrl), storybookUrl: machineUrl(env.agentId, env.storybookUrl)
      })) : []
      return { machineId, testUsers: project?.testUsers ?? [], environments, commandPolicy: project?.commandPolicy ?? null }
    },
    canUseMachine: (userId, agentId) => deps.db.machines.canUseAgentForPreview(userId, agentId),
    machineOnline: (agentId) => deps.machines.isOnline(agentId),
    async machineHttp(userId, agentId, request) {
      // Проверка остаётся у владельца данных, включая прямой вызов внутреннего RPC.
      if (!await deps.db.machines.canUseAgentForPreview(userId, agentId)) throw new RpcError(403, 'Машина недоступна этому пользователю')
      if (!deps.machines.isOnline(agentId)) throw new RpcError(502, 'Машина тестового окружения не в сети')
      return deps.machines.http(agentId, request)
    },
    projectResource: (request) => readerProjectResource(deps.app, request),
    previewAction: (userId, conversationId, action, timeoutMs) => deps.relay.request(userId, conversationId, action, timeoutMs),
    issuePreviewRunKey: (userId) => deps.runKeys.issue(userId),
    listPreviews: () => deps.previews(),
    /**
     * Кадр уходит в ленту активного рана задачи ссылкой на файл: base64 в логе распухал бы на сотни
     * килобайт при каждом реплее ленты. Нет рана или шага — кадр просто не логируется: модель его уже получила.
     */
    async logBrowserShot(userId, conversationId, pngBase64) {
      const { db } = deps
      const taskId = (await db.chat.getConversation(userId, conversationId))?.taskId
      if (!taskId || (await db.ci.getTaskBrowserCheck(taskId)).mode !== 'chromium') return
      const run = await db.ci.activeCiRunForTask(taskId)
      if (!run) return
      const step = (await db.ci.getCiRun(run.triggeredBy, run.id))?.steps.filter((item) => item.status === 'running').at(-1)
      if (!step) return
      const saved = saveBrowserShot(deps.shotsRoot, run.id, Buffer.from(pngBase64, 'base64'))
      if (!saved) return
      const line = await db.ci.appendCiLog(run.id, step.id, 'system', `Снимок страницы проверки: ${saved.url}\n`)
      deps.publish({ t: 'ci.log', runId: run.id, line }, run.triggeredBy)
    }
  }
}
