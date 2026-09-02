// Карточка предложения из очереди «Улучшения». Очередь обслуживается без
// редактирования: пользователь читает, что предлагается сделать, и нажимает одну
// из трёх кнопок — задача уходит в TODO, в TODO с немедленной подготовкой, либо
// предложение удаляется. Текст задачи (название, описание, критерии) берёт
// сервер из самого предложения, поэтому форма здесь не нужна.

import { useState } from 'react'
import type { Board } from '@shared/projects'
import type { CreateTaskFromImprovementResult, ImprovementSource, ImprovementStatus, ProjectImprovement } from '@shared/ci'
import { Button, Dialog, ErrorState, PropertyRow, StatusPill, type StatusTone } from '@voicechat/ui-kit'
import { Markdown } from '../Markdown'
import { issueKey } from './kanbanMeta'

const STATUS_LABEL: Record<ImprovementStatus, string> = { new: 'Новое', accepted: 'Принято', rejected: 'Отклонено', implemented: 'Реализовано' }
const STATUS_TONE: Record<ImprovementStatus, StatusTone> = { new: 'running', accepted: 'accent', rejected: 'neutral', implemented: 'success' }
const SOURCE_LABEL: Record<ImprovementSource, string> = {
  development: 'разработка', preparation: 'подготовка', component_qa: 'компонентное QA', integration_tests: 'интеграционные тесты',
  automated_qa: 'автоматическое QA', merge: 'merge', system: 'система'
}

export interface ImprovementModalProps {
  improvement: ProjectImprovement
  projectName: string
  board: Board
  /** Создать задачу; `startPreparation` — сразу отправить её в подготовку. */
  onCreateTask: (id: string, startPreparation: boolean) => Promise<CreateTaskFromImprovementResult>
  /** Удалить предложение из очереди. */
  onDelete: (id: string) => Promise<void>
  /** Что делать с созданной задачей (открыть карточку). */
  onCreated?: (result: CreateTaskFromImprovementResult) => void
  onClose: () => void
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function ImprovementModal(props: ImprovementModalProps): JSX.Element {
  const { improvement } = props
  const [pending, setPending] = useState<'create' | 'prepare' | 'delete' | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Удаление необратимо, но диалог подтверждения ломал бы обещание «одна кнопка»:
  // вместо него та же кнопка на первом нажатии просит подтвердить.
  const [confirmDelete, setConfirmDelete] = useState(false)
  const busy = pending !== null
  const columnName = props.board.columns.find((column) => column.id === improvement.taskColumnId)?.name ?? '—'
  const criteria = improvement.acceptanceCriteria.split('\n').map((line) => line.trim()).filter(Boolean)

  const create = async (startPreparation: boolean): Promise<void> => {
    if (busy) return
    setPending(startPreparation ? 'prepare' : 'create'); setError(null)
    try {
      const result = await props.onCreateTask(improvement.id, startPreparation)
      if (result.preparationError) setError(`Задача создана, но подготовка не запущена: ${result.preparationError}`)
      props.onCreated?.(result)
      if (!result.preparationError) props.onClose()
    } catch (e) { setError(errorMessage(e)) }
    finally { setPending(null) }
  }
  const remove = async (): Promise<void> => {
    if (busy) return
    if (!confirmDelete) { setConfirmDelete(true); return }
    setPending('delete'); setError(null)
    try { await props.onDelete(improvement.id); props.onClose() }
    catch (e) { setError(errorMessage(e)) }
    finally { setPending(null) }
  }

  return (
    <Dialog
      title={improvement.title}
      ariaLabel={`Улучшение: ${improvement.title}`}
      size="md"
      padded
      onClose={busy ? undefined : props.onClose}
      footer={<div className="improvement-modal__footer" data-testid="improvement-modal-actions">
        <Button variant="danger" size="sm" loading={pending === 'delete'} disabled={busy && pending !== 'delete'} onClick={() => void remove()} data-testid="improvement-delete">
          {confirmDelete ? 'Точно удалить предложение?' : 'Отменить'}
        </Button>
        <span className="improvement-modal__spacer" />
        <Button size="sm" loading={pending === 'prepare'} disabled={busy && pending !== 'prepare'} onClick={() => void create(true)} data-testid="improvement-create-prepare">Создать и подготовить</Button>
        <Button variant="primary" size="sm" loading={pending === 'create'} disabled={busy && pending !== 'create'} onClick={() => void create(false)} data-testid="improvement-create">Создать задачу</Button>
      </div>}
    >
      <div className="improvement-modal" data-testid="improvement-modal">
        <div className="improvement-modal__meta">
          <StatusPill tone={STATUS_TONE[improvement.status]}>{STATUS_LABEL[improvement.status]}</StatusPill>
          <span className="improvement-modal__dim">источник: {SOURCE_LABEL[improvement.source]}</span>
          {improvement.occurrences > 1 && <span className="improvement-modal__dim">· замечено {improvement.occurrences} раз</span>}
        </div>
        <PropertyRow label="Из задачи">
          <span data-testid="improvement-source-task">{issueKey(props.projectName, { seq: improvement.taskSeq })} · {improvement.taskTitle}</span>
          <span className="improvement-modal__dim"> · колонка «{columnName}»</span>
        </PropertyRow>
        {error && <ErrorState compact message="Действие не выполнено" detail={error} testId="improvement-modal-error" />}
        <section className="improvement-modal__section">
          <h3>Описание</h3>
          <Markdown>{improvement.description}</Markdown>
        </section>
        <section className="improvement-modal__section" data-testid="improvement-criteria">
          <h3>Критерии приёмки</h3>
          {criteria.length ? <ul>{criteria.map((line, index) => <li key={index}>{line}</li>)}</ul> : <p className="improvement-modal__dim">Критерии не сформулированы: задача создастся с пустыми критериями.</p>}
        </section>
        {improvement.files.length > 0 && <section className="improvement-modal__section" data-testid="improvement-files">
          <h3>Файлы</h3>
          <ul className="improvement-modal__files">{improvement.files.map((file) => <li key={file}><code>{file}</code></li>)}</ul>
        </section>}
        {improvement.evidence.length > 0 && <section className="improvement-modal__section">
          <h3>Подтверждающие данные</h3>
          <ul>{improvement.evidence.map((line, index) => <li key={index}>{line}</li>)}</ul>
        </section>}
      </div>
    </Dialog>
  )
}
