// Очередь типов проекта на утверждение. Пользователь заводит свой подтип и
// отправляет его на публикацию; пока администратор не решил, узел видит только
// автор. Отказ обязан нести причину — иначе автор не знает, что исправлять.
import { useState } from 'react'
import { Button, EmptyState } from '@voicechat/ui-kit'
import {
  PROJECT_FEATURES,
  PROJECT_FEATURE_LABELS,
  resolveProjectTypeFeatures,
  type ProjectTypeNode
} from '@shared/projectTypes'

export interface ProjectTypesAdminProps {
  pending: ProjectTypeNode[]
  onReview: (input: { id: string; decision: 'approve' | 'reject'; note?: string }) => void | Promise<void>
}

export function ProjectTypesAdmin({ pending, onReview }: ProjectTypesAdminProps): JSX.Element {
  // Причина хранится по узлу: в очереди их несколько, общее поле путало бы.
  const [notes, setNotes] = useState<Record<string, string>>({})

  return (
    <section className="admin-page" data-testid="project-types-admin">
      <h2>Типы проектов на утверждении</h2>
      <p className="admin-hint">
        Опубликованный тип становится виден всем пользователям и доступен для новых проектов.
        Отклонение возвращает узел автору вместе с причиной.
      </p>

      {pending.length === 0 ? (
        <EmptyState compact icon="🗂" title="Заявок нет" description="Здесь появятся типы, отправленные пользователями на утверждение." />
      ) : (
        <ul className="ptypes-queue" role="list">
          {pending.map((node) => {
            const features = resolveProjectTypeFeatures([node])
            const enabled = PROJECT_FEATURES.filter((feature) => features[feature])
            return (
              <li key={node.id}>
                <div className="ptypes-row">
                  <span className="ptypes-name">{node.name}</span>
                  <span className="admin-muted">автор: {node.ownerId ?? node.createdBy}</span>
                </div>
                {node.description && <p className="ptypes-desc">{node.description}</p>}
                <ul className="newproj-features" role="list">
                  {enabled.length
                    ? enabled.map((feature) => <li key={feature} className="newproj-chip" title={PROJECT_FEATURE_LABELS[feature]}>{feature}</li>)
                    : <li className="newproj-chip newproj-chip--muted">только доска и задачи</li>}
                </ul>
                <div className="ptypes-review">
                  <label className="ptypes-review-field">
                    <span className="admin-label">Причина отказа</span>
                    <input
                      className="admin-input"
                      value={notes[node.id] ?? ''}
                      placeholder="Нужна для «Отклонить»"
                      onChange={(e) => setNotes({ ...notes, [node.id]: e.target.value })}
                    />
                  </label>
                  <div className="ptypes-review-actions">
                    <Button size="sm" onClick={() => onReview({ id: node.id, decision: 'approve' })}>Утвердить</Button>
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={!(notes[node.id] ?? '').trim()}
                      title={(notes[node.id] ?? '').trim() ? undefined : 'Укажите причину отказа'}
                      onClick={() => onReview({ id: node.id, decision: 'reject', note: (notes[node.id] ?? '').trim() })}
                    >
                      Отклонить
                    </Button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
