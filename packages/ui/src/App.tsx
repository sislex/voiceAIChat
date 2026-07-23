import type { RendererApi } from '@shared/ipc'
import { Sidebar } from './components/Sidebar'
import { ChatColumn } from './components/ChatColumn'
import { VoiceBar } from './components/VoiceBar'
import { SettingsModal } from './components/SettingsModal'
import { ConsolePanel } from './components/ConsolePanel'
import { OnboardingModal } from './components/OnboardingModal'
import { CcObserver } from './components/CcObserver'
import { CodexObserver } from './components/CodexObserver'
import { useVoiceStore } from './store/useVoiceStore'
import { useVoiceCues } from './lib/useVoiceCues'
import { useHotkeys } from './lib/useHotkeys'
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

  // Горячие клавиши: пробел (hold) — запись, Esc — стоп/отмена по состоянию.
  // Выключены при открытом модале настроек (там свои поля/фокус).
  useHotkeys({
    enabled: !state.settingsOpen && state.settings.onboarded,
    onPushStart: actions.startVoice,
    onPushEnd: actions.stopVoice,
    onEscape: () => {
      const v = state.voice
      if (v === 'thinking' || v === 'speaking') actions.cancelRequest()
      else if (v === 'listening') actions.stopVoice()
    }
  })

  const activeTitle =
    state.conversations.find((c) => c.id === state.activeId)?.title ?? 'Новый разговор'

  // Номера обнаруженных спикеров — из растущего транскрипта; при пустом live —
  // от режима диаризации (как в прототипе).
  const liveSpeakers = [...new Set(state.liveSegments.map((s) => s.speakerId))].sort((a, b) => a - b)
  const detectedSpeakers =
    liveSpeakers.length > 0 ? liveSpeakers : state.settings.diarization ? [1, 2] : [1]

  const showConsole = state.settings.showConsole

  return (
    <div
      className={showConsole ? 'app app--console' : 'app'}
      data-theme={state.settings.theme}
    >
      <Sidebar
        conversations={state.conversations}
        activeId={state.activeId}
        now={now ? now() : Date.now()}
        onNew={actions.newConversation}
        onPick={actions.selectConversation}
        onDelete={actions.deleteConversation}
        onRename={actions.renameConversation}
        searchQuery={state.searchQuery}
        onSearch={actions.setSearchQuery}
        onOpenObserver={actions.openObserver}
        onOpenCodexObserver={actions.openCodexObserver}
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
        onExport={actions.exportConversation}
        turnMeta={state.lastTurnMeta}
        agents={state.agents}
        execTarget={state.settings.execTarget}
        onChangeExecTarget={(target) => void actions.updateSettings({ execTarget: target })}
        aiLabel={state.settings.llmProvider === 'codex' ? 'Codex' : 'Claude'}
        voiceBar={
          <VoiceBar
            state={state.voice}
            draft={state.draft}
            diarization={state.settings.diarization}
            detectedSpeakers={detectedSpeakers}
            aiLabel={state.settings.llmProvider === 'codex' ? 'Codex' : 'Claude'}
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

      {showConsole && (
        <ConsolePanel
          log={state.consoleLog}
          open={state.consoleOpen}
          onToggle={actions.toggleConsole}
        />
      )}

      {state.ccOpen && (
        <CcObserver
          projects={state.ccProjects}
          sessions={state.ccSessions}
          transcript={state.ccTranscript}
          activeProject={state.ccProjectSlug}
          activeSession={state.ccSessionId}
          onSelectProject={actions.selectCcProject}
          onSelectSession={actions.selectCcSession}
          onResumeSession={(slug, id) => void actions.resumeCcSession(slug, id)}
          onClose={actions.closeObserver}
        />
      )}

      {state.cxOpen && (
        <CodexObserver
          projects={state.cxProjects}
          sessions={state.cxSessions}
          transcript={state.cxTranscript}
          activeProject={state.cxProjectCwd}
          activeSession={state.cxSessionId}
          onSelectProject={actions.selectCxProject}
          onSelectSession={actions.selectCxSession}
          onResumeSession={(id) => void actions.resumeCxSession(id)}
          onClose={actions.closeCodexObserver}
        />
      )}

      {!state.settings.onboarded && (
        <OnboardingModal
          modelPresent={state.modelPresent}
          modelLabel={state.settings.whisperModel}
          downloading={state.downloading}
          downloadPercent={state.downloadPercent}
          onDownloadModel={actions.downloadModel}
          hasVoice={state.ttsVoices.length > 0}
          onDone={actions.completeOnboarding}
        />
      )}

      {state.settingsOpen && (
        <SettingsModal
          settings={state.settings}
          mics={state.mics}
          voices={state.ttsVoices}
          voiceCatalog={state.voiceCatalog}
          voicesDownloadable={state.voicesDownloadable}
          voiceDownloads={state.voiceDownloads}
          whisperModels={state.whisperModels}
          mcpServers={state.mcpServers}
          loginStatus={state.loginStatus}
          agents={state.agents}
          onCreateAgent={actions.createAgent}
          onDeleteAgent={(id) => void actions.deleteAgent(id)}
          onSetAgentPolicy={(id, policy) => void actions.setAgentPolicy(id, policy)}
          onRegenerateAgentToken={actions.regenerateAgentToken}
          onDownloadDesktopApp={() => void actions.downloadDesktopApp()}
          onDownloadAgentApp={() => void actions.downloadAgentApp()}
          onDownloadAgentScript={() => void actions.downloadAgentScript()}
          onGetConnectionString={actions.getAgentConnectionString}
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
