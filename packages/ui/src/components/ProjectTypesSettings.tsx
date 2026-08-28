// Личные типы проекта в пользовательских настройках: дерево видимых узлов,
// создание своих подтипов и отправка на утверждение администратору.
//
// Почему отдельный экран: типы переживают проекты и не принадлежат ни одному из
// них — узел, созданный из проекта A, потом используется для проекта B. Держать
// их в настройках конкретного проекта значило бы прятать общий каталог внутри
// частного случая.
import { useMemo, useState } from 'react'
import { Button, EmptyState, IconButton } from '@voicechat/ui-kit'
import {
  PROJECT_FEATURES,
  PROJECT_FEATURE_LABELS,
  PROJECT_TYPE_STATUS_LABELS,
  compareProjectTypes,
  resolveProjectTypeFeatures,
  type ProjectTypeNode
} from '@shared/projectTypes'

export interface ProjectTypesSettingsProps {
  types: ProjectTypeNode[]
  /** Логин текущего пользователя: свои узлы можно править и публиковать. */
  currentUsername?: string
  onCreate?: (input: { name: string; parentId: string | null }) => void | Promise<void>
  onDelete?: (id: string) => void | Promise<void>
  onPublish?: (id: string) => void | Promise<void>
  onUnpublish?: (id: string) => void | Promise<void>
}

/** Плоское дерево: узел + глубина, порядок — обход от корней. */
export function flattenTypeTree(types: ProjectTypeNode[]): Array<{ node: ProjectTypeNode; depth: number }> {
  const byParent = new Map<string | null, ProjectTypeNode[]>()
  for (const node of types) {
    const list = byParent.get(node.parentId) ?? []
    list.push(node)
    byParent.set(node.parentId, list)
  }
  const out: Array<{ node: ProjectTypeNode; depth: number }> = []
  const walk = (parentId: string | null, depth: number): void => {
    const children = [...(byParent.get(parentId) ?? [])].sort(compareProjectTypes)
    for (const node of children) {
      out.push({ node, depth })
      walk(node.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

export function ProjectTypesSettings({ types, currentUsername, onCreate, onDelete, onPublish, onUnpublish }: ProjectTypesSettingsProps): JSX.Element {
  const [name, setName] = useState('')
  const [parentId, setParentId] = useState('')
  const rows = useMemo(() => flattenTypeTree(types), [types])
  const chainFeatures = (node: ProjectTypeNode): ReturnType<typeof resolveProjectTypeFeatures> => {
    const chain: ProjectTypeNode[] = []
    let current: ProjectTypeNode | undefined = node
    while (current) {
      chain.unshift(current)
      current = current.parentId ? types.find((t) => t.id === current!.parentId) : undefined
    }
    return resolveProjectTypeFeatures(chain)
  }

  const submit = (): void => {
    const trimmed = name.trim()
    if (!trimmed || !onCreate) return
    void onCreate({ name: trimmed, parentId: parentId || null })
    setName('')
  }

  return (
    <div className="settings-section" data-testid="project-types-settings">
      <p className="proj-hint">
        Тип задаёт, какие подсистемы доступны проекту. Свой подтип виден только вам, пока вы не
        отправите его на утверждение — после одобрения администратором им смогут пользоваться все.
      </p>

      {rows.length === 0 ? (
        <EmptyState compact icon="🗂" title="Типов пока нет" description="Создайте первый подтип — он появится в выборе при создании проекта." />
      ) : (
        <ul className="ptypes-list" role="list">
          {rows.map(({ node, depth }) => {
            const mine = Boolean(currentUsername) && node.ownerId === currentUsername
            const features = chainFeatures(node)
            const enabled = PROJECT_FEATURES.filter((feature) => features[feature])
            return (
              <li key={node.id} style={{ paddingLeft: `${depth * 16}px` }}>
                <div className="ptypes-row">
                  <span className="ptypes-name">
                    {node.name}
                    {node.builtin
                      ? <span className="proj-muted"> · встроенный</span>
                      : <span className="proj-muted"> · {PROJECT_TYPE_STATUS_LABELS[node.status].toLowerCase()}</span>}
                  </span>
                  {mine && (
                    <span className="ptypes-actions">
                      {(node.status === 'private' || node.status === 'rejected') && onPublish && (
                        <Button size="sm" variant="secondary" onClick={() => onPublish(node.id)}>Отправить на утверждение</Button>
                      )}
                      {node.status === 'published' && onUnpublish && (
                        <Button size="sm" variant="ghost" onClick={() => onUnpublish(node.id)}>Отозвать</Button>
                      )}
                      {onDelete && node.status !== 'published' && (
                        <IconButton size="sm" className="vc-btn--danger-quiet" aria-label={`Удалить тип ${node.name}`} title="Удалить тип" onClick={() => onDelete(node.id)}>✕</IconButton>
                      )}
                    </span>
                  )}
                </div>
                {node.description && <p className="ptypes-desc">{node.description}</p>}
                <ul className="newproj-features" role="list">
                  {enabled.length
                    ? enabled.map((feature) => <li key={feature} className="newproj-chip" title={PROJECT_FEATURE_LABELS[feature]}>{feature}</li>)
                    : <li className="newproj-chip newproj-chip--muted">только доска и задачи</li>}
                </ul>
                {node.status === 'rejected' && node.reviewNote && (
                  <p className="ptypes-note" role="note">Отклонено: {node.reviewNote}</p>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {onCreate && (
        <div className="ptypes-create">
          <label className="proj-invite-field">
            <span className="proj-field-label">Название подтипа</span>
            <input className="login-input" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit() }} placeholder="Например, Бэкенд-сервис" />
          </label>
          <label className="proj-invite-field">
            <span className="proj-field-label">Родитель</span>
            <select className="login-input" value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="">— без родителя —</option>
              {rows.map(({ node, depth }) => (
                <option key={node.id} value={node.id}>{' '.repeat(depth * 2) + node.name}</option>
              ))}
            </select>
          </label>
          <Button onClick={submit} disabled={!name.trim()}>Создать подтип</Button>
        </div>
      )}
    </div>
  )
}
