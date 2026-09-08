// `ReaderCore` во встроенном режиме: ридер живёт в процессе ядра и берёт relay, ключи Chromium,
// канбан и шину кадров напрямую. Это единственное место, где ядро знает, что нужно ридеру.
import type { PreviewEnvironment, ServerMessage } from '@voicechat/shared'
import type { VoiceChatDb } from '../db/database.js'
import type { PreviewActionRelay } from '../mcp/previewMcp.js'
import type { PreviewRunKeys } from '../browser/machinePreview.js'
import { saveBrowserShot } from '../browser/checkShots.js'
import type { ReaderCore } from '../reader/core.js'

export interface LocalReaderCoreDeps {
  db: VoiceChatDb
  relay: Pick<PreviewActionRelay, 'request'>
  runKeys: Pick<PreviewRunKeys, 'issue'>
  /** Живые feature-preview: канбан ядра или его порт в режиме `remote`. */
  previews: () => Promise<PreviewEnvironment[]>
  /** Корень кадров браузерной проверки (`routes/browser.ts` отдаёт их по ссылке из лога). */
  shotsRoot: string
  publish: (message: ServerMessage, userId: string) => void
}

export function createLocalReaderCore(deps: LocalReaderCoreDeps): ReaderCore {
  return {
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
