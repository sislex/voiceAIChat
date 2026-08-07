import { useEffect, useState } from 'react'
import { normalizeClaudeModel, PERMISSION_MODES } from '@shared/types'
import type { Conversation, KbContextMode, LlmProvider, PermissionMode, Settings, UserRole } from '@shared/types'
import type { AgentInfo, AgentSkill, FsEntry } from '@shared/agentProtocol'
import type { LlmEngineOption } from '@shared/admin'
import type { ProjectDetail, ProjectMachine, ProjectSummary } from '@shared/projects'
import type { UserLlmAccess } from '@shared/llmAccess'
import type { MachineOps } from './machine'
import { PopupFrame } from './PopupFrame'
import { Button } from './ui/Button'
import { IconButton } from './ui/IconButton'
import { useConfirm } from './ui/useConfirm'
import { useToast } from './ui/Toast'
import { LlmSettingsEditor } from './LlmSettingsEditor'
import { SettingsPage } from './SettingsPage'

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
  /** Загрузка деталей проекта (машины/папки/дефолт) для выбранного проекта. */
  fetchProjectDetail: (id: string) => Promise<ProjectDetail | null>
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

export function ConversationSettings({ conversation, agents, machineOps, role, llmAccess = [], settings, engines = [], defaultAgentId, projects, fetchProjectDetail, onSave, onAddSkill, onClose }: ConversationSettingsProps): JSX.Element {
  const confirm = useConfirm()
  const toast = useToast()
  const [title, setTitle] = useState(conversation.title)
  const [activeTab, setActiveTab] = useState<'general' | 'llm'>('general')
  const defaultExecTarget = defaultAgentId && agents.some((a) => a.id === defaultAgentId) ? defaultAgentId : null
  const [execTarget, setExecTarget] = useState<string | null>(
    conversation.execTarget ?? (conversation.messageCount === 0 ? defaultExecTarget : null)
  )
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
  const [projectDefaultAgentId, setProjectDefaultAgentId] = useState<string | null>(null)
  // Список машин выбранного проекта (для фильтра и подстановки папок).
  useEffect(() => {
    let alive = true
    if (!projectId) {
      setProjectMachines([])
      setProjectDefaultAgentId(null)
      return
    }
    void fetchProjectDetail(projectId).then((d) => {
      if (alive && d) {
        setProjectMachines(d.machines)
        setProjectDefaultAgentId(d.defaultAgentId)
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
  // Смена проекта — применяем настройки проекта к чату (перезапись машины/папки/навыков).
  const onChangeProject = async (id: string | null): Promise<void> => {
    setProjectId(id)
    if (!id) return
    const d = await fetchProjectDetail(id)
    if (!d) return
    setProjectMachines(d.machines)
    setProjectDefaultAgentId(d.defaultAgentId)
    setExecTarget(d.defaultAgentId)
    const dm = d.defaultAgentId ? d.machines.find((m) => m.agentId === d.defaultAgentId) : undefined
    setWorkdir(dm && dm.path ? dm.path : null)
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

  const selectedAgent = agents.find((agent) => agent.id === execTarget)
  const skills = selectedAgent?.policy.skills ?? []

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
      (role === 'user' && (!conversation.execTarget || conversation.execTarget === 'none')) ||
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
      toast.success('Настройки сохранены')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  // Фактический режим хода: сервер форсит «план», когда роль user работает без своей машины (turns.ts).
  const forcedPlan = role === 'user' && (!execTarget || execTarget === 'none')
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
        onTabChange={setActiveTab}
        tabs={[{ id: 'general', label: 'Общее' }, { id: 'llm', label: 'LLM' }]}
      />
      <main className={`convsettings-body convsettings-tab-${activeTab}`}>
        <section className="convsettings-card">
          <label className="convsettings-field"><span>Название разговора</span><input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
          <label className="convsettings-field"><span>Проект</span>
            <select aria-label="Проект разговора" value={projectId ?? ''} onChange={(e) => void onChangeProject(e.target.value || null)}>
              <option value="">Без проекта</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="convsettings-field"><span>Машина</span>
            <select value={execTarget ?? ''} onChange={(e) => {
              const v = e.target.value || null
              setExecTarget(v)
              const pm = projectMachines.find((m) => m.agentId === v)
              setWorkdir(projectId ? (pm && pm.path ? pm.path : null) : null)
              setCwd(''); setEntries([])
            }}>
              {!projectId && <option value="">Сервер</option>}
              {(projectId ? agents.filter((a) => projectMachines.some((m) => m.agentId === a.id)) : agents).map((agent) => <option key={agent.id} value={agent.id}>{agent.name}{agent.id === (projectId ? projectDefaultAgentId : defaultAgentId) ? ' — по умолчанию' : ''}{agent.online ? '' : ' (офлайн)'}</option>)}
            </select>
          </label>
          {projectId && <p className="convsettings-muted">Машины и папка берутся из проекта; смена проекта перезапишет их.</p>}
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
          <div className="convsettings-sectionhead"><div><h2>База знаний проекта</h2><p>Как модель получает сведения об устройстве voiceAIChat. Политика проекта — искать в базе знаний до чтения кода.</p></div></div>
          <label className="convsettings-field"><span>Контекст KB</span>
            <select aria-label="Контекст базы знаний" value={kbContextMode} onChange={(e) => setKbContextMode(e.target.value as KbContextMode)}>
              <option value="auto">Авто-контекст + инструменты модели</option>
              <option value="manual">По запросу модели (только инструменты)</option>
              <option value="off">Не использовать</option>
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
          <section className="convsettings-card">
            <div className="convsettings-sectionhead"><div><h2>Корневая директория</h2><p>Команды этого разговора будут начинаться в выбранной папке.</p></div><Button onClick={() => void loadDir(workdir ?? '')} loading={loadingDir} disabled={!selectedAgent.online}>Выбрать</Button></div>
            <div className="convsettings-path">{workdir || 'Корень машины'}</div>
            {(cwd || entries.length > 0 || loadingDir) && <div className="convsettings-picker">
              <div className="convsettings-pickerbar"><IconButton onClick={() => void loadDir(parentOf(cwd))} title="На уровень выше" aria-label="На уровень выше">↑</IconButton><span>{cwd}</span><Button onClick={() => { setWorkdir(cwd); setEntries([]) }}>Выбрать эту папку</Button></div>
              {loadingDir ? <p>Загрузка…</p> : entries.filter((entry) => entry.kind === 'dir').map((entry) => <button className="convsettings-dir" key={entry.name} onClick={() => void loadDir(joinPath(cwd, entry.name))}>📁 {entry.name}</button>)}
            </div>}
          </section>

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
