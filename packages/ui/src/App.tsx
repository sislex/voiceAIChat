import type { RendererApi } from '@shared/ipc'
import { Sidebar } from './components/Sidebar'
import { ChatColumn } from './components/ChatColumn'
import { VoiceBar } from './components/VoiceBar'
import { SettingsModal } from './components/SettingsModal'
import { useVoiceStore } from './store/useVoiceStore'
import { useVoiceCues } from './lib/useVoiceCues'
import './styles/app.css'

// Шаг 5: состояние живёт в сторе (store/voiceStore.ts) на базе машины состояний.
// Разговоры/сообщения/настройки — реальные из SQLite через window.api (IPC).
// Рост live-транскрипта и ответ — мок-пайплайн (реальные Whisper/Claude — Шаги 7–8).

export interface AppProps {
  /** Мост IPC. По умолчанию — window.api; в тестах инжектится фейк. */
  api?: RendererApi
  /** Источник времени для меток сообщений (тесты подменяют детерминированным). */
  now?: () => number
  /** Переопределение задержек мок-пайплайна (тесты ускоряют их). */
  delays?: Parameters<typeof useVoiceStore>[0]['delays']
}

export default function App({ api = window.api, now, delays }: AppProps = {}): JSX.Element {
  const { state, actions } = useVoiceStore({ api, now, delays })
  useVoiceCues(state.voice) // звуковые сигналы: старт/стоп записи, «думает»

  const activeTitle =
    state.conversations.find((c) => c.id === state.activeId)?.title ?? 'Новый разговор'

  // Номера обнаруженных спикеров — из растущего транскрипта; при пустом live —
  // от режима диаризации (как в прототипе).
  const liveSpeakers = [...new Set(state.liveSegments.map((s) => s.speakerId))].sort((a, b) => a - b)
  const detectedSpeakers =
    liveSpeakers.length > 0 ? liveSpeakers : state.settings.diarization ? [1, 2] : [1]

  return (
    <div className="app">
      <Sidebar
        conversations={state.conversations}
        activeId={state.activeId}
        now={now ? now() : Date.now()}
        onNew={actions.newConversation}
        onPick={actions.selectConversation}
        onDelete={actions.deleteConversation}
        onOpenSettings={actions.openSettings}
      />

      <ChatColumn
        title={activeTitle}
        state={state.voice}
        messages={state.messages}
        liveSegments={state.liveSegments}
        diarization={state.settings.diarization}
        streamingReply={state.streamingReply}
        canSpeak={state.ttsAvailable}
        speakingMessageId={state.speakingMessageId}
        onSpeakMessage={actions.replayMessage}
        onDeleteMessage={actions.deleteMessage}
        onEditMessage={actions.editMessage}
        error={state.error}
        onDismissError={actions.dismissError}
        modelMissing={!state.modelPresent}
        modelLabel={state.settings.whisperModel}
        downloading={state.downloading}
        downloadPercent={state.downloadPercent}
        onDownloadModel={actions.downloadModel}
        voiceBar={
          <VoiceBar
            state={state.voice}
            draft={state.draft}
            diarization={state.settings.diarization}
            detectedSpeakers={detectedSpeakers}
            attachments={state.attachments}
            onDraftChange={actions.setDraft}
            onSubmitText={actions.submitText}
            onStartVoice={actions.startVoice}
            onStopVoice={actions.stopVoice}
            onStopSpeak={actions.stopSpeak}
            onCancelRequest={actions.cancelRequest}
            onAddFiles={(files) => files.forEach((f) => void actions.addAttachment(f))}
            onRemoveAttachment={actions.removeAttachment}
          />
        }
      />

      {state.settingsOpen && (
        <SettingsModal
          settings={state.settings}
          mics={state.mics}
          voices={state.ttsVoices}
          voiceCatalog={state.voiceCatalog}
          voicesDownloadable={state.voicesDownloadable}
          voiceDownloads={state.voiceDownloads}
          whisperModels={state.whisperModels}
          onChange={actions.updateSettings}
          onDownloadVoice={actions.downloadVoice}
          onDeleteVoice={actions.deleteVoice}
          onDeleteModel={actions.deleteModel}
          onClose={actions.closeSettings}
        />
      )}
    </div>
  )
}
