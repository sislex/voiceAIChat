import { useState } from 'react'
import type { RendererApi } from '@shared/ipc'
import { Sidebar } from './components/Sidebar'
import { ChatColumn } from './components/ChatColumn'
import { VoiceBar } from './components/VoiceBar'
import { SettingsModal } from './components/SettingsModal'
import { ConsolePanel } from './components/ConsolePanel'
import { OnboardingModal } from './components/OnboardingModal'
import { LoginScreen } from './components/LoginScreen'
import { CcObserver } from './components/CcObserver'
import { UsersAdmin } from './components/UsersAdmin'
import { MachineStatus } from './components/MachineStatus'
import { MachineUtility } from './components/MachineUtility'
import type { MachineOps } from './components/machine'
import { CodexObserver } from './components/CodexObserver'
import { ConversationSettings } from './components/ConversationSettings'
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
  // Мобильный режим: выдвинут ли сайдбар (на десктопе класс side--open не влияет).
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [conversationSettingsOpen, setConversationSettingsOpen] = useState(false)
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

  const activeConversation = state.conversations.find((c) => c.id === state.activeId)
  const activeTitle = activeConversation?.title ?? 'Новый разговор'
  const activeExecTarget = activeConversation?.execTarget ?? null

  // Номера обнаруженных спикеров — из растущего транскрипта; при пустом live —
  // от режима диаризации (как в прототипе).
  const liveSpeakers = [...new Set(state.liveSegments.map((s) => s.speakerId))].sort((a, b) => a - b)
  const detectedSpeakers =
    liveSpeakers.length > 0 ? liveSpeakers : state.settings.diarization ? [1, 2] : [1]

  const showConsole = state.settings.showConsole

  // Операции над машиной для утилит (консоль/проводник); только web (есть мост fs).
  const machineOps: MachineOps | undefined = state.authRequired
    ? {
        list: actions.fsList,
        read: actions.fsRead,
        write: actions.fsWrite,
        remove: actions.fsRemove,
        rename: actions.fsRename,
        mkdir: actions.fsMkdir,
        download: actions.downloadFsFile,
        upload: actions.uploadFsFile,
        exec: actions.agentExec
      }
    : undefined

  // Закрывает мобильный сайдбар и выполняет действие пункта меню.
  const menu = (fn: () => void) => (): void => {
    setSidebarOpen(false)
    fn()
  }

  // Многопользовательский режим (web): пока не вошли — показываем экран логина.
  if (state.authRequired && !state.currentUser) {
    return (
      <LoginScreen
        onLogin={(name, password) => void actions.login(name, password)}
        error={state.authError}
        theme={state.settings.theme}
      />
    )
  }

  return (
    <div
      className={showConsole ? 'app app--console' : 'app'}
      data-theme={state.settings.theme}
    >
      <Sidebar
        open={sidebarOpen}
        conversations={state.conversations}
        activeId={state.activeId}
        workingIds={[
          ...Object.keys(state.activeTurns),
          ...((state.voice === 'thinking' || state.voice === 'speaking') && state.activeId
            ? [state.activeId]
            : [])
        ]}
        now={now ? now() : Date.now()}
        onNew={() => {
          void actions.newConversation()
          setSidebarOpen(false)
        }}
        onPick={(id) => {
          void actions.selectConversation(id)
          setSidebarOpen(false)
        }}
        onDelete={actions.deleteConversation}
        onRename={actions.renameConversation}
        agents={state.agents}
        searchQuery={state.searchQuery}
        onSearch={actions.setSearchQuery}
        onOpenObserver={menu(actions.openObserver)}
        onOpenCodexObserver={menu(actions.openCodexObserver)}
        onOpenSettings={menu(actions.openSettings)}
        onOpenFiles={state.authRequired ? menu(() => actions.openUtility('explorer')) : undefined}
        onOpenConsole={state.authRequired ? menu(() => actions.openUtility('console')) : undefined}
        onOpenUsers={state.authRequired ? menu(() => void actions.openUsers()) : undefined}
        onOpenMachines={state.authRequired ? menu(actions.openMachines) : undefined}
        currentUser={state.currentUser}
        onLogout={state.authRequired ? () => void actions.logout() : undefined}
      />
      {sidebarOpen && (
        <div className="side-backdrop" aria-hidden onClick={() => setSidebarOpen(false)} />
      )}

      <ChatColumn
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
        title={activeTitle}
        onRenameTitle={(t) => {
          if (state.activeId) void actions.renameConversation(state.activeId, t)
        }}
        onOpenConversationSettings={() => setConversationSettingsOpen(true)}
        state={state.voice}
        messages={state.messages}
        loadingMessages={state.loadingMessages}
        liveSegments={state.liveSegments}
        diarization={state.settings.diarization}
        streamingReply={state.streamingReply}
        liveActivity={state.liveActivity}
        canSpeak={state.ttsAvailable}
        speakingMessageId={state.speakingMessageId}
        onSpeakMessage={actions.replayMessage}
        onDeleteMessage={actions.deleteMessage}
        onEditMessage={actions.editMessage}
        onAnswerQuestions={(text) => void actions.answerQuestions(text)}
        machineOps={machineOps}
        readServerFile={actions.readServerFile}
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
        execTarget={activeExecTarget}
        aiLabel={state.settings.llmProvider === 'codex' ? 'Codex' : 'Claude'}
        voiceBar={
          <VoiceBar
            state={state.voice}
            replyStarted={state.streamingReply.length > 0}
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

      {conversationSettingsOpen && activeConversation && (
        <ConversationSettings
          conversation={activeConversation}
          agents={state.agents}
          machineOps={machineOps}
          onSave={async ({ title, execTarget, workdir, skillNames }) => {
            await actions.renameConversation(activeConversation.id, title)
            await actions.setConversationExecTarget(activeConversation.id, execTarget, workdir, skillNames)
          }}
          onAddSkill={async (agentId, skill) => {
            const agent = state.agents.find((item) => item.id === agentId)
            if (!agent) return
            await actions.setAgentPolicy(agentId, { ...agent.policy, skills: [...agent.policy.skills, skill] })
          }}
          onClose={() => setConversationSettingsOpen(false)}
        />
      )}

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

      {state.machinesOpen && (
        <MachineStatus
          agents={state.agents}
          onSetPolicy={(id, policy) => void actions.setAgentPolicy(id, policy)}
          onClose={actions.closeMachines}
        />
      )}

      {state.usersOpen && (
        <UsersAdmin
          users={state.adminUsers}
          selected={state.adminSelected}
          usage={state.adminUsage}
          conversations={state.adminConversations}
          messages={state.adminMessages}
          conversationId={state.adminConversationId}
          currentUserName={state.currentUser?.name ?? ''}
          onSelect={(name) => void actions.selectAdminUser(name)}
          onCreate={(name, password, role) => void actions.createUserAccount(name, password, role)}
          onSetBlocked={(name, blocked) => void actions.setUserBlocked(name, blocked)}
          onDelete={(name) => void actions.deleteUserAccount(name)}
          onLoadUsage={(unit) => void actions.loadAdminUsage(unit)}
          onOpenConversation={(id) => void actions.openAdminConversation(id)}
          onClose={actions.closeUsers}
        />
      )}

      {state.utility && machineOps && (
        <MachineUtility
          tool={{ kind: state.utility.kind, ...(state.utility.agentId ? { agentId: state.utility.agentId } : {}) }}
          agents={state.agents}
          ops={machineOps}
          variant="modal"
          onClose={actions.closeUtility}
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
          capabilities={state.capabilities}
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
          role={state.currentUser?.role ?? 'admin'}
          onClose={actions.closeSettings}
        />
      )}
    </div>
  )
}
