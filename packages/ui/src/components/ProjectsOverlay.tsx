// Список проектов (хаб): выбор проекта открывает его страницу (доску), плюс
// форма создания нового проекта. Настройки самого проекта — на его странице
// (см. ProjectSettings), а не здесь.

import { useState } from 'react'
import type { ProjectSummary } from '@shared/projects'
import { ToolFrame } from './ToolFrame'

export interface ProjectsOverlayProps {
  projects: ProjectSummary[]
  onOpenProject: (id: string) => void
  onCreate: (input: { name: string }) => void
  onClose: () => void
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
    <ToolFrame title="Проекты" onClose={props.onClose} testId="projects-overlay" variant="page">
      <div className="ccobs-body">
        <nav className="cc-col cc-projects cc-projects--full" aria-label="Список проектов">
          {props.projects.map((p) => (
            <button
              key={p.id}
              className="cc-item"
              onClick={() => props.onOpenProject(p.id)}
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
      </div>
    </ToolFrame>
  )
}
