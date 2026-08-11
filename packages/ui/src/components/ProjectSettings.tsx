// Раздел «Настройки» страницы проекта (шапку и переключатель разделов рисует
// ProjectPage, здесь — только содержимое).
import { CiProjectDefaults } from './ci/CiProjectDefaults'
// Описание, git, технологии/навыки, workflow фич, участники, машины, удаление.
// Управляющие контролы (правка, участники, машины, удаление) — только владельцу.

import { useEffect, useState } from 'react'
import type { ProjectDetail, ProjectMachine, ProjectSummary, WorkItemDefaultSkills } from '@shared/projects'
import type { KbContextMode } from '@shared/types'
import type { UserLlmAccess } from '@shared/llmAccess'
import type { LlmEngineOption } from '@shared/admin'

import type { AgentInfo } from '@shared/agentProtocol'
import { Button } from './ui/Button'
import { IconButton } from './ui/IconButton'
import { SettingsPage } from './SettingsPage'

export interface ProjectSettingsProps {
  detail: ProjectDetail
  agents: AgentInfo[]
  llmAccess?: UserLlmAccess[]
  llmEngines?: LlmEngineOption[]
  onUpdate: (id: string, fields: { name?: string; description?: string; gitUrl?: string | null; previewUrl?: string | null; technologies?: string[]; skills?: string[]; defaultSkills?: Partial<WorkItemDefaultSkills>; commitPolicy?: ProjectSummary['commitPolicy']; mergeTransport?: ProjectSummary['mergeTransport']; agentPlanApprovalMode?: ProjectSummary['agentPlanApprovalMode']; testCommand?: string; productionDeployCommand?: string; ciBaseBranch?: string; ciBranchTemplate?: string; ciReuseStrategy?: 'reuse' | 'clean' | 'fail'; ciExecAuthRef?: string; ciKbContextMode?: KbContextMode; doneRetentionDays?: number | null }) => void

  onDelete: (id: string) => void
  onAddMember: (id: string, username: string) => void
  onRemoveMember: (id: string, username: string) => void
  onLinkMachine: (id: string, agentId: string) => void
  onUnlinkMachine: (id: string, agentId: string) => void
  onSetMachinePath: (id: string, agentId: string, path: string) => void
  onSetReposRoot: (id: string, agentId: string, reposRoot: string) => void
  onSetDefaultMachine: (id: string, agentId: string) => void
}

/** Редактор списка тегов (технологии/навыки). */
function TagEditor({ label, tags, editable, onChange }: {
  label: string
  tags: string[]
  editable: boolean
  onChange: (next: string[]) => void
}): JSX.Element {
  const [draft, setDraft] = useState('')
  const add = (): void => {
    const t = draft.trim()
    if (t && !tags.includes(t)) onChange([...tags, t])
    setDraft('')
  }
  return (
    <div className="proj-tags">
      <p className="proj-field-label">{label}</p>
      <div className="proj-chips">
        {tags.map((t) => (
          <span key={t} className="proj-chip">
            {t}
            {editable && (
              <button className="proj-chip-x" aria-label={`Убрать ${t}`} title="Убрать" onClick={() => onChange(tags.filter((x) => x !== t))}>
                ✕
              </button>
            )}
          </span>
        ))}
        {tags.length === 0 && <span className="proj-muted">—</span>}
      </div>
      {editable && (
        <input
          className="login-input"
          placeholder={`+ ${label.toLowerCase()}`}
          aria-label={`Добавить: ${label}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add()
          }}
        />
      )}
    </div>
  )
}

/** Строка машины проекта: привязка, папка проекта на ней и отметка «по умолчанию». */
function MachineRow({ agent, machine, isDefault, onToggle, onSetPath, onSetReposRoot, onSetDefault }: {
  agent: AgentInfo
  machine: ProjectMachine | undefined
  isDefault: boolean
  onToggle: () => void
  onSetPath: (path: string) => void
  onSetReposRoot: (path: string) => void
  onSetDefault: () => void
}): JSX.Element {
  const [path, setPath] = useState(machine?.path ?? '')
  const [reposRoot, setReposRoot] = useState(machine?.reposRoot ?? '')
  useEffect(() => {
    setPath(machine?.path ?? '')
  }, [machine?.path])
  useEffect(() => {
    setReposRoot(machine?.reposRoot ?? '')
  }, [machine?.reposRoot])
  const linked = machine !== undefined
  const commit = (): void => {
    if (path !== (machine?.path ?? '')) onSetPath(path)
  }
  const commitReposRoot = (): void => {
    if (reposRoot !== (machine?.reposRoot ?? '')) onSetReposRoot(reposRoot)
  }
  return (
    <li className="proj-machine-row">
      <label>
        <input type="checkbox" checked={linked} onChange={onToggle} />
        {agent.name} {agent.online ? <span className="proj-online">● online</span> : <span className="proj-muted">offline</span>}
      </label>
      {linked && (
        <div className="proj-machine-cfg">
          <input
            className="login-input"
            placeholder="Папка проекта на этой машине"
            aria-label={`Папка проекта на ${agent.name}`}
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
            }}
          />
          <input
            className="login-input"
            placeholder="Корень VoiceAIChatRepos для Feature Run"
            aria-label={`Корень Feature-репозиториев на ${agent.name}`}
            value={reposRoot}
            onChange={(e) => setReposRoot(e.target.value)}
            onBlur={commitReposRoot}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitReposRoot()
            }}
          />
          <label className="proj-default-toggle" title="Машина по умолчанию для проекта">
            <input type="radio" checked={isDefault} onChange={onSetDefault} /> по умолчанию
          </label>
        </div>
      )}
    </li>
  )
}

/** Настройки проекта (ремоунтятся по ключу detail.id — сбрасывают черновики). */
export function ProjectSettings(props: ProjectSettingsProps): JSX.Element {
  const { detail, agents } = props
  const isOwner = detail.role === 'owner'
  const [name, setName] = useState(detail.name)
  const [description, setDescription] = useState(detail.description)
  const [gitUrl, setGitUrl] = useState(detail.gitUrl ?? '')
  const [previewUrl, setPreviewUrl] = useState(detail.previewUrl ?? '')
  useEffect(() => setPreviewUrl(detail.previewUrl ?? ''), [detail.previewUrl])
  const [newMember, setNewMember] = useState('')
  const [confirmDel, setConfirmDel] = useState(false)
  const [activeTab, setActiveTab] = useState<'general' | 'llm' | 'board' | 'workflow' | 'members' | 'machines'>('general')
  // Порог скрытия завершённых: черновик строкой — пустое поле это «не скрывать»
  // (null), а не 0. Синхронизируем с ответом сервера.
  const retentionOf = (v: number | null | undefined): string => (v == null ? '' : String(v))
  const [doneRetention, setDoneRetention] = useState(retentionOf(detail.doneRetentionDays))
  useEffect(() => {
    setDoneRetention(retentionOf(detail.doneRetentionDays))
  }, [detail.doneRetentionDays])
  const commitRetention = (): void => {
    const raw = doneRetention.trim()
    const parsed = raw === '' ? null : Number(raw)
    if (parsed != null && (!Number.isFinite(parsed) || parsed < 0)) {
      setDoneRetention(retentionOf(detail.doneRetentionDays))
      return
    }
    const next = parsed == null ? null : Math.floor(parsed)
    if (next !== (detail.doneRetentionDays ?? null)) props.onUpdate(detail.id, { doneRetentionDays: next })
  }

  const saveMeta = (): void => {
    props.onUpdate(detail.id, { name: name.trim() || detail.name, description, gitUrl: gitUrl.trim() || null })
  }
  const savePreviewUrl = (): void => {
    const raw = previewUrl.trim()
    if (!raw) { props.onUpdate(detail.id, { previewUrl: null }); return }
    try {
      const url = new URL(raw)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('protocol')
      setPreviewUrl(url.toString())
      props.onUpdate(detail.id, { previewUrl: url.toString() })
    } catch { setPreviewUrl(detail.previewUrl ?? '') }
  }

  return (
    <div className="proj-detail" data-testid="project-settings">
      <SettingsPage
        ariaLabel="Разделы настроек проекта"
        activeTab={activeTab}
        onTabChange={setActiveTab}
        tabs={[
          { id: 'general', label: 'Общее' },
          { id: 'llm', label: 'LLM' },
          { id: 'board', label: 'Доска' },
          { id: 'workflow', label: 'Workflow и CI' },
          { id: 'members', label: 'Участники' },
          { id: 'machines', label: 'Машины' }
        ]}
      />
      {activeTab === 'general' && <>
      {isOwner ? (
        <div className="proj-meta-edit">
          <input className="login-input" aria-label="Название проекта" value={name} onChange={(e) => setName(e.target.value)} onBlur={saveMeta} />
          <textarea className="login-input" aria-label="Описание" placeholder="Описание" value={description} onChange={(e) => setDescription(e.target.value)} onBlur={saveMeta} />
          <input className="login-input" aria-label="Git-репозиторий" placeholder="git@…" value={gitUrl} onChange={(e) => setGitUrl(e.target.value)} onBlur={saveMeta} />
          <input className="login-input" type="url" aria-label="URL веб-превью" placeholder="https://example.com" value={previewUrl} onChange={(e) => setPreviewUrl(e.target.value)} onBlur={savePreviewUrl} onKeyDown={(e) => { if (e.key === 'Enter') savePreviewUrl() }} />
        </div>
      ) : (
        <div className="proj-meta-ro">
          <p>{detail.description || <span className="proj-muted">Без описания</span>}</p>
          {detail.gitUrl && <p className="proj-git">{detail.gitUrl}</p>}
        </div>
      )}

      <TagEditor label="Технологии" tags={detail.technologies} editable={isOwner} onChange={(next) => props.onUpdate(detail.id, { technologies: next })} />
      <TagEditor label="Навыки" tags={detail.skills} editable={isOwner} onChange={(next) => props.onUpdate(detail.id, { skills: next })} />
      </>}

      {activeTab === 'board' && <>
      <div className="proj-section proj-default-skills">
        <p className="proj-field-label">Навыки по умолчанию</p>
        <p className="proj-hint">Автоматически добавляются в карточку при создании элемента соответствующего типа. В самой карточке их можно убрать или дополнить.</p>
        <TagEditor label="Эпики" tags={detail.defaultSkills.epic} editable={isOwner} onChange={(next) => props.onUpdate(detail.id, { defaultSkills: { epic: next } })} />
        <TagEditor label="Стори" tags={detail.defaultSkills.story} editable={isOwner} onChange={(next) => props.onUpdate(detail.id, { defaultSkills: { story: next } })} />
        <TagEditor label="Таски" tags={detail.defaultSkills.task} editable={isOwner} onChange={(next) => props.onUpdate(detail.id, { defaultSkills: { task: next } })} />
      </div>

      <div className="proj-section">
        <p className="proj-field-label">Доска</p>
        <p className="proj-hint">
          Завершённая задача пропадает с доски через указанное число дней после попадания в «Готово» — как в Jira. Из
          системы она не удаляется: открывается по прямой ссылке и переключателем «Показать завершённые» в шапке доски.
          Пусто — не скрывать никогда, 0 — убрать в конце того же дня (в «Готово» карточку переносит и CI-ран после
          успешного мержа, поэтому мгновенно она не исчезает).
        </p>
        <label>
          Скрывать завершённые через, дней
          <input
            className="login-input"
            type="number"
            min={0}
            step={1}
            disabled={!isOwner}
            aria-label="Скрывать завершённые через, дней"
            placeholder="не скрывать"
            value={doneRetention}
            onChange={(e) => setDoneRetention(e.target.value)}
            onBlur={commitRetention}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRetention()
            }}
          />
        </label>
      </div>
      </>}

      {activeTab === 'llm' && (
        <div className="proj-section">
          <p className="proj-field-label">LLM по умолчанию</p>
          <p className="proj-hint" data-testid="project-llm-hint">
            Пара применяется к чатам проекта сразу, а задачи получают её через наследование.
          </p>
          <CiProjectDefaults projectId={detail.id} editable={isOwner} llmAccess={props.llmAccess} llmEngines={props.llmEngines} section="llm" />
          <label>CI: база знаний в ране<select
            className="sel"
            aria-label="CI: база знаний в ране"
            disabled={!isOwner}
            value={detail.ciKbContextMode ?? 'auto'}
            onChange={(e) => props.onUpdate(detail.id, { ciKbContextMode: e.target.value as KbContextMode })}
          >
            <option value="auto">Контекст и инструменты (авто)</option>
            <option value="manual">Только инструменты (по запросу модели)</option>
            <option value="off">Выключена</option>
          </select></label>
          <p className="proj-muted" data-testid="proj-ci-kb-hint">
            Режим влияет на работу модели в CI-ране: в «авто» сервер подмешивает разделы базы знаний
            по теме задачи и выдаёт модели инструменты mcp__kb__*, в «по запросу» — только инструменты.
            На чаты проекта настройка не влияет — у каждого чата свой режим. Значение применяется
            к следующему рану.
          </p>
        </div>
      )}

      {activeTab === 'workflow' && <div className="proj-section feature-policy">
        <p className="proj-field-label">Workflow фич</p>
        <label>Коммиты<select className="sel" disabled={!isOwner} value={detail.commitPolicy} onChange={(e) => props.onUpdate(detail.id, { commitPolicy: e.target.value as ProjectSummary['commitPolicy'] })}><option value="agent_commits">Агент создаёт коммиты</option><option value="final_system_commit">Итоговый системный коммит</option><option value="manual_user_confirmation">Подтверждать коммит</option></select></label>
        <label>Merge<select className="sel" disabled={!isOwner} value={detail.mergeTransport} onChange={(e) => props.onUpdate(detail.id, { mergeTransport: e.target.value as ProjectSummary['mergeTransport'] })}><option value="local">Локальный merge commit</option><option value="github_pull_request">GitHub Pull Request</option></select></label>
        <label>План агента<select className="sel" disabled={!isOwner} value={detail.agentPlanApprovalMode} onChange={(e) => props.onUpdate(detail.id, { agentPlanApprovalMode: e.target.value as ProjectSummary['agentPlanApprovalMode'] })}><option value="manual">Подтверждать</option><option value="automatic">Запускать автоматически</option></select></label>
        <label>Команда тестирования<input className="login-input" disabled={!isOwner} value={detail.testCommand ?? ''} onChange={(e) => props.onUpdate(detail.id, { testCommand: e.target.value })} placeholder="npm test" /></label>
        <label>Команда production-деплоя<input className="login-input" disabled={!isOwner} value={detail.productionDeployCommand ?? ''} onChange={(e) => props.onUpdate(detail.id, { productionDeployCommand: e.target.value })} placeholder="docker compose up --build -d" /></label>
        <label>CI: базовая ветка<input className="login-input" disabled={!isOwner} value={detail.ciBaseBranch ?? ''} onChange={(e) => props.onUpdate(detail.id, { ciBaseBranch: e.target.value })} placeholder="main" /></label>
        <label>CI: шаблон ветки<input className="login-input" disabled={!isOwner} value={detail.ciBranchTemplate ?? ''} onChange={(e) => props.onUpdate(detail.id, { ciBranchTemplate: e.target.value })} placeholder="{task_number}" /></label>
        <label>CI: повтор директории<select className="sel" disabled={!isOwner} value={detail.ciReuseStrategy ?? 'fail'} onChange={(e) => props.onUpdate(detail.id, { ciReuseStrategy: e.target.value as 'reuse' | 'clean' | 'fail' })}><option value="fail">Упасть, если существует</option><option value="reuse">Переиспользовать</option><option value="clean">Очистить и заново</option></select></label>
        <div className="ci-defaults-wrap"><div className="convsettings-caption">Команды воркфлоу по умолчанию</div><CiProjectDefaults projectId={detail.id} editable={isOwner} section="commands" /></div>
      </div>}

      {activeTab === 'members' && <div className="proj-section">
        <p className="proj-field-label">Участники</p>
        <ul className="proj-members">
          {detail.members.map((m) => (
            <li key={m.username}>
              <span>
                {m.username} <span className="proj-muted">{m.role}</span>
              </span>
              {isOwner && m.role !== 'owner' && (
                <IconButton size="sm" className="vc-btn--danger-quiet" aria-label={`Убрать ${m.username}`} title="Убрать участника" onClick={() => props.onRemoveMember(detail.id, m.username)}>
                  ✕
                </IconButton>
              )}
            </li>
          ))}
        </ul>
        {isOwner && (
          <div className="proj-add-member">
            <input
              className="login-input"
              placeholder="Логин участника"
              aria-label="Добавить участника"
              value={newMember}
              onChange={(e) => setNewMember(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newMember.trim()) {
                  props.onAddMember(detail.id, newMember.trim())
                  setNewMember('')
                }
              }}
            />
          </div>
        )}
      </div>}

      {activeTab === 'machines' && <div className="proj-section">
        <p className="proj-field-label">Машины разработки (папка проекта на каждой)</p>
        {isOwner ? (
          <ul className="proj-machines">
            {agents.map((a) => (
              <MachineRow
                key={a.id}
                agent={a}
                machine={detail.machines.find((m) => m.agentId === a.id)}
                isDefault={detail.defaultAgentId === a.id}
                onToggle={() =>
                  detail.machines.some((m) => m.agentId === a.id)
                    ? props.onUnlinkMachine(detail.id, a.id)
                    : props.onLinkMachine(detail.id, a.id)
                }
                onSetPath={(path) => props.onSetMachinePath(detail.id, a.id, path)}
                onSetReposRoot={(root) => props.onSetReposRoot(detail.id, a.id, root)}
                onSetDefault={() => props.onSetDefaultMachine(detail.id, a.id)}
              />
            ))}
            {agents.length === 0 && <span className="proj-muted">Нет машин — добавьте в меню «Машины».</span>}
          </ul>
        ) : (
          <ul className="proj-machines">
            {detail.machines.map((m) => (
              <li key={m.agentId}>
                {m.name ?? agents.find((a) => a.id === m.agentId)?.name ?? m.agentId}
                <span className={m.online ? 'proj-online' : 'proj-offline'}> · {m.online ? 'в сети' : 'офлайн'}</span>
                {m.owner && <span className="proj-muted"> · владелец: {m.owner}</span>}
                {m.path && <span className="proj-muted"> · {m.path}</span>}
                {detail.defaultAgentId === m.agentId && <span className="proj-online"> · по умолчанию</span>}
              </li>
            ))}
            {detail.machines.length === 0 && <span className="proj-muted">—</span>}
          </ul>
        )}
      </div>}

      {activeTab === 'general' && isOwner && (
        <div className="proj-danger">
          {confirmDel ? (
            <span className="delconfirm">
              <span>Удалить проект?</span>
              <Button variant="danger" size="sm" onClick={() => props.onDelete(detail.id)}>
                Удалить
              </Button>
              <Button size="sm" onClick={() => setConfirmDel(false)}>
                Отмена
              </Button>
            </span>
          ) : (
            <Button variant="danger" size="sm" className="proj-delete" onClick={() => setConfirmDel(true)}>
              Удалить проект
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
