// Комментарии к элементам превью (п.32): список с метками-номерами (те же номера рисует инспектор
// в iframe), форма для выбранного элемента, «решено»/удалить и передача открытых замечаний ассистенту.
import { useState } from 'react'
import type { MakeComment } from '@shared/make'
import { Button, IconButton, EmptyState } from '@voicechat/ui-kit'

export interface MakeCommentsPanelProps {
  comments: MakeComment[]
  /** Выбранный в превью элемент — к нему привязывается новый комментарий. */
  selected: { selector: string; tag: string; text: string } | null
  onAdd: (text: string) => Promise<void>
  onResolve: (id: string, resolved: boolean) => void
  /** Одобрить комментарий зрителя (roadmap-4 п.34): из `pending` в общий список и на публикацию. */
  onApprove?: (id: string) => void
  onRemove: (id: string) => void
  onHighlight: (selector: string) => void
  onAskAssistant?: (text: string) => void
  onClose: () => void
}

/** Текст запроса ассистенту по открытым комментариям — нумерация та же, что у меток в превью. */
export function commentsPrompt(comments: MakeComment[]): string {
  const open = comments.filter((c) => !c.resolved && c.status !== 'pending')
  const lines = open.map((c, i) => `${i + 1}. ${c.elementLabel || c.selector} (селектор \`${c.selector}\`): ${c.text}`)
  return `Замечания к превью (${open.length}):\n${lines.join('\n')}\nИсправь каждое: найди элемент по селектору в файлах проекта (make_read_file), внеси правку и перечисли, что изменил по каждому пункту. `
}

export function MakeCommentsPanel({ comments, selected, onAdd, onResolve, onApprove, onRemove, onHighlight, onAskAssistant, onClose }: MakeCommentsPanelProps): JSX.Element {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const open = comments.filter((c) => !c.resolved && c.status !== 'pending')
  const pending = comments.filter((c) => c.status === 'pending')
  const submit = async (): Promise<void> => {
    if (!text.trim() || !selected) return
    setBusy(true)
    try { await onAdd(text.trim()); setText('') } finally { setBusy(false) }
  }
  return (
    <aside className="make-comments" aria-label="Комментарии к превью" data-testid="make-comments">
      <div className="make-comments-head">
        <strong>Комментарии</strong>
        <small>{open.length} открытых · {comments.filter((c) => c.resolved).length} решено{pending.length > 0 ? <> · <b className="make-comment-pending-count" data-testid="make-comments-pending">{pending.length} на модерации</b></> : null}</small>
        <span className="make-head-spacer" />
        {onAskAssistant && open.length > 0 && <Button size="sm" variant="primary" onClick={() => onAskAssistant(commentsPrompt(comments))}>Исправить все</Button>}
        <IconButton size="sm" aria-label="Закрыть комментарии" title="Закрыть" onClick={onClose}>✕</IconButton>
      </div>
      <form className="make-comment-form" onSubmit={(e) => { e.preventDefault(); void submit() }}>
        {selected
          ? <code className="make-comment-target" title={selected.selector}>&lt;{selected.tag}&gt; {selected.text ? `«${selected.text.slice(0, 40)}»` : selected.selector}</code>
          : <span className="fsub">Выберите элемент в превью (режим выбора), чтобы оставить комментарий.</span>}
        <textarea className="tin" aria-label="Текст комментария" placeholder={selected ? 'Что не так с этим элементом?' : 'Сначала выберите элемент'} rows={2} value={text} disabled={!selected || busy} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit() } }} />
        <Button size="sm" variant="secondary" type="submit" disabled={!selected || !text.trim() || busy} loading={busy}>Добавить</Button>
      </form>
      {comments.length === 0 ? <EmptyState title="Комментариев пока нет" description="Выберите элемент в превью и опишите, что поправить — метка появится прямо на странице." /> : (
        <ul className="make-comment-list" role="list">
          {comments.map((c) => {
            const n = open.indexOf(c) + 1
            return (
              <li key={c.id} className={`make-comment${c.resolved ? ' resolved' : ''}${c.status === 'pending' ? ' make-comment--pending' : ''}`}>
                <button type="button" className="make-comment-pin" aria-label={`Показать элемент комментария ${c.resolved ? '' : n}`} title="Показать в превью" onClick={() => onHighlight(c.selector)}>{c.resolved ? '✓' : n}</button>
                <div className="make-comment-body">
                  <code className="make-comment-el" title={c.selector}>{c.elementLabel || c.selector}</code>
                  <p>{c.text}</p>
                  <small>{c.status === 'pending' ? '⏳ на модерации · ' : ''}{c.author === 'guest' ? `зритель${c.guestName ? ` ${c.guestName}` : ''}` : c.author} · {new Date(c.createdAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</small>
                </div>
                <span className="make-comment-actions">
                  {c.status === 'pending' && onApprove ? <Button size="sm" variant="primary" onClick={() => onApprove(c.id)}>Одобрить</Button> : <Button size="sm" variant="ghost" onClick={() => onResolve(c.id, !c.resolved)}>{c.resolved ? 'Вернуть' : 'Решено'}</Button>}
                  <IconButton size="sm" aria-label={`Удалить комментарий ${c.text.slice(0, 20)}`} title="Удалить" onClick={() => onRemove(c.id)}>✕</IconButton>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </aside>
  )
}
