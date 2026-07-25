import { useEffect, useState } from 'react'
import { clampModelForRole, CODEX_MODELS, modelsForRole, normalizeClaudeModel } from '@shared/types'
import type { Conversation, LlmProvider, Settings, UserRole } from '@shared/types'
import type { AgentInfo, AgentSkill, FsEntry } from '@shared/agentProtocol'
import type { MachineOps } from './machine'

export interface ConversationSettingsProps {
  conversation: Conversation
  agents: AgentInfo[]
  machineOps?: MachineOps
  /** Роль пользователя — прячет модели Claude, недоступные роли user. */
  role: UserRole
  /** Общие настройки — дефолты движка/модели, когда разговор их не переопределяет. */
  settings: Pick<Settings, 'llmProvider' | 'model' | 'codexModel'>
  onSave: (value: {
    title: string
    execTarget: string | null
    workdir: string | null
    skillNames: string[]
    llmProvider: LlmProvider | null
    llmModel: string | null
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

export function ConversationSettings({ conversation, agents, machineOps, role, settings, onSave, onAddSkill, onClose }: ConversationSettingsProps): JSX.Element {
  const [title, setTitle] = useState(conversation.title)
  const [execTarget, setExecTarget] = useState<string | null>(conversation.execTarget)
  const [workdir, setWorkdir] = useState<string | null>(conversation.workdir)
  const [skillNames, setSkillNames] = useState<string[]>(conversation.skillNames)
  const [llmProvider, setLlmProvider] = useState<LlmProvider | ''>(conversation.llmProvider ?? '')
  const [llmModel, setLlmModel] = useState<string>(
    conversation.llmProvider && conversation.llmModel !== null
      ? conversation.llmModel
      : conversation.llmProvider === 'codex'
        ? settings.codexModel
        : clampModelForRole(normalizeClaudeModel(settings.model), role)
  )
  const [cwd, setCwd] = useState('')
  const [entries, setEntries] = useState<FsEntry[]>([])
  const [loadingDir, setLoadingDir] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [skillName, setSkillName] = useState('')
  const [skillCommand, setSkillCommand] = useState('')
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
    setSaving(true)
    try {
      await onSave({
        title: cleanTitle,
        execTarget,
        workdir: execTarget ? workdir : null,
        skillNames: execTarget ? skillNames : [],
        llmProvider: llmProvider || null,
        llmModel: llmProvider ? llmModel : null
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="convsettings" role="dialog" aria-modal="true" aria-label="Настройки разговора">
      <header className="convsettings-head">
        <button className="convsettings-back" onClick={onClose} aria-label="Вернуться в разговор">←</button>
        <div><h1>Настройки разговора</h1><p>Параметры применяются только к этому разговору</p></div>
      </header>
      <main className="convsettings-body">
        <section className="convsettings-card">
          <label className="convsettings-field"><span>Название разговора</span><input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
          <label className="convsettings-field"><span>Машина</span>
            <select value={execTarget ?? ''} onChange={(e) => { setExecTarget(e.target.value || null); setWorkdir(null); setCwd(''); setEntries([]) }}>
              <option value="">Сервер</option>
              {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}{agent.online ? '' : ' (офлайн)'}</option>)}
            </select>
          </label>
        </section>

        <section className="convsettings-card">
          <div className="convsettings-sectionhead"><div><h2>Движок и модель</h2><p>Отвечает только в этом разговоре; «По умолчанию» — из общих настроек.</p></div></div>
          <label className="convsettings-field"><span>Движок</span>
            <select
              aria-label="Движок разговора"
              value={llmProvider}
              onChange={(e) => {
                const next = (e.target.value || '') as LlmProvider | ''
                setLlmProvider(next)
                setLlmModel(next === 'codex' ? settings.codexModel : clampModelForRole(normalizeClaudeModel(settings.model), role))
              }}
            >
              <option value="">По умолчанию ({settings.llmProvider === 'codex' ? 'Codex' : 'Claude Code'})</option>
              <option value="claude">Claude Code</option>
              <option value="codex">Codex</option>
            </select>
          </label>
          {llmProvider === 'claude' && <label className="convsettings-field"><span>Модель Claude</span>
            <select aria-label="Модель разговора" value={normalizeClaudeModel(llmModel)} onChange={(e) => setLlmModel(e.target.value)}>
              {modelsForRole(role).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>}
          {llmProvider === 'codex' && <label className="convsettings-field"><span>Модель Codex</span>
            <select aria-label="Модель разговора" value={llmModel} onChange={(e) => setLlmModel(e.target.value)}>
              {llmModel && !CODEX_MODELS.some((m) => m.id === llmModel) && <option value={llmModel}>{llmModel}</option>}
              {CODEX_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>}
        </section>

        {selectedAgent && <>
          <section className="convsettings-card">
            <div className="convsettings-sectionhead"><div><h2>Корневая директория</h2><p>Команды этого разговора будут начинаться в выбранной папке.</p></div><button onClick={() => void loadDir(workdir ?? '')} disabled={!selectedAgent.online || loadingDir}>Выбрать</button></div>
            <div className="convsettings-path">{workdir || 'Корень машины'}</div>
            {(cwd || entries.length > 0 || loadingDir) && <div className="convsettings-picker">
              <div className="convsettings-pickerbar"><button onClick={() => void loadDir(parentOf(cwd))}>↑</button><span>{cwd}</span><button onClick={() => { setWorkdir(cwd); setEntries([]) }}>Выбрать эту папку</button></div>
              {loadingDir ? <p>Загрузка…</p> : entries.filter((entry) => entry.kind === 'dir').map((entry) => <button className="convsettings-dir" key={entry.name} onClick={() => void loadDir(joinPath(cwd, entry.name))}>📁 {entry.name}</button>)}
            </div>}
          </section>

          <section className="convsettings-card">
            <div className="convsettings-sectionhead"><div><h2>Навыки</h2><p>Отметьте навыки, доступные модели в этом разговоре.</p></div></div>
            <div className="convsettings-skills">
              {skills.length === 0 && <p className="convsettings-muted">У машины пока нет навыков.</p>}
              {skills.map((skill) => <label className="convsettings-skill" key={skill.name}><input type="checkbox" checked={skillNames.includes(skill.name)} onChange={(e) => setSkillNames((current) => e.target.checked ? [...current, skill.name] : current.filter((name) => name !== skill.name))} /><span><b>{skill.name}</b>{skill.description && <small>{skill.description}</small>}<code>{skill.command}</code></span></label>)}
            </div>
            <div className="convsettings-add"><h3>Добавить навык</h3><input placeholder="Название" value={skillName} onChange={(e) => setSkillName(e.target.value)} /><input placeholder="Команда" value={skillCommand} onChange={(e) => setSkillCommand(e.target.value)} /><input placeholder="Описание (необязательно)" value={skillDescription} onChange={(e) => setSkillDescription(e.target.value)} /><button disabled={!skillName.trim() || !skillCommand.trim()} onClick={() => void addSkill()}>Добавить</button></div>
          </section>
        </>}
        {error && <p className="convsettings-error" role="alert">{error}</p>}
      </main>
      <footer className="convsettings-footer"><button onClick={onClose}>Отмена</button><button className="primary" disabled={saving} onClick={() => void save()}>{saving ? 'Сохранение…' : 'Сохранить'}</button></footer>
    </div>
  )
}
