// React-биндинг стора: подписка через useSyncExternalStore + инициализация из БД
// + подписка на события распознавания речи (main → renderer).

import { useEffect, useRef } from 'react'
import { useSyncExternalStore } from 'react'
import type { SttSegmentWire } from '@shared/ipc'
import { createVoiceStore, type AppState, type StoreActions, type StoreDeps } from './voiceStore'
import { createBrowserAudioController } from '../audio/browserAudio'
import { listMicrophones } from '../audio/microphones'
import { enqueueTtsAudio, stopTts } from '../lib/ttsPlayer'

export interface UseVoiceStore {
  state: AppState
  actions: StoreActions
}

/**
 * Создаёт стор один раз на монтирование и подписывает компонент на него.
 * Аудио-контроллер, источник микрофонов и признак реального STT подставляются
 * по умолчанию из окружения (window.audio / enumerateDevices / window.stt);
 * в тестах их можно переопределить через deps.
 */
export function useVoiceStore(deps: StoreDeps): UseVoiceStore {
  const storeRef = useRef<ReturnType<typeof createVoiceStore>>()
  if (!storeRef.current) {
    const hasStt = typeof window !== 'undefined' && !!window.stt
    const hasClaude = typeof window !== 'undefined' && !!window.claude
    const audio =
      deps.audio !== undefined ? deps.audio : createBrowserAudioController(window.audio)
    const listMics = deps.listMics ?? listMicrophones
    const sttEnabled = deps.sttEnabled ?? hasStt
    const claudeEnabled = deps.claudeEnabled ?? hasClaude
    const sendClaudePrompt =
      deps.sendClaudePrompt ??
      (hasClaude
        ? (
            conversationId: string,
            segments: SttSegmentWire[],
            attachments?: string[],
            verbose?: boolean
          ) => window.claude.send({ conversationId, segments, attachments, verbose })
        : undefined)
    const cancelClaude =
      deps.cancelClaude ??
      (hasClaude
        ? (conversationId?: string) =>
            window.claude.cancel(conversationId ? { conversationId } : undefined)
        : undefined)
    const hasApi = typeof window !== 'undefined' && !!window.api
    const getSttStatus =
      deps.getSttStatus ?? (hasApi ? () => window.api['stt:status']() : undefined)
    const startModelDownload =
      deps.startModelDownload ?? (hasStt ? () => window.stt.download() : undefined)
    const hasTts = typeof window !== 'undefined' && !!window.tts
    const ttsEnabled = deps.ttsEnabled ?? hasTts
    const speakText =
      deps.speakText ??
      (hasTts ? (text: string, voice: string) => window.tts.speak({ text, voice }) : undefined)
    const cancelTts =
      deps.cancelTts ??
      (hasTts
        ? () => {
            stopTts() // прервать воспроизведение
            window.tts.cancel() // прервать синтез в main
          }
        : undefined)
    const startVoiceDownload =
      deps.startVoiceDownload ?? (hasTts ? (id: string) => window.tts.downloadVoice({ id }) : undefined)
    const hasCc = typeof window !== 'undefined' && !!window.cc
    const ccTailStart =
      deps.ccTailStart ?? (hasCc ? (slug: string, id: string) => window.cc.tailStart({ slug, id }) : undefined)
    const ccTailStop = deps.ccTailStop ?? (hasCc ? () => window.cc.tailStop() : undefined)
    const hasCodex = typeof window !== 'undefined' && !!window.codex
    const cxTailStart =
      deps.cxTailStart ?? (hasCodex ? (id: string) => window.codex.tailStart({ id }) : undefined)
    const cxTailStop = deps.cxTailStop ?? (hasCodex ? () => window.codex.tailStop() : undefined)
    storeRef.current = createVoiceStore({
      ...deps,
      audio,
      listMics,
      sttEnabled,
      claudeEnabled,
      sendClaudePrompt,
      cancelClaude,
      getSttStatus,
      startModelDownload,
      ttsEnabled,
      speakText,
      cancelTts,
      startVoiceDownload,
      ccTailStart,
      ccTailStop,
      cxTailStart,
      cxTailStop
    })
  }
  const store = storeRef.current

  const state = useSyncExternalStore(store.subscribe, store.getState)

  useEffect(() => {
    void store.actions.init()

    const unsubs: Array<() => void> = []
    if (typeof window !== 'undefined' && window.stt) {
      unsubs.push(window.stt.onPartial((u) => store.actions.applySttPartial(u)))
      unsubs.push(window.stt.onFinal((u) => store.actions.applySttFinal(u)))
      unsubs.push(window.stt.onError((e) => store.actions.applySttError(e.message)))
      unsubs.push(window.stt.onDownloadProgress((p) => store.actions.applyDownloadProgress(p.percent)))
      unsubs.push(window.stt.onDownloadDone(() => store.actions.applyDownloadDone()))
      unsubs.push(window.stt.onDownloadError((e) => store.actions.applyDownloadError(e.message)))
    }
    if (typeof window !== 'undefined' && window.claude) {
      unsubs.push(
        window.claude.onToken((m) => store.actions.applyClaudeToken(m.delta, m.conversationId))
      )
      unsubs.push(
        window.claude.onDone((m) =>
          store.actions.applyClaudeDone(m.text, m.meta, m.engine, m.message, m.conversationId)
        )
      )
      unsubs.push(
        window.claude.onError((m) => store.actions.applyClaudeError(m.message, m.conversationId))
      )
      if (window.claude.onActive) {
        unsubs.push(window.claude.onActive((m) => store.actions.applyClaudeActive(m.turns)))
      }
      unsubs.push(window.claude.onLog((m) => store.actions.applyClaudeLog(m.entry)))
    }
    if (typeof window !== 'undefined' && window.cc) {
      unsubs.push(window.cc.onTail((m) => store.actions.applyCcTailItems(m.items)))
    }
    if (typeof window !== 'undefined' && window.codex) {
      unsubs.push(window.codex.onTail((m) => store.actions.applyCxTailItems(m.items)))
    }
    if (typeof window !== 'undefined' && window.agents) {
      unsubs.push(window.agents.onChange((list) => store.actions.applyAgents(list)))
    }
    if (typeof window !== 'undefined' && window.tts) {
      unsubs.push(
        window.tts.onAudio((m) => {
          store.actions.applyTtsAudioReceived() // замер: пришло синтезированное аудио
          enqueueTtsAudio(m.audio, () => store.actions.applyTtsDone())
        })
      )
      unsubs.push(window.tts.onError((e) => store.actions.applyTtsError(e.message)))
      unsubs.push(window.tts.onVoiceProgress((m) => store.actions.applyVoiceProgress(m.id, m.percent)))
      unsubs.push(window.tts.onVoiceDone((m) => store.actions.applyVoiceDone(m.id)))
      unsubs.push(window.tts.onVoiceError((m) => store.actions.applyVoiceError(m.id, m.message)))
    }

    return () => {
      unsubs.forEach((u) => u())
      store.actions.dispose()
    }
  }, [store])

  return { state, actions: store.actions }
}
