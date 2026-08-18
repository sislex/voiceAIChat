// Раздел «Настройки» страницы проекта (шапку и переключатель разделов рисует
// ProjectPage, здесь — только содержимое).
import { CiProjectDefaults } from './ci/CiProjectDefaults'
// Описание, git, технологии/навыки, workflow фич, участники, машины, удаление.
// Управляющие контролы (правка, участники, машины, удаление) — только владельцу.

import { useEffect, useState } from 'react'
import type { ProjectDetail, ProjectSummary, WorkItemDefaultSkills } from '@shared/projects'
import type { KbContextMode } from '@shared/types'
import type { UserLlmAccess } from '@shared/llmAccess'
import type { LlmEngineOption } from '@shared/admin'

import type { AgentInfo } from '@shared/agentProtocol'
import { Button } from '@voicechat/ui-kit'
import { IconButton } from '@voicechat/ui-kit'
import { SettingsPage } from './SettingsPage'
import { ProjectMachinesSettings } from './ProjectMachinesSettings'

export interface ProjectSettingsProps {
  detail: ProjectDetail
  agents: AgentInfo[]
  currentUsername?: string
  llmAccess?: UserLlmAccess[]
  llmEngines?: LlmEngineOption[]
  onUpdate: (id: string, fields: { name?: string; description?: string; gitUrl?: string | null; previewUrl?: string | null; technologies?: string[]; skills?: string[]; defaultSkills?: Partial<WorkItemDefaultSkills>; commitPolicy?: ProjectSummary['commitPolicy']; mergeTransport?: ProjectSummary['mergeTransport']; agentPlanApprovalMode?: ProjectSummary['agentPlanApprovalMode']; testCommand?: string; productionDeployCommand?: string; productionAgentId?: string | null; productionCheckoutPath?: string; productionHealthCheckCommand?: string; ciBaseBranch?: string; ciBranchTemplate?: string; ciReuseStrategy?: 'reuse' | 'clean' | 'fail'; ciExecAuthRef?: string; ciKbContextMode?: KbContextMode; doneRetentionDays?: number | null }) => void

  onDelete: (id: string) => void
  onAddMember: (id: string, username: string) => void
  onUpdateMemberRole: (id: string, username: string, role: 'owner' | 'member') => void
  onRemoveMember: (id: string, username: string) => void
  onLinkMachine: (id: string, agentId: string) => void | Promise<void>
  onUnlinkMachine: (id: string, agentId: string) => void | Promise<void>
  onSetMachinePath: (id: string, agentId: string, path: string) => void | Promise<void>
  onSetReposRoot: (id: string, agentId: string, reposRoot: string) => void | Promise<void>
  onSetMachineSsh: (id: string, agentId: string, sshHost: string, sshUser: string) => void | Promise<void>
  onSetDefaultMachine: (id: string, agentId: string) => void | Promise<void>
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

/** Настройки проекта (ремоунтятся по ключу detail.id — сбрасывают черновики). */
export function ProjectSettings(props: ProjectSettingsProps): JSX.Element {
  const { detail, agents } = props
  const isOwner = detail.role === 'owner'
  const ownerCount = detail.members.filter((member) => member.role === 'owner').length
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
        <label>Production-машина<select className="sel" disabled={!isOwner} value={detail.productionAgentId ?? ''} onChange={(e) => props.onUpdate(detail.id, { productionAgentId: e.target.value || null })}><option value="">Не настроена</option>{detail.machines.map(machine=><option key={machine.agentId} value={machine.agentId}>{machine.name ?? machine.agentId}{machine.online===false?' · offline':''}</option>)}</select></label>
        <label>Production checkout<input className="login-input" disabled={!isOwner} value={detail.productionCheckoutPath ?? ''} onChange={(e) => props.onUpdate(detail.id, { productionCheckoutPath: e.target.value })} placeholder="/root/voiceAIChat" /></label>
        <label>Штатная команда production-деплоя<input className="login-input" disabled={!isOwner} value={detail.productionDeployCommand ?? ''} onChange={(e) => props.onUpdate(detail.id, { productionDeployCommand: e.target.value })} placeholder="voicechat-deploy" /></label>
        <label>Команда health-check<input className="login-input" disabled={!isOwner} value={detail.productionHealthCheckCommand ?? ''} onChange={(e) => props.onUpdate(detail.id, { productionHealthCheckCommand: e.target.value })} placeholder="curl -fsS http://127.0.0.1:8787/api/health" /></label>
        <label>CI: базовая ветка<input className="login-input" disabled={!isOwner} value={detail.ciBaseBranch ?? ''} onChange={(e) => props.onUpdate(detail.id, { ciBaseBranch: e.target.value })} placeholder="main" /></label>
        <label>CI: шаблон ветки<input className="login-input" disabled={!isOwner} value={detail.ciBranchTemplate ?? ''} onChange={(e) => props.onUpdate(detail.id, { ciBranchTemplate: e.target.value })} placeholder="{task_number}" /></label>
        <label>CI: повтор директории<select className="sel" disabled={!isOwner} value={detail.ciReuseStrategy ?? 'fail'} onChange={(e) => props.onUpdate(detail.id, { ciReuseStrategy: e.target.value as 'reuse' | 'clean' | 'fail' })}><option value="fail">Упасть, если существует</option><option value="reuse">Переиспользовать</option><option value="clean">Очистить и заново</option></select></label>
        <div className="ci-defaults-wrap"><div className="convsettings-caption">Команды воркфлоу по умолчанию</div><CiProjectDefaults projectId={detail.id} editable={isOwner} section="commands" /></div>
      </div>}

      {activeTab === 'members' && <div className="proj-section">
        <p className="proj-field-label">Участники</p>
        <ul className="proj-members">
          {detail.members.map((m) => {
            const lastOwner = m.role === 'owner' && ownerCount === 1
            const current = m.username === props.currentUsername
            return (
              <li key={m.username}>
                <span>
                  {m.username}{current && <span className="proj-muted"> · вы</span>}
                  {m.username === detail.createdBy && <span className="proj-muted"> · создатель</span>}
                  {m.addedAt > 0 && (
                    <time className="proj-muted" dateTime={new Date(m.addedAt).toISOString()}>
                      {' · с ' + new Date(m.addedAt).toLocaleDateString()}
                    </time>
                  )}
                </span>
                <span>
                  {isOwner ? (
                    <select
                      className="sel"
                      aria-label={`Роль ${m.username}`}
                      value={m.role}
                      disabled={lastOwner}
                      title={lastOwner ? 'Сначала назначьте другого владельца' : undefined}
                      onChange={(event) => {
                        const role = event.target.value as 'owner' | 'member'
                        if (role === 'owner' && !window.confirm(
                          'Назначить владельцем? Пользователь получит полный доступ к настройкам, участникам, машинам, CI и релизам.'
                        )) return
                        props.onUpdateMemberRole(detail.id, m.username, role)
                      }}
                    >
                      <option value="owner">Владелец</option>
                      <option value="member">Участник</option>
                    </select>
                  ) : (
                    <span className="proj-muted">{m.role === 'owner' ? 'Владелец' : 'Участник'}</span>
                  )}
                  {isOwner && (
                    <IconButton
                      size="sm"
                      className="vc-btn--danger-quiet"
                      aria-label={`Убрать ${m.username}`}
                      title={lastOwner ? 'Сначала назначьте другого владельца' : 'Убрать участника'}
                      disabled={lastOwner}
                      onClick={() => {
                        if (m.role === 'owner' && !window.confirm(`Удалить владельца ${m.username} из проекта?`)) return
                        props.onRemoveMember(detail.id, m.username)
                      }}
                    >
                      ✕
                    </IconButton>
                  )}
                </span>
              </li>
            )
          })}
        </ul>
        {isOwner && ownerCount === 1 && (
          <p className="proj-muted">Последнего владельца нельзя понизить, удалить или вывести из проекта. Сначала назначьте другого владельца.</p>
        )}
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

      {activeTab === 'machines' && <ProjectMachinesSettings
        projectId={detail.id}
        machines={detail.machines}
        agents={agents}
        onShare={(id, agentId, shared) => shared ? props.onLinkMachine(id, agentId) : props.onUnlinkMachine(id, agentId)}
        onSave={(id, agentId, field, value, machine) => {
          if (field === 'path') return props.onSetMachinePath(id, agentId, value)
          if (field === 'reposRoot') return props.onSetReposRoot(id, agentId, value)
          return props.onSetMachineSsh(id, agentId, field === 'sshHost' ? value : machine.sshHost ?? '', field === 'sshUser' ? value : machine.sshUser ?? '')
        }}
        onSetDefault={props.onSetDefaultMachine}
      />}

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
