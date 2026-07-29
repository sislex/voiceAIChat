import { useEffect, useRef, useState } from 'react'
import type { RendererApi } from '@shared/ipc'
import type { PermissionMode } from '@shared/types'
import { Sidebar } from './components/Sidebar'
import { ChatColumn } from './components/ChatColumn'
import { VoiceBar } from './components/VoiceBar'
import { VOICE_INPUT_ENABLED } from './lib/featureFlags'
import { SettingsModal } from './components/SettingsModal'
import { ConsolePanel } from './components/ConsolePanel'
import { OnboardingModal } from './components/OnboardingModal'
import { LoginScreen } from './components/LoginScreen'
import { CcObserver } from './components/CcObserver'
import { UsersAdmin } from './components/UsersAdmin'
import { ProjectsOverlay } from './components/ProjectsOverlay'
import { ProjectSettings } from './components/ProjectSettings'
import { ProjectBoard } from './components/ProjectBoard'
import { FeatureDetail } from './components/FeatureDetail'
import { MachineStatus } from './components/MachineStatus'
import { MachineUtility } from './components/MachineUtility'
import type { MachineOps } from './components/machine'
import { CodexObserver } from './components/CodexObserver'
import { ConversationSettings } from './components/ConversationSettings'
import { KnowledgeBase } from './components/KnowledgeBase'
import { useVoiceStore } from './store/useVoiceStore'
import { useVoiceCues } from './lib/useVoiceCues'
import { useHashRoute } from './lib/useHashRoute'
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

// Разделы-страницы утилит в контентной колонке (как «Проекты»).
const UTILITY_PAGES: readonly string[] = ['claude-code', 'codex', 'machines', 'kb', 'users']

export default function App({ api = window.api, now, delays }: AppProps = {}): JSX.Element {
  const { state, actions } = useVoiceStore({ api, now, delays })
  // Hash-роутинг раздела «Проекты»: URL — источник навигации (см. useHashRoute).
  const { segments, navigate } = useHashRoute()
  const inProjects = segments[0] === 'projects'
  const routeProjectId = inProjects ? (segments[1] ?? null) : null
  const routeSettings = inProjects && segments[2] === 'settings'
  // Утилиты-страницы: один сегмент из белого списка (#/machines, #/kb, …).
  const utilitySeg = segments.length === 1 && UTILITY_PAGES.includes(segments[0]) ? segments[0] : null
  const onUtilityPage = utilitySeg !== null
  const authed = !state.authRequired || Boolean(state.currentUser)
  // Мобильный режим: выдвинут ли сайдбар (на десктопе класс side--open не влияет).
  const [sidebarOpen, setSidebarOpen] = useState(false)
  // Десктоп: свёрнут ли сайдбар (колонка → 0). Персист в localStorage.
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('vc:sidebarCollapsed') === '1' } catch { return false }
  })
  const setCollapsedPersist = (v: boolean): void => {
    setCollapsed(v)
    try { localStorage.setItem('vc:sidebarCollapsed', v ? '1' : '0') } catch { /* приватный режим */ }
  }
  const [conversationSettingsOpen, setConversationSettingsOpen] = useState(false)
  // Режим списка сайдбара: маршрут ведёт его автоматически, ручной выбор
  // (переключатель) живёт до следующей смены маршрута.
  const [sidebarMode, setSidebarMode] = useState<'chats' | 'projects'>('chats')
  useEffect(() => { setSidebarMode(inProjects ? 'projects' : 'chats') }, [inProjects])
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

  // URL → данные стора: вход/выход в раздел «Проекты», загрузка доски и
  // оверлея настроек. Навигацию делают клики (navigate), данные грузятся тут.
  useEffect(() => {
    if (!authed) return
    if (inProjects) { if (!state.projectsOpen) void actions.openProjects() }
    else if (state.projectsOpen) actions.closeProjects()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, inProjects])
  useEffect(() => {
    if (!authed || !inProjects) return
    if (routeProjectId) { if (state.activeProjectId !== routeProjectId) void actions.openBoard(routeProjectId) }
    else if (state.activeProjectId) actions.closeBoard()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, inProjects, routeProjectId])
  // Авто-редирект при запуске: открыли #/projects (список) — уводим на последний
  // использованный проект, если он ещё доступен. Срабатывает один раз за сессию
  // (ref-гард), поэтому закрытие доски к списку потом не перекидывает обратно.
  const redirectedToLastProject = useRef(false)
  useEffect(() => {
    if (!authed || redirectedToLastProject.current) return
    if (!inProjects || routeProjectId || state.projects.length === 0) return
    redirectedToLastProject.current = true
    const last = state.lastProjectId
    if (last && state.projects.some((p) => p.id === last)) navigate(`/projects/${last}`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, inProjects, routeProjectId, state.projects, state.lastProjectId])
  useEffect(() => {
    if (!authed) return
    if (routeSettings) { if (!state.projectSettingsOpen) actions.openProjectSettings() }
    else if (state.projectSettingsOpen) actions.closeProjectSettings()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, routeSettings])
  // URL → данные стора: утилиты-страницы. Вход на маршрут грузит данные, уход
  // зовёт close* — store-экшены прежние, поменялся только триггер (URL).
  useEffect(() => {
    if (utilitySeg === 'claude-code') { if (!state.ccOpen) void actions.openObserver() }
    else if (state.ccOpen) actions.closeObserver()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [utilitySeg])
  useEffect(() => {
    if (utilitySeg === 'codex') { if (!state.cxOpen) void actions.openCodexObserver() }
    else if (state.cxOpen) actions.closeCodexObserver()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [utilitySeg])
  useEffect(() => {
    if (!state.authRequired) return
    if (utilitySeg === 'machines') { if (!state.machinesOpen) actions.openMachines() }
    else if (state.machinesOpen) actions.closeMachines()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [utilitySeg])
  useEffect(() => {
    if (!state.authRequired) return
    if (utilitySeg === 'users') { if (!state.usersOpen) void actions.openUsers() }
    else if (state.usersOpen) actions.closeUsers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [utilitySeg])
  // Гейты: «Пользователи» — только админ; машины/пользователи — только web.
  useEffect(() => {
    if (utilitySeg === 'users' && state.currentUser && state.currentUser.role !== 'admin') navigate('/')
    if ((utilitySeg === 'users' || utilitySeg === 'machines') && !state.authRequired) navigate('/')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [utilitySeg, state.currentUser, state.authRequired])

  const activeConversation = state.conversations.find((c) => c.id === state.activeId)
  const conversationFeature = state.featureRuns.find((f) => f.conversationId === state.activeId) ?? (state.activeFeature?.conversationId === state.activeId ? state.activeFeature : undefined)
  const activeTitle = activeConversation?.title ?? 'Новый разговор'
  const activeExecTarget = activeConversation?.execTarget ?? null
  const forcedPlan = state.currentUser?.role === 'user' && (!activeExecTarget || activeExecTarget === 'none')
  const activePermissionMode: PermissionMode = forcedPlan
    ? 'plan'
    : activeConversation?.permissionMode ?? state.settings.permissionMode

  const changeConversationMode = async (mode: PermissionMode): Promise<void> => {
    if (!activeConversation || mode === activePermissionMode) return
    if (activePermissionMode === 'plan' && mode === 'bypassPermissions' && !window.confirm(
      'Перейти из планирования в «Полный доступ»? Агент сможет выполнять команды и изменять любые доступные файлы.'
    )) return
    await actions.setConversationExecTarget(
      activeConversation.id,
      activeConversation.execTarget,
      activeConversation.workdir,
      activeConversation.skillNames,
      activeConversation.llmProvider,
      activeConversation.llmModel,
      mode
    )
  }

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
      className={[
        'app',
        showConsole && 'app--console',
        collapsed && 'app--sidebar-collapsed'
      ].filter(Boolean).join(' ')}
      data-theme={state.settings.theme}
    >
      <Sidebar
        open={sidebarOpen}
        onToggleCollapse={() => setCollapsedPersist(true)}
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
          if (inProjects) navigate('/')
        }}
        onPick={(id) => {
          void actions.selectConversation(id)
          setSidebarOpen(false)
          if (inProjects) navigate('/')
        }}
        onDelete={actions.deleteConversation}
        onRename={actions.renameConversation}
        onStatusChange={(id, status) => void actions.setConversationStatus(id, status)}
        agents={state.agents}
        searchQuery={state.searchQuery}
        onSearch={actions.setSearchQuery}
        projects={state.projects}
        selectedProjectId={state.sidebarProjectId}
        onSelectProject={(id) => void actions.setSidebarProject(id)}
        onOpenObserver={menu(() => navigate('/claude-code'))}
        onOpenCodexObserver={menu(() => navigate('/codex'))}
        onOpenKnowledgeBase={menu(() => navigate('/kb'))}
        onOpenSettings={menu(actions.openSettings)}
        onOpenFiles={state.authRequired ? menu(() => actions.openUtilityForActiveChat('explorer')) : undefined}
        onOpenConsole={state.authRequired ? menu(() => actions.openUtilityForActiveChat('console')) : undefined}
        onOpenUsers={state.authRequired ? menu(() => navigate('/users')) : undefined}
        onOpenMachines={state.authRequired ? menu(() => navigate('/machines')) : undefined}
        currentUser={state.currentUser}
        onLogout={state.authRequired ? () => void actions.logout() : undefined}
        mode={sidebarMode}
        onModeChange={state.authRequired ? (m) => {
          setSidebarMode(m)
          if (m === 'projects') void actions.refreshProjects()
        } : undefined}
        activeProjectId={routeProjectId}
        onPickProject={(id) => {
          setSidebarOpen(false)
          navigate(`/projects/${id}`)
        }}
        onCreateProject={(name) => {
          setSidebarOpen(false)
          void actions.createProject({ name }).then((detail) => {
            if (detail) navigate(`/projects/${detail.id}`)
          })
        }}
      />
      {sidebarOpen && (
        <div className="side-backdrop" aria-hidden onClick={() => setSidebarOpen(false)} />
      )}

      {!inProjects && !onUtilityPage && (
      <ChatColumn
        onToggleSidebar={() => {
          if (collapsed) setCollapsedPersist(false)
          else setSidebarOpen((v) => !v)
        }}
        title={activeTitle}
        onRenameTitle={(t) => {
          if (state.activeId) void actions.renameConversation(state.activeId, t)
        }}
        onOpenConversationSettings={() => { setConversationSettingsOpen(true); void actions.refreshProjects() }}
        permissionMode={activePermissionMode}
        onExecutePlan={(answerId) => void actions.executePlan(answerId)}
        canExecutePlan={!forcedPlan}
        state={state.voice}
        messages={state.messages}
        loadingMessages={state.loadingMessages}
        liveSegments={state.liveSegments}
        diarization={state.settings.diarization}
        streamingReply={state.streamingReply}
        liveActivity={state.liveActivity}
        liveUsage={state.liveUsage}
        canSpeak={state.ttsAvailable}
        speakingMessageId={state.speakingMessageId}
        onSpeakMessage={actions.replayMessage}
        onDeleteMessage={actions.deleteMessage}
        onEditMessage={actions.editMessage}
        onAnswerQuestions={(text) => void actions.answerQuestions(text)}
        machineOps={machineOps}
        readServerFile={actions.readServerFile}
        onOpenImageInExplorer={(agentId, path) => actions.openUtility('explorer', agentId, path)}
        onOpenTerminal={(agentId, cwd) => actions.openUtility('console', agentId, cwd)}
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
        aiLabel={(activeConversation?.llmProvider ?? state.settings.llmProvider) === 'codex' ? 'Codex' : 'Claude'}
        voiceBar={
          <VoiceBar
            state={state.voice}
            replyStarted={state.streamingReply.length > 0}
            draft={state.draft}
            diarization={state.settings.diarization}
            detectedSpeakers={detectedSpeakers}
            aiLabel={(activeConversation?.llmProvider ?? state.settings.llmProvider) === 'codex' ? 'Codex' : 'Claude'}
            attachments={state.attachments}
            onDraftChange={actions.setDraft}
            onSubmitText={actions.submitText}
            onStartVoice={actions.startVoice}
            onStopVoice={actions.stopVoice}
            onStopSpeak={actions.stopSpeak}
            onCancelRequest={actions.cancelRequest}
            onAddFiles={(files) => files.forEach((f) => void actions.addAttachment(f))}
            onRemoveAttachment={actions.removeAttachment}
            permissionMode={activePermissionMode}
            onChangePermissionMode={(mode) => void changeConversationMode(mode)}
            voiceInputEnabled={VOICE_INPUT_ENABLED}
            featureAutomation={conversationFeature ? { autoMerge: conversationFeature.autoMerge, autoDeployProduction: conversationFeature.autoDeployProduction } : undefined}
            onFeatureAutomationChange={(fields) => void actions.setFeatureAutomation(fields)}
            promptHelper={state.promptHelper}
            onSuggestPrompts={() => void actions.suggestPrompts()}
            onApplyPromptSuggestion={actions.applyPromptSuggestion}
            onClosePromptSuggestions={actions.closePromptSuggestions}
          />
        }
      />
      )}

      {inProjects && !routeProjectId && (
        <ProjectsOverlay
          projects={state.projects}
          onOpenProject={(id) => navigate(`/projects/${id}`)}
          onCreate={(input) => void actions.createProject(input)}
          onClose={() => navigate(`/`)}
        />
      )}

      {inProjects && routeProjectId && !routeSettings && (
        <ProjectBoard
          projectName={
            state.projectDetail?.name ??
            state.projects.find((p) => p.id === routeProjectId)?.name ??
            `Проект`
          }
          board={state.board}
          loading={state.boardLoading || state.activeProjectId !== routeProjectId}
          members={state.projectDetail?.members ?? []}
          features={state.featureRuns}
          currentUser={state.currentUser?.name ?? null}
          onCreateColumn={(name) => void actions.createColumn(name)}
          onUpdateColumn={(id, fields) => void actions.updateColumn(id, fields)}
          onSetColumnHidden={(id, hidden) => void actions.setColumnHidden(id, hidden)}
          onReorderColumns={(order) => void actions.reorderColumns(order)}
          onDeleteColumn={(id) => void actions.deleteColumn(id)}
          onCreateTask={(columnId, input) => void actions.createTask(columnId, input)}
          onUpdateTask={(taskId, fields) => void actions.updateTask(taskId, fields)}
          onMoveTask={(taskId, columnId, afterId, beforeId) => void actions.moveTask(taskId, columnId, afterId, beforeId)}
          onDeleteTask={(taskId) => void actions.deleteTask(taskId)}
          onStartFeature={(itemId, type) => void (type === `story` ? actions.startFeatureFromStory(itemId) : actions.startFeature(itemId))}
          onOpenFeature={(id) => void actions.openFeature(id)}
          onOpenSettings={() => navigate(`/projects/${routeProjectId}/settings`)}
          onClose={() => navigate(`/projects`)}
        />
      )}

      {inProjects && routeProjectId && routeSettings && state.projectDetail?.id === routeProjectId && (
        <ProjectSettings
          detail={state.projectDetail}
          agents={state.agents}
          onUpdate={(id, fields) => void actions.updateProject(id, fields)}
          onDelete={(id) => { void actions.deleteProject(id); navigate(`/projects`) }}
          onAddMember={(id, username) => void actions.addProjectMember(id, username)}
          onRemoveMember={(id, username) => void actions.removeProjectMember(id, username)}
          onLinkMachine={(id, agentId) => void actions.linkProjectMachine(id, agentId)}
          onUnlinkMachine={(id, agentId) => void actions.unlinkProjectMachine(id, agentId)}
          onSetMachinePath={(id, agentId, path) => void actions.setProjectMachinePath(id, agentId, path)}
          onSetFeatureReposRoot={(id, agentId, root) => void actions.setProjectFeatureReposRoot(id, agentId, root)}
          onSetDefaultMachine={(id, agentId) => void actions.setProjectDefaultMachine(id, agentId)}
          onClose={() => navigate(`/projects/${routeProjectId}`)}
        />
      )}

      {utilitySeg === 'kb' && <KnowledgeBase api={api} variant="page" onClose={() => navigate('/')} />}

      {utilitySeg === 'claude-code' && state.ccOpen && (
        <CcObserver
          variant="page"
          projects={state.ccProjects}
          sessions={state.ccSessions}
          transcript={state.ccTranscript}
          activeProject={state.ccProjectSlug}
          activeSession={state.ccSessionId}
          onSelectProject={actions.selectCcProject}
          onSelectSession={actions.selectCcSession}
          onResumeSession={(slug, id) => void actions.resumeCcSession(slug, id)}
          onClose={() => navigate('/')}
        />
      )}

      {utilitySeg === 'codex' && state.cxOpen && (
        <CodexObserver
          variant="page"
          projects={state.cxProjects}
          sessions={state.cxSessions}
          transcript={state.cxTranscript}
          activeProject={state.cxProjectCwd}
          activeSession={state.cxSessionId}
          onSelectProject={actions.selectCxProject}
          onSelectSession={actions.selectCxSession}
          onResumeSession={(id) => void actions.resumeCxSession(id)}
          onClose={() => navigate('/')}
        />
      )}

      {utilitySeg === 'machines' && state.machinesOpen && (
        <MachineStatus
          variant="page"
          agents={state.agents}
          onSetPolicy={(id, policy) => void actions.setAgentPolicy(id, policy)}
          onCreateAgent={actions.createAgent}
          onRegenerateToken={actions.regenerateAgentToken}
          onGetConnectionString={actions.getAgentConnectionString}
          onUpdateAgent={actions.updateAgent}
          defaultAgentId={state.settings.defaultAgentId}
          onSetDefault={(id) => void actions.updateSettings({ defaultAgentId: id })}
          onClose={() => navigate('/')}
        />
      )}

      {utilitySeg === 'users' && state.usersOpen && (
        <UsersAdmin
          variant="page"
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
          onClose={() => navigate('/')}
        />
      )}

      {conversationSettingsOpen && activeConversation && (
        <ConversationSettings
          conversation={activeConversation}
          agents={state.agents}
          machineOps={machineOps}
          role={state.currentUser?.role ?? 'admin'}
          settings={state.settings}
          defaultAgentId={state.settings.defaultAgentId}
          projects={state.projects}
          fetchProjectDetail={actions.fetchProjectDetail}
          onSave={async ({ title, execTarget, workdir, skillNames, llmProvider, llmModel, permissionMode, kbContextMode, projectId }) => {
            await actions.renameConversation(activeConversation.id, title)
            await actions.setConversationProject(activeConversation.id, projectId)
            await actions.setConversationExecTarget(activeConversation.id, execTarget, workdir, skillNames, llmProvider, llmModel, permissionMode, kbContextMode)
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

      {state.activeFeature && (
        <FeatureDetail
          feature={state.activeFeature}
          tasks={state.agentTasks}
          onTransition={(status) => void actions.transitionFeature(status)}
          onAutomation={(fields) => void actions.setFeatureAutomation(fields)}
          onAddTask={(input) => void actions.createAgentTask(input)}
          onDeploy={() => void actions.deployFeature()}
          onClose={actions.closeFeature}
        />
      )}

      {state.utility && machineOps && (
        <MachineUtility
          tool={{
            kind: state.utility.kind,
            ...(state.utility.agentId ? { agentId: state.utility.agentId } : {}),
            ...(state.utility.path ? { path: state.utility.path } : {}),
            ...(state.utility.dir ? { dir: true } : {})
          }}
          agents={state.agents}
          ops={machineOps}
          variant="modal"
          onOpenTerminal={(agentId, cwd) => actions.openUtility('console', agentId, cwd)}
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
          onDownloadDesktopApp={() => void actions.downloadDesktopApp()}
          onDownloadAgentApp={() => void actions.downloadAgentApp()}
          onDownloadAgentScript={() => void actions.downloadAgentScript()}
          onChange={actions.updateSettings}
          onDownloadVoice={actions.downloadVoice}
          onDeleteVoice={actions.deleteVoice}
          onDeleteModel={actions.deleteModel}
          role={state.currentUser?.role ?? 'admin'}
          voiceInputEnabled={VOICE_INPUT_ENABLED}
          onClose={actions.closeSettings}
        />
      )}
    </div>
  )
}
