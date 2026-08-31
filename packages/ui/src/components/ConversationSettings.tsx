import { useEffect, useState } from 'react'
import { KB_CONTEXT_MODES, normalizeClaudeModel, PERMISSION_MODES } from '@shared/types'
import type { ChatInstruction, Conversation, KbContextMode, LlmProvider, PermissionMode, Settings, UserRole } from '@shared/types'
import type { AgentInfo, AgentSkill, FsEntry } from '@shared/agentProtocol'
import type { LlmEngineOption } from '@shared/admin'
import type { ChatStorageView, MachineStorage, ProjectDetail, ProjectMachine, ProjectSummary } from '@shared/projects'
import { ChatStorageCard } from './ChatStorageCard'
import type { UserLlmAccess } from '@shared/llmAccess'
import type { MachineOps } from './machine'
import { PopupFrame } from './PopupFrame'
import { Button } from '@voicechat/ui-kit'
import { IconButton } from '@voicechat/ui-kit'
import { useConfirm } from '@voicechat/ui-kit'
import { useToast } from '@voicechat/ui-kit'
import { LlmSettingsEditor } from './LlmSettingsEditor'
import { SettingsPage } from './SettingsPage'
import { ContextInspector } from './ContextInspector'

export interface ConversationSettingsProps {
  conversation: Conversation
  agents: AgentInfo[]
  machineOps?: MachineOps
  /** Роль пользователя — прячет модели Claude, недоступные роли user. */
  role: UserRole
  llmAccess?: UserLlmAccess[]
  /** Общие настройки — дефолты движка/модели, когда разговор их не переопределяет. */
  settings: Pick<Settings, 'llmProvider' | 'model' | 'codexModel' | 'permissionMode'> & { llmEngineId?: string | null }
  engines?: LlmEngineOption[]
  /** Машина по умолчанию — предвыбирается в новых разговорах и помечается в списке. */
  defaultAgentId?: string | null
  /** Проекты пользователя — для привязки чата к проекту. */
  projects: ProjectSummary[]
  /** Доступно только для активного Web Reader-разговора. */
  webReaderDiagnostics?: { running: boolean; onRun: () => void }
  /** Доступно только для активного Playwright Reader-разговора. */
  playwrightReaderDiagnostics?: { running: boolean; onRun: () => void }
  /** Доступно только для активного чата «Консоль с ассистентом». */
  consoleReaderDiagnostics?: { running: boolean; onRun: () => void }
  makeDiagnostics?: { running: boolean; onRun: () => void }
  /** Сквозная самодиагностика чата (клиент→сервер→модель→БД) — в обычном чате. */
  chatDiagnostics?: { running: boolean; onRun: () => void }
  /** Открыть проводник машины в каталоге результатов чата. */
  onOpenExplorer?: (agentId: string, path: string) => void
  /** Загрузка деталей проекта (машины/папки/дефолт) для выбранного проекта. */
  fetchProjectDetail: (id: string) => Promise<ProjectDetail | null>
  /** Серверный список машин с тем же правилом доступа, что используется при сохранении. */
  fetchMachines?: (conversationId: string, projectId?: string | null) => Promise<AgentInfo[]>
  onSave: (value: {
    title: string
    execTarget: string | null
    workdir: string | null
    skillNames: string[]
    llmEngineId?: string | null
    llmProvider: LlmProvider | null
    llmModel: string | null
    permissionMode: PermissionMode | null
    kbContextMode: KbContextMode
    projectId: string | null
  }) => Promise<void>
  onAddSkill: (agentId: string, skill: AgentSkill) => Promise<void>
  /** Инструкции чата из общих настроек — инспектор контекста правит их текст. */
  chatInstructions?: ChatInstruction[]
  /** Сохранить текст инструкции (общая настройка пользователя). */
  onSaveInstruction?: (id: string, text: string) => Promise<void>
  /** Открыть существующую панель статистики БЗ текущего разговора. */
  onOpenKbUsage?: () => void
  onClose: () => void
}

function parentOf(path: string): string {
  const up = path.replace(/\/+$/, '').replace(/\/[^/]*$/, '')
  return up || '/'
}

function joinPath(dir: string, name: string): string {
  return `${dir.replace(/\/$/, '')}/${name}`
}

function modeLabel(id: PermissionMode): string {
  return PERMISSION_MODES.find((m) => m.id === id)?.label ?? id
}

export function ConversationSettings({ conversation, agents, machineOps, role, llmAccess = [], settings, engines = [], projects, webReaderDiagnostics, playwrightReaderDiagnostics, consoleReaderDiagnostics, makeDiagnostics, chatDiagnostics, onOpenExplorer, fetchProjectDetail, fetchMachines, onSave, onAddSkill, chatInstructions, onSaveInstruction, onOpenKbUsage, onClose }: ConversationSettingsProps): JSX.Element {
  const confirm = useConfirm()
  const toast = useToast()
  const [title, setTitle] = useState(conversation.title)
  const contextRoutePrefix = `#/chat/${encodeURIComponent(conversation.id)}/context/`
  const [activeTab, setActiveTab] = useState<'general' | 'llm' | 'context'>(() => window.location.hash.startsWith(contextRoutePrefix) ? 'context' : 'general')
  const [execTarget, setExecTarget] = useState<string | null>(conversation.execTarget)
  const [workdir, setWorkdir] = useState<string | null>(conversation.workdir)
  const [skillNames, setSkillNames] = useState<string[]>(conversation.skillNames)
  const [llmEngineId, setLlmEngineId] = useState<string | null>(conversation.llmEngineId ?? settings.llmEngineId ?? null)
  const initialProvider: LlmProvider = conversation.llmProvider ?? settings.llmProvider
  const [llmProvider, setLlmProvider] = useState<LlmProvider>(initialProvider)
  const userLlm = { engineId: settings.llmEngineId ?? null, provider: settings.llmProvider, model: settings.llmProvider === 'codex' ? settings.codexModel : normalizeClaudeModel(settings.model) }
  const [inheritedLlm, setInheritedLlm] = useState(userLlm)
  const [llmOverridden, setLlmOverridden] = useState(conversation.llmProvider !== null || (conversation.llmEngineId ?? null) !== null)
  const [llmModel, setLlmModel] = useState<string>(
    conversation.llmProvider && conversation.llmModel !== null ? conversation.llmModel : userLlm.model
  )
  // '' — «как в общих настройках» (в БД хранится null).
  const [permissionMode, setPermissionMode] = useState<PermissionMode | ''>(conversation.permissionMode ?? '')
  const [kbContextMode, setKbContextMode] = useState<KbContextMode>(conversation.kbContextMode ?? 'auto')
  const [cwd, setCwd] = useState('')
  const [entries, setEntries] = useState<FsEntry[]>([])
  const [loadingDir, setLoadingDir] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [skillName, setSkillName] = useState('')
  const [skillCommand, setSkillCommand] = useState('')
  const [projectId, setProjectId] = useState<string | null>(conversation.projectId ?? null)
  const [projectMachines, setProjectMachines] = useState<ProjectMachine[]>([])
  const [availableAgents, setAvailableAgents] = useState<AgentInfo[]>(agents)
  const [machineAccessLost, setMachineAccessLost] = useState(false)
  const [storages, setStorages] = useState<MachineStorage[]>([])
  const [storageId, setStorageId] = useState('')
  const [storagePath, setStoragePath] = useState('')
  const [storageView, setStorageView] = useState<ChatStorageView | null>(null)
  useEffect(() => {
    const syncContextRoute = (): void => {
      if (window.location.hash.startsWith(contextRoutePrefix)) setActiveTab('context')
    }
    window.addEventListener('hashchange', syncContextRoute)
    return () => window.removeEventListener('hashchange', syncContextRoute)
  }, [contextRoutePrefix])
  const selectTab = (tab: 'general' | 'llm' | 'context'): void => {
    if (window.location.hash.startsWith(contextRoutePrefix)) {
      window.location.hash = `/chat/${encodeURIComponent(conversation.id)}`
    }
    setActiveTab(tab)
  }
  // Список машин выбранного проекта (для фильтра и подстановки папок).
  useEffect(() => {
    let alive = true
    if (!projectId) {
      setProjectMachines([])
      return
    }
    void fetchProjectDetail(projectId).then((d) => {
      if (alive && d) {
        setProjectMachines(d.machines)
        void window.ci?.getProjectCiLlm(projectId).then((view) => {
          if (!alive) return
          const inherited = { engineId: settings.llmEngineId ?? null, provider: view.config.provider, model: view.config.model }
          setInheritedLlm(inherited)
          if (!llmOverridden) { setLlmEngineId(inherited.engineId); setLlmProvider(inherited.provider); setLlmModel(inherited.model) }
        })
      }
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  useEffect(() => {
    let alive = true
    const load = fetchMachines
      ? fetchMachines(conversation.id, projectId)
      : Promise.resolve(agents)
    void load.then((next) => {
      if (!alive) return
      const unique = [...new Map(next.map((agent) => [agent.id, agent])).values()]
      setAvailableAgents(unique)
      setExecTarget((current) => {
        if (current && current !== 'none' && !next.some((agent) => agent.id === current)) {
          setMachineAccessLost(true)
          setWorkdir(null)
          setSkillNames([])
          return null
        }
        setMachineAccessLost(false)
        return current
      })
    }).catch((err) => {
      if (alive) setError(err instanceof Error ? err.message : String(err))
    })
    return () => { alive = false }
  }, [conversation.id, projectId, fetchMachines]) // eslint-disable-line react-hooks/exhaustive-deps

  // Смена проекта — применяем настройки проекта к чату (перезапись машины/папки/навыков).
  const onChangeProject = async (id: string | null): Promise<void> => {
    setProjectId(id)
    if (!id) return
    const d = await fetchProjectDetail(id)
    if (!d) return
    setProjectMachines(d.machines)
    setExecTarget(null)
    setWorkdir(null)
    setSkillNames([...d.skills])
    setCwd('')
    setEntries([])
    const view = await window.ci?.getProjectCiLlm(id)
    if (view) {
      const inherited = { engineId: settings.llmEngineId ?? null, provider: view.config.provider, model: view.config.model }
      setInheritedLlm(inherited); setLlmEngineId(inherited.engineId); setLlmProvider(inherited.provider); setLlmModel(inherited.model); setLlmOverridden(false)
    }
  }
  const [skillDescription, setSkillDescription] = useState('')
  const [saving, setSaving] = useState(false)

  const selectedAgent = execTarget
    ? availableAgents.find((agent) => agent.id === execTarget)
    : availableAgents.find((agent) => agent.isEffective)
  const skills = selectedAgent?.policy.skills ?? []

  useEffect(() => {
    let alive = true
    if (!selectedAgent || !window.api) { setStorages([]); setStorageId(''); return }
    void Promise.all([
      window.api['agents:listStorages']({ id: selectedAgent.id }),
      window.api['conversations:getStorage']({ id: conversation.id })
    ]).then(([nextStorages, binding]) => {
      if (!alive) return
      setStorages(nextStorages)
      setStorageView(binding)
      if (binding?.machineId === selectedAgent.id) {
        setStorageId(binding.storageId)
        setStoragePath(binding.relativePath)
      } else {
        setStorageId(nextStorages.find((item) => item.primary && item.status === 'ready')?.id ?? nextStorages.find((item) => item.status === 'ready')?.id ?? '')
        setStoragePath('')
      }
    }).catch((err) => { if (alive) setError(err instanceof Error ? err.message : String(err)) })
    return () => { alive = false }
  }, [conversation.id, selectedAgent?.id])

  useEffect(() => {
    setSkillNames((current) => current.filter((name) => skills.some((skill) => skill.name === name)))
  }, [execTarget]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadDir = async (path: string): Promise<void> => {
    if (!machineOps || !selectedAgent) return
    setLoadingDir(true)
    try {
      const result = await machineOps.list(selectedAgent.id, path)
      setCwd(result.cwd)
      setEntries(result.entries ?? [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingDir(false)
    }
  }

  const addSkill = async (): Promise<void> => {
    const name = skillName.trim()
    const command = skillCommand.trim()
    if (!selectedAgent || !name || !command) return
    if (skills.some((skill) => skill.name === name)) {
      setError('Навык с таким названием уже существует.')
      return
    }
    const skill: AgentSkill = { name, command, ...(skillDescription.trim() ? { description: skillDescription.trim() } : {}) }
    await onAddSkill(selectedAgent.id, skill)
    setSkillNames((current) => [...current, name])
    setSkillName('')
    setSkillCommand('')
    setSkillDescription('')
  }

  const save = async (): Promise<void> => {
    const cleanTitle = title.trim()
    if (!cleanTitle) {
      setError('Введите название разговора.')
      return
    }
    const startedInPlan =
      (role !== 'admin' && (!conversation.execTarget || conversation.execTarget === 'none')) ||
      (conversation.permissionMode ?? settings.permissionMode) === 'plan'
    if (
      startedInPlan &&
      permissionMode === 'bypassPermissions' &&
      !(await confirm({
        title: 'Полный доступ',
        message: 'Перейти из планирования в «Полный доступ»? Агент сможет выполнять команды и изменять любые доступные файлы.',
        confirmLabel: 'Перейти'
      }))
    ) return
    setSaving(true)
    try {
      const inheritsGlobal = !llmOverridden || (
        llmProvider === inheritedLlm.provider &&
        llmModel === inheritedLlm.model &&
        llmEngineId === (inheritedLlm.engineId ?? null)
      )
      await onSave({
        title: cleanTitle,
        execTarget,
        workdir: execTarget ? workdir : null,
        skillNames: execTarget ? skillNames : [],
        ...(conversation.llmEngineId !== undefined || settings.llmEngineId !== undefined ? { llmEngineId: inheritsGlobal ? null : llmEngineId } : {}),
        llmProvider: inheritsGlobal ? null : llmProvider,
        llmModel: inheritsGlobal ? null : llmModel,
        permissionMode: permissionMode || null,
        kbContextMode,
        projectId
      })
      if (selectedAgent && storageId) {
        await window.api['conversations:setStorage']({ id: conversation.id, machineId: selectedAgent.id, storageId, ...(storagePath.trim() ? { relativePath: storagePath.trim() } : {}) })
      }
      toast.success('Настройки сохранены')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  // Фактический режим хода: сервер форсит «план», когда роль user работает без своей машины (turns.ts).
  const forcedPlan = role !== 'admin' && (!execTarget || execTarget === 'none')
  const effectiveMode: PermissionMode = forcedPlan ? 'plan' : permissionMode || settings.permissionMode

  return (
    <PopupFrame title="Настройки разговора" onClose={onClose} testId="conversation-settings-overlay" panelClassName="convsettings">
      <header className="convsettings-head">
        <IconButton className="convsettings-back" onClick={onClose} aria-label="Вернуться в разговор" title="Вернуться в разговор">←</IconButton>
        <div><h1>Настройки разговора</h1><p>Параметры применяются только к этому разговору</p></div>
      </header>
      <SettingsPage
        ariaLabel="Разделы настроек чата"
        activeTab={activeTab}
        onTabChange={selectTab}
        tabs={[{ id: 'general', label: 'Общее' }, { id: 'llm', label: 'LLM' }, { id: 'context', label: 'Контекст и инструкции' }]}
      />
      <main className={`convsettings-body convsettings-tab-${activeTab}`}>
        {activeTab === 'context' && <ContextInspector
          conversationId={conversation.id}
          provider={llmProvider}
          model={llmModel}
          permissionMode={effectiveMode}
          kbMode={kbContextMode}
          agent={selectedAgent}
          workdir={workdir}
          project={projects.find((project) => project.id === projectId)}
          selectedSkillNames={skillNames}
          onOpenSettings={() => selectTab('general')}
          execTarget={execTarget}
          onToggleSkill={(name, selected) => setSkillNames((prev) => selected ? [...new Set([...prev, name])] : prev.filter((entry) => entry !== name))}
          {...(chatInstructions ? { chatInstructions } : {})}
          {...(onSaveInstruction ? { onSaveInstruction } : {})}
          onQuickEdit={(patch) => {
            // Быстрая правка уже сохранена на сервере; черновик окна обязан
            // догнать её, иначе кнопка «Сохранить» вернёт старое значение.
            if (patch.kbContextMode) setKbContextMode(patch.kbContextMode)
            if (patch.permissionMode !== undefined) setPermissionMode(patch.permissionMode ?? '')
            // Сброс переопределения движка: черновик возвращается к наследуемым
            // значениям, иначе «Сохранить» снова запишет прежний override.
            if (patch.llmProvider === null) {
              setLlmOverridden(false)
              setLlmEngineId(inheritedLlm.engineId)
              setLlmProvider(inheritedLlm.provider)
              setLlmModel(inheritedLlm.model)
            }
          }}
        />}
        {webReaderDiagnostics && <section className="convsettings-card" aria-label="Самодиагностика Web Reader">
          <div className="convsettings-sectionhead"><div><h2>Web Reader</h2><p>Проверяет cookie, proxy, загрузку, DOM-мост, события, навигацию, очередь и requestId на внутренней странице. Полный перечень и результаты появятся в чате.</p></div><Button onClick={webReaderDiagnostics.onRun} disabled={webReaderDiagnostics.running}>{webReaderDiagnostics.running ? 'Выполняется…' : 'Самодиагностика'}</Button></div>
        </section>}
        {playwrightReaderDiagnostics && <section className="convsettings-card" aria-label="Самодиагностика Playwright Reader">
          <div className="convsettings-sectionhead"><div><h2>Playwright Reader</h2><p>Проверяет браузерный мост, запуск изолированного Chromium, метаданные сессии, кадр screencast и команду reload. Проверки не уводят открытую страницу; результаты появятся в чате.</p></div><Button onClick={playwrightReaderDiagnostics.onRun} disabled={playwrightReaderDiagnostics.running}>{playwrightReaderDiagnostics.running ? 'Выполняется…' : 'Самодиагностика'}</Button></div>
        </section>}
        {consoleReaderDiagnostics && <section className="convsettings-card" aria-label="Самодиагностика Консоли">
          <div className="convsettings-sectionhead"><div><h2>Консоль с ассистентом</h2><p>Проверяет PTY-мост, наличие машины в сети и живой round-trip: команда, отправленная в общий терминал, выполняется в shell и её вывод возвращается. Результаты появятся в чате.</p></div><Button onClick={consoleReaderDiagnostics.onRun} disabled={consoleReaderDiagnostics.running}>{consoleReaderDiagnostics.running ? 'Выполняется…' : 'Самодиагностика'}</Button></div>
        </section>}
        {makeDiagnostics && <section className="convsettings-card" aria-label="Самодиагностика Make">
          <div className="convsettings-sectionhead"><div><h2>Make — веб-проект</h2><p>Проверяет REST проекта, отдачу превью с preview-cookie, round-trip записи файла и событие make.changed, которым панель узнаёт о правках ассистента. Результаты появятся в чате.</p></div><Button onClick={makeDiagnostics.onRun} disabled={makeDiagnostics.running}>{makeDiagnostics.running ? 'Выполняется…' : 'Самодиагностика'}</Button></div>
        </section>}
        {chatDiagnostics && <section className="convsettings-card" aria-label="Самодиагностика чата">
          <div className="convsettings-sectionhead"><div><h2>Самодиагностика чата</h2><p>Сквозная проверка «клиент → сервер → модель → БД»: HTTP и WebSocket, вход CLI, MCP-серверы, реальный ход модели, запись и чтение сообщения. Результаты появятся в чате.</p></div><Button onClick={chatDiagnostics.onRun} disabled={chatDiagnostics.running}>{chatDiagnostics.running ? 'Выполняется…' : 'Самодиагностика'}</Button></div>
        </section>}
        <section className="convsettings-card">
          <label className="convsettings-field"><span>Название разговора</span><input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
          <label className="convsettings-field"><span>Проект</span>
            <select aria-label="Проект разговора" value={projectId ?? ''} onChange={(e) => void onChangeProject(e.target.value || null)}>
              <option value="">Без проекта</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="convsettings-field"><span>Машина</span>
            <select aria-label="Машина разговора" value={execTarget ?? ''} onChange={(e) => {
              const v = e.target.value || null
              setExecTarget(v)
              const pm = projectMachines.find((m) => m.agentId === v)
              setWorkdir(projectId ? (pm && pm.path ? pm.path : null) : null)
              setCwd(''); setEntries([])
            }}>
              <option value="">{availableAgents.find((agent) => agent.isEffective)?.effectiveSource === 'fallback' ? 'Автовыбор: ' : 'Моя машина по умолчанию: '}{availableAgents.find((agent) => agent.isEffective)?.name ?? 'нет доступной машины'}</option>
              {availableAgents.some((a) => agents.some((own) => own.id === a.id)) && <optgroup label="Мои машины">
                {availableAgents.filter((a) => agents.some((own) => own.id === a.id)).map((agent) => <option key={agent.id} value={agent.id}>{agent.name}{agent.isDefault ? ' — моя по умолчанию' : ''}{agent.online ? '' : ' (офлайн)'}</option>)}
              </optgroup>}
              {projectId && availableAgents.some((a) => !agents.some((own) => own.id === a.id)) && <optgroup label="Машины проекта">
                {availableAgents.filter((a) => !agents.some((own) => own.id === a.id)).map((agent) => <option key={agent.id} value={agent.id}>{agent.name}{agent.isDefault ? ' — моя по умолчанию' : ''}{agent.online ? '' : ' (офлайн)'}</option>)}
              </optgroup>}
            </select>
          </label>
          {machineAccessLost && <p className="convsettings-muted" role="status">Ранее выбранная машина больше недоступна. Выберите другую машину.</p>}
          <section aria-labelledby="chat-files-title">
            <div className="convsettings-sectionhead"><div><h2 id="chat-files-title">Файлы чата</h2><p>Выбранная машина, зарегистрированное хранилище и относительный каталог разговора.</p></div></div>
          {selectedAgent ? <>
            <p className="convsettings-muted">Машина хранения: <b>{selectedAgent.name}</b></p>
            <label className="convsettings-field"><span>Файловое хранилище</span>
              <select aria-label="Файловое хранилище разговора" value={storageId} onChange={(event) => { setStorageId(event.target.value); setStoragePath('') }}>
                <option value="">Временный legacy-режим</option>
                {storages.map((storage) => <option key={storage.id} value={storage.id} disabled={storage.status !== 'ready'}>{storage.rootPath}{storage.primary ? ' — основное' : ''}{storage.status === 'ready' ? '' : ` (${storage.status === 'offline' ? 'офлайн' : 'недоступно'})`}</option>)}
              </select>
            </label>
            <label className="convsettings-field"><span>Файловый каталог</span>
              <input aria-label="Файловый каталог разговора" value={storagePath} disabled={!storageId} placeholder="Автоматический изолированный путь" onChange={(event) => setStoragePath(event.target.value)} />
            </label>
            <p className="convsettings-muted">Основное хранилище: {storages.find((storage) => storage.primary)?.rootPath ?? 'не назначено'}</p>
            <h3 className="convsettings-subtitle">Каталог результатов</h3>
            <ChatStorageCard storage={storageView} machineName={storageView ? agents.find((a) => a.id === storageView.machineId)?.name : undefined} onOpenExplorer={onOpenExplorer} />
            {!storageId && <p className="convsettings-muted" role="alert">Временный legacy-режим использует <b>.voicechat_uploads</b>. Старые файлы автоматически не переносятся.</p>}
            <p className="convsettings-muted">Вложения и закреплённые файлы хранятся здесь. Рабочий Git-каталог настраивается отдельно ниже.</p>
          </> : <p className="convsettings-muted">Нет доступной машины или хранилища. Настройте хранилище в разделе машины.</p>}
          </section>
          {projectId && <p className="convsettings-muted">Доступны ваши личные машины и машины проекта; смена проекта предложит хранилище эффективной машины, но сохранённая привязка изменится только после сохранения.</p>}
          {conversation.workspace && <section aria-labelledby="managed-workspace-title" data-testid="managed-workspace-view">
            <div className="convsettings-sectionhead"><div><h2 id="managed-workspace-title">Git workspace</h2><p>Управляется сервером и не редактируется как произвольный cwd.</p></div></div>
            <dl>
              <dt>Режим</dt><dd>{conversation.workspace.mode}</dd>
              <dt>Состояние</dt><dd>{conversation.workspace.state}</dd>
              <dt>SHA</dt><dd title={conversation.workspace.baseSha ?? undefined}>{conversation.workspace.baseSha ?? '—'}</dd>
              <dt>Ветка</dt><dd>{conversation.workspace.branch ?? '—'}</dd>
              <dt>Путь</dt><dd>{conversation.workspace.path ?? '—'}</dd>
            </dl>
            {conversation.workspace.diagnostic && <p role="alert">{conversation.workspace.diagnostic}</p>}
          </section>}
        </section>

        <section className="convsettings-card convsettings-llm-card">
          <div className="convsettings-sectionhead"><div><h2>LLM</h2><p>Чат наследует эффективные настройки проекта, а без проекта — пользователя.</p></div></div>
          <LlmSettingsEditor
            value={{ engineId: llmEngineId, provider: llmProvider, model: llmModel }}
            inherited={inheritedLlm}
            overridden={llmOverridden}
            engines={engines}
            llmAccess={llmAccess}
            labels={{ engine: 'Исполнитель разговора', provider: 'Движок разговора', model: 'Модель разговора' }}
            onChange={(next) => { setLlmEngineId(next.engineId ?? null); setLlmProvider(next.provider); setLlmModel(next.model); setLlmOverridden(true) }}
            onReset={() => { setLlmEngineId(inheritedLlm.engineId ?? null); setLlmProvider(inheritedLlm.provider); setLlmModel(inheritedLlm.model); setLlmOverridden(false) }}
          />
        </section>

        <section className="convsettings-card">
          <div className="convsettings-sectionhead"><div><h2>База знаний проекта</h2><p>Как модель получает сведения об устройстве voiceAIChat. Политика проекта — искать в базе знаний до чтения кода.</p></div>{onOpenKbUsage && <Button variant="secondary" onClick={onOpenKbUsage}>Использование базы знаний</Button>}</div>
          <label className="convsettings-field"><span>Контекст KB</span>
            <select aria-label="Контекст базы знаний" value={kbContextMode} onChange={(e) => setKbContextMode(e.target.value as KbContextMode)}>
              {KB_CONTEXT_MODES.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
            </select>
          </label>
          <p className="convsettings-muted" data-testid="conv-kb-hint">
            {kbContextMode === 'auto'
              ? 'Сервер подмешивает подходящие разделы в промпт при высокой уверенности, и модель может дозапросить любые другие инструментами mcp__kb__*.'
              : kbContextMode === 'manual'
                ? 'Авто-контекста нет: модель сама решает, что читать, инструментами mcp__kb__* — и получает указание искать в базе знаний до чтения кода.'
                : 'Ни авто-контекста, ни инструментов: модель разбирается только по коду.'}
          </p>
        </section>

        <section className="convsettings-card">
          <div className="convsettings-sectionhead"><div><h2>Режим работы</h2><p>Что агенту разрешено в этом разговоре; по умолчанию — из общих настроек.</p></div></div>
          <label className="convsettings-field"><span>Режим</span>
            <select aria-label="Режим разговора" value={permissionMode} onChange={(e) => setPermissionMode(e.target.value as PermissionMode | '')}>
              <option value="">Как в общих настройках — {modeLabel(settings.permissionMode)}</option>
              {PERMISSION_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>
          <p className="convsettings-muted" data-testid="conv-mode-current">
            Сейчас действует: <b>{modeLabel(effectiveMode)}</b>
            {forcedPlan && ' — без своей машины команды не выполняются, доступно только планирование'}
          </p>
        </section>

        {selectedAgent && <>
          {!conversation.workspace && <section className="convsettings-card">
            <div className="convsettings-sectionhead"><div><h2>Корневая директория</h2><p>Команды этого разговора будут начинаться в выбранной папке.</p></div><Button onClick={() => void loadDir(workdir ?? '')} loading={loadingDir} disabled={!selectedAgent.online}>Выбрать</Button></div>
            <div className="convsettings-path">{workdir || 'Корень машины'}</div>
            {(cwd || entries.length > 0 || loadingDir) && <div className="convsettings-picker">
              <div className="convsettings-pickerbar"><IconButton onClick={() => void loadDir(parentOf(cwd))} title="На уровень выше" aria-label="На уровень выше">↑</IconButton><span>{cwd}</span><Button onClick={() => { setWorkdir(cwd); setEntries([]) }}>Выбрать эту папку</Button></div>
              {loadingDir ? <p>Загрузка…</p> : entries.filter((entry) => entry.kind === 'dir').map((entry) => <button className="convsettings-dir" key={entry.name} onClick={() => void loadDir(joinPath(cwd, entry.name))}>📁 {entry.name}</button>)}
            </div>}
          </section>}

          <section className="convsettings-card">
            <div className="convsettings-sectionhead"><div><h2>Навыки</h2><p>Отметьте навыки, доступные модели в этом разговоре.</p></div></div>
            <div className="convsettings-skills">
              {skills.length === 0 && <p className="convsettings-muted">У машины пока нет навыков.</p>}
              {skills.map((skill) => <label className="convsettings-skill" key={skill.name}><input type="checkbox" checked={skillNames.includes(skill.name)} onChange={(e) => setSkillNames((current) => e.target.checked ? [...current, skill.name] : current.filter((name) => name !== skill.name))} /><span><b>{skill.name}</b>{skill.description && <small>{skill.description}</small>}<code>{skill.command}</code></span></label>)}
            </div>
            <div className="convsettings-add"><h3>Добавить навык</h3><input placeholder="Название" value={skillName} onChange={(e) => setSkillName(e.target.value)} /><input placeholder="Команда" value={skillCommand} onChange={(e) => setSkillCommand(e.target.value)} /><input placeholder="Описание (необязательно)" value={skillDescription} onChange={(e) => setSkillDescription(e.target.value)} /><Button disabled={!skillName.trim() || !skillCommand.trim()} onClick={() => void addSkill()}>Добавить</Button></div>
          </section>
        </>}
        {error && <p className="convsettings-error" role="alert">{error}</p>}
      </main>
      <footer className="convsettings-footer"><Button onClick={onClose}>Отмена</Button><Button variant="primary" loading={saving} onClick={() => void save()}>{saving ? 'Сохранение…' : 'Сохранить'}</Button></footer>
    </PopupFrame>
  )
}
