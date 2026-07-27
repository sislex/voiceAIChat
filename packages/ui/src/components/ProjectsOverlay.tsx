// Режим «Проекты»: слева список + форма создания, справа — детали выбранного
// проекта (описание, git, технологии/навыки, участники, машины) и переход к доске.
// Управляющие контролы (правка, участники, машины, удаление) — только владельцу.

import { useState } from 'react'
import type { ProjectDetail, ProjectSummary } from '@shared/projects'
import type { AgentInfo } from '@shared/agentProtocol'
import { ToolFrame } from './ToolFrame'

export interface ProjectsOverlayProps {
  projects: ProjectSummary[]
  detail: ProjectDetail | null
  agents: AgentInfo[]
  onSelect: (id: string) => void
  onCreate: (input: { name: string; description?: string; gitUrl?: string; technologies?: string[]; skills?: string[] }) => void
  onUpdate: (id: string, fields: { name?: string; description?: string; gitUrl?: string | null; technologies?: string[]; skills?: string[] }) => void
  onDelete: (id: string) => void
  onAddMember: (id: string, username: string) => void
  onRemoveMember: (id: string, username: string) => void
  onLinkMachine: (id: string, agentId: string) => void
  onUnlinkMachine: (id: string, agentId: string) => void
  onOpenBoard: (id: string) => void
  onClose: () => void
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

/** Панель деталей проекта (ремоунтится по ключу detail.id — сбрасывает черновики). */
function DetailPane(props: ProjectsOverlayProps & { detail: ProjectDetail }): JSX.Element {
  const { detail, agents } = props
  const isOwner = detail.role === 'owner'
  const [name, setName] = useState(detail.name)
  const [description, setDescription] = useState(detail.description)
  const [gitUrl, setGitUrl] = useState(detail.gitUrl ?? '')
  const [newMember, setNewMember] = useState('')
  const [confirmDel, setConfirmDel] = useState(false)

  const saveMeta = (): void => {
    props.onUpdate(detail.id, { name: name.trim() || detail.name, description, gitUrl: gitUrl.trim() || null })
  }

  return (
    <div className="proj-detail" data-testid="project-detail">
      <div className="proj-detail-head">
        <h3 className="mdh">{detail.name}</h3>
        <button className="login-submit" onClick={() => props.onOpenBoard(detail.id)} data-testid="open-board">
          Открыть доску →
        </button>
      </div>

      {isOwner ? (
        <div className="proj-meta-edit">
          <input className="login-input" aria-label="Название проекта" value={name} onChange={(e) => setName(e.target.value)} onBlur={saveMeta} />
          <textarea className="login-input" aria-label="Описание" placeholder="Описание" value={description} onChange={(e) => setDescription(e.target.value)} onBlur={saveMeta} />
          <input className="login-input" aria-label="Git-репозиторий" placeholder="git@…" value={gitUrl} onChange={(e) => setGitUrl(e.target.value)} onBlur={saveMeta} />
        </div>
      ) : (
        <div className="proj-meta-ro">
          <p>{detail.description || <span className="proj-muted">Без описания</span>}</p>
          {detail.gitUrl && <p className="proj-git">{detail.gitUrl}</p>}
        </div>
      )}

      <TagEditor label="Технологии" tags={detail.technologies} editable={isOwner} onChange={(next) => props.onUpdate(detail.id, { technologies: next })} />
      <TagEditor label="Навыки" tags={detail.skills} editable={isOwner} onChange={(next) => props.onUpdate(detail.id, { skills: next })} />

      <div className="proj-section">
        <p className="proj-field-label">Участники</p>
        <ul className="proj-members">
          {detail.members.map((m) => (
            <li key={m.username}>
              <span>
                {m.username} <span className="proj-muted">{m.role}</span>
              </span>
              {isOwner && m.role !== 'owner' && (
                <button className="delbtn" aria-label={`Убрать ${m.username}`} title="Убрать участника" onClick={() => props.onRemoveMember(detail.id, m.username)}>
                  ✕
                </button>
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
      </div>

      <div className="proj-section">
        <p className="proj-field-label">Машины разработки</p>
        {isOwner ? (
          <ul className="proj-machines">
            {agents.map((a) => {
              const linked = detail.machineIds.includes(a.id)
              return (
                <li key={a.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={linked}
                      onChange={() => (linked ? props.onUnlinkMachine(detail.id, a.id) : props.onLinkMachine(detail.id, a.id))}
                    />
                    {a.name} {a.online ? <span className="proj-online">● online</span> : <span className="proj-muted">offline</span>}
                  </label>
                </li>
              )
            })}
            {agents.length === 0 && <span className="proj-muted">Нет машин — добавьте в меню «Машины».</span>}
          </ul>
        ) : (
          <ul className="proj-machines">
            {detail.machineIds.map((id) => (
              <li key={id}>{agents.find((a) => a.id === id)?.name ?? id}</li>
            ))}
            {detail.machineIds.length === 0 && <span className="proj-muted">—</span>}
          </ul>
        )}
      </div>

      {isOwner && (
        <div className="proj-danger">
          {confirmDel ? (
            <span className="delconfirm">
              <span>Удалить проект?</span>
              <button className="delyes" onClick={() => props.onDelete(detail.id)}>
                Удалить
              </button>
              <button className="delno" onClick={() => setConfirmDel(false)}>
                Отмена
              </button>
            </span>
          ) : (
            <button className="delbtn proj-delete" onClick={() => setConfirmDel(true)}>
              Удалить проект
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function ProjectsOverlay(props: ProjectsOverlayProps): JSX.Element {
  const [newName, setNewName] = useState('')

  const submitCreate = (): void => {
    const name = newName.trim()
    if (!name) return
    props.onCreate({ name })
    setNewName('')
  }

  return (
    <ToolFrame title="Проекты" onClose={props.onClose} testId="projects-overlay">
      <div className="ccobs-body">
        <nav className="cc-col cc-projects" aria-label="Список проектов">
          {props.projects.map((p) => (
            <button
              key={p.id}
              className={p.id === props.detail?.id ? 'cc-item on' : 'cc-item'}
              onClick={() => props.onSelect(p.id)}
              data-testid="project-item"
            >
              <span className="cc-name">{p.name}</span>
              <span className="cc-sub">
                {p.role} · {p.technologies.length} тех.
              </span>
            </button>
          ))}
          {props.projects.length === 0 && <p className="convo-empty">Пока нет проектов</p>}
          <div className="ucreate">
            <p className="ucreate-h">Новый проект</p>
            <input
              className="login-input"
              placeholder="Название"
              aria-label="Название нового проекта"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitCreate()
              }}
            />
            <button className="login-submit" disabled={!newName.trim()} onClick={submitCreate}>
              Создать
            </button>
          </div>
        </nav>
        <div className="cc-col cc-main">
          {props.detail ? (
            <DetailPane key={props.detail.id} {...props} detail={props.detail} />
          ) : (
            <p className="kanban-empty">Выберите проект слева или создайте новый.</p>
          )}
        </div>
      </div>
    </ToolFrame>
  )
}
