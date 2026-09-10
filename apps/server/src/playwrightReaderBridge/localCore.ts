import { DEFAULT_CI_BROWSER_CHECK, isChromiumReaderConversation } from '@voicechat/shared'
import type { PlaywrightReaderCore } from '@voicechat/playwright-reader-contracts'
import type { VoiceChatDb } from '../db/database.js'
import { browserCheckTarget } from '../browser/checkTarget.js'

export function createLocalPlaywrightReaderCore(deps: {
  db: VoiceChatDb
  issuePreviewRunKey: PlaywrightReaderCore['issuePreviewRunKey']
  logBrowserShot: PlaywrightReaderCore['logBrowserShot']
}): PlaywrightReaderCore {
  return {
    async conversation(userId, conversationId) {
      const conversation = await deps.db.chat.getConversation(userId, conversationId)
      return conversation ? { assistantKind: conversation.assistantKind, previewEngine: conversation.previewEngine } : null
    },
    async modelTarget(userId, conversationId) {
      const conversation = await deps.db.chat.getConversation(userId, conversationId)
      if (!conversation) return null
      return browserCheckTarget({
        conversationId, taskId: conversation.taskId,
        playwrightReader: isChromiumReaderConversation(conversation),
        check: conversation.taskId ? await deps.db.ci.getTaskBrowserCheck(conversation.taskId) : DEFAULT_CI_BROWSER_CHECK
      })
    },
    issuePreviewRunKey: (...args) => deps.issuePreviewRunKey(...args),
    logBrowserShot: (...args) => deps.logBrowserShot(...args)
  }
}
