// Источник realtime-кадров поверх мостов `window.*` (CHAT-236).
//
// Раньше эти подписки жили в React-биндинге стора; теперь они — адаптер, а
// адресует кадры владельцу AppRuntime. Хранилища о мостах по-прежнему не знают.

import type { Message } from '@shared/types'
import { MESSAGE_META_UPDATE_KEY } from '../store/contracts'
import type { RealtimeConnect } from '../runtime/appRuntime'

export const createBrowserRealtime = (): RealtimeConnect => (handlers) => {
  const unsubs: Array<() => void> = []
  if (typeof window === 'undefined') return () => {}

  // Другая вкладка того же пользователя правит meta сообщения.
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== MESSAGE_META_UPDATE_KEY || !event.newValue) return
    try {
      const update = JSON.parse(event.newValue) as { conversationId: string; message: Message }
      handlers.chatMessage(update.conversationId, update.message)
    } catch {
      /* чужое или повреждённое значение */
    }
  }
  window.addEventListener('storage', onStorage)
  unsubs.push(() => window.removeEventListener('storage', onStorage))

  const stt = window.stt
  if (stt) {
    unsubs.push(stt.onPartial((u) => handlers.sttPartial(u)))
    unsubs.push(stt.onFinal((u) => handlers.sttFinal(u)))
    unsubs.push(stt.onError((e) => handlers.sttError(e.message)))
    unsubs.push(stt.onDownloadProgress((p) => handlers.modelDownloadProgress(p.percent)))
    unsubs.push(stt.onDownloadDone(() => handlers.modelDownloadDone()))
    unsubs.push(stt.onDownloadError((e) => handlers.modelDownloadError(e.message)))
  }

  const claude = window.claude
  if (claude) {
    unsubs.push(claude.onToken((m) => handlers.turnToken(m.delta, m.conversationId)))
    unsubs.push(claude.onDone((m) => handlers.turnDone(m.text, m.meta, m.engine, m.message, m.conversationId)))
    unsubs.push(claude.onError((m) => handlers.turnError(m.message, m.conversationId)))
    if (claude.onActive) unsubs.push(claude.onActive((m) => handlers.turnActive(m.turns)))
    if (claude.onQueue) {
      unsubs.push(claude.onQueue((m) => handlers.turnQueue(m.conversationId, m.items, m.paused, m.published)))
    }
    if (claude.onUsage) unsubs.push(claude.onUsage((m) => handlers.turnUsage(m.usage, m.conversationId)))
    unsubs.push(claude.onLog((m) => handlers.turnLog(m.entry, m.conversationId)))
  }

  if (window.cc) unsubs.push(window.cc.onTail((m) => handlers.ccTail(m.items)))
  if (window.codex) unsubs.push(window.codex.onTail((m) => handlers.cxTail(m.items)))
  if (window.agents) unsubs.push(window.agents.onChange((list) => handlers.agents(list)))
  if (window.board) unsubs.push(window.board.onUpdate((m) => handlers.boardUpdate(m.projectId, m.board)))

  const ci = window.ci
  if (ci) {
    unsubs.push(ci.onSnapshot((m) => handlers.ciSnapshot(m.runId, m.detail, m.log)))
    unsubs.push(ci.onRun((m) => handlers.ciRun(m.runId, m.run)))
    unsubs.push(ci.onStep((m) => handlers.ciStep(m.runId, m.step)))
    unsubs.push(ci.onLog((m) => handlers.ciLog(m.runId, m.line)))
    unsubs.push(ci.onFix((m) => handlers.ciFix(m.runId, m.attempt)))
    unsubs.push(ci.onDone((m) => handlers.ciDone(m.runId, m.run, m.conclusion)))
    unsubs.push(ci.onSummary((m) => handlers.ciSummary(m.projectId, m.summary)))
    unsubs.push(ci.onInteraction((m) => handlers.ciInteraction(m.runId, m.interaction)))
    unsubs.push(ci.onChatMessage((m) => handlers.chatMessage(m.conversationId, m.message)))
  }

  if (window.kb) {
    unsubs.push(window.kb.onUsage((m) => handlers.kbUsage(m.conversationId, m.projectId, m.query)))
  }

  const tts = window.tts
  if (tts) {
    unsubs.push(tts.onAudio((m) => handlers.ttsAudio(m.audio)))
    unsubs.push(tts.onError((e) => handlers.ttsError(e.message)))
    unsubs.push(tts.onVoiceProgress((m) => handlers.voiceDownloadProgress(m.id, m.percent)))
    unsubs.push(tts.onVoiceDone((m) => handlers.voiceDownloadDone(m.id)))
    unsubs.push(tts.onVoiceError((m) => handlers.voiceDownloadError(m.id, m.message)))
  }

  return () => unsubs.forEach((u) => u())
}

