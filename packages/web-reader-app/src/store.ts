import type { Conversation } from '@shared/types'
import type { ReaderChatPort, RecorderState, WebReaderHostPort, WebRecorderPort } from './contracts'

export const isWebReaderConversation = (c: Conversation): boolean =>
  c.assistantKind === 'web-recorder' || (c.assistantKind == null && Boolean(c.previewUrl))

export interface WebReaderState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  conversations: readonly Conversation[]
  activeId: string | null
  previewUrl: string | null
  mobilePane: 'chat' | 'browser'
  recorder: 'unavailable' | 'loading' | 'ready'
  error: string | null
}
export interface WebReaderStore {
  getState(): Readonly<WebReaderState>
  subscribe(fn: () => void): () => void
  load(): Promise<void>
  activate(id: string | null): Promise<void>
  setMobilePane(pane: 'chat' | 'browser'): void
  dispose(): void
}

export function createWebReaderStore(chat: ReaderChatPort, host: WebReaderHostPort): WebReaderStore {
  let state: WebReaderState = { status: 'idle', conversations: [], activeId: null, previewUrl: null, mobilePane: 'chat', recorder: 'unavailable', error: null }
  let listGeneration = 0
  let activationGeneration = 0
  let recorder: WebRecorderPort | null = null
  let offRecorder: (() => void) | undefined
  let disposed = false
  const listeners = new Set<() => void>()
  const emit = (patch: Partial<WebReaderState>) => {
    if (disposed) return
    state = { ...state, ...patch }
    listeners.forEach(fn => fn())
  }
  const stop = () => {
    offRecorder?.()
    offRecorder = undefined
    recorder?.dispose()
    recorder = null
  }
  const load = async () => {
    if (disposed) return
    const token = ++listGeneration
    emit({ status: 'loading', error: null })
    try {
      const all = await chat.list()
      if (token !== listGeneration || disposed) return
      emit({ status: 'ready', conversations: all.filter(isWebReaderConversation) })
    } catch {
      if (token === listGeneration) emit({ status: 'error', error: 'Не удалось загрузить разговоры' })
    }
  }
  const activate = async (id: string | null) => {
    if (disposed) return
    const token = ++activationGeneration
    stop()
    emit({ activeId: id, previewUrl: null, recorder: 'unavailable', error: null })
    if (!id) return
    const current = () => token === activationGeneration && !disposed
    try {
      const conversation = await chat.get(id)
      if (!current()) return
      if (!conversation || !isWebReaderConversation(conversation)) {
        emit({ error: 'Разговор Web Reader не найден' })
        return
      }
      const url = conversation.previewUrl ?? (conversation.projectId ? await host.projectPreviewUrl(conversation.projectId) : null)
      if (!current()) return
      emit({ previewUrl: url })
      recorder = host.recorder(id)
      const update = (value: RecorderState) => {
        if (current()) emit({ recorder: value.ready ? 'ready' : value.page === 'loading' ? 'loading' : 'unavailable', error: value.error ?? null })
      }
      offRecorder = recorder.subscribe(update)
      update(recorder.state())
      recorder.setUrl(url)
    } catch {
      if (current()) {
        stop()
        emit({ recorder: 'unavailable', error: 'Не удалось открыть Web Reader. Повторите выбор разговора.' })
      }
    }
  }
  const offRelay = host.relay.subscribe(request => {
    if (disposed || request.conversationId !== state.activeId || !recorder) return
    const token = activationGeneration
    const target = recorder
    // A conversation ID alone cannot distinguish switching away and back again.
    void Promise.resolve().then(() => {
      if (disposed || token !== activationGeneration) return
      return target.run(request.requestId, request.action)
    }).then(result => {
      if (result && !disposed && token === activationGeneration) host.relay.result(request.conversationId, request.requestId, result)
    }).catch(() => {
      if (token === activationGeneration) emit({ error: 'Не удалось выполнить действие Reader. Повторите попытку.' })
    })
  })
  return {
    getState: () => state,
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn) } },
    load,
    activate,
    setMobilePane: pane => emit({ mobilePane: pane }),
    dispose() {
      if (disposed) return
      disposed = true
      listGeneration++
      activationGeneration++
      stop()
      offRelay()
      listeners.clear()
    }
  }
}
export type { WebRecorderPort, RecorderState } from './contracts'
