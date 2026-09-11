import { mt, useMakeLocale, formatMakeDate } from '../i18n'
// Preview element comments (item 32): numbered list matching iframe inspector markers, a form for
// the selected element, resolve/delete actions, and forwarding open issues to the assistant.
import { useState } from 'react'
import type { MakeComment } from '@shared/make'
import { Button, IconButton, EmptyState } from '@voicechat/ui-kit'

export interface MakeCommentsPanelProps {
  comments: MakeComment[]
  /** Selected preview element to attach a new comment to. */
  selected: { selector: string; tag: string; text: string } | null
  onAdd: (text: string) => Promise<void>
  onResolve: (id: string, resolved: boolean) => void
  /** Approve a viewer comment (roadmap-4, item 34), moving it from pending into the main list and publication. */
  onApprove?: (id: string) => void
  onRemove: (id: string) => void
  onHighlight: (selector: string) => void
  onAskAssistant?: (text: string) => void
  onClose: () => void
}

/** Assistant request text for open comments, numbered consistently with preview markers. */
export function commentsPrompt(comments: MakeComment[]): string {
  const open = comments.filter((c) => !c.resolved && c.status !== 'pending')
  const lines = open.map((c, i) => mt("valueValueSelectorValueValue", { p0: i + 1, p1: c.elementLabel || c.selector, p2: c.selector, p3: c.text }))
  return mt("previewFeedbackValueValueFixEachItemFindThe", { p0: open.length, p1: lines.join('\n') })
}

export function MakeCommentsPanel({ comments, selected, onAdd, onResolve, onApprove, onRemove, onHighlight, onAskAssistant, onClose }: MakeCommentsPanelProps): JSX.Element {
  useMakeLocale()
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
    <aside className="make-comments" aria-label={mt("previewComments")} data-testid="make-comments">
      <div className="make-comments-head">
        <strong>{mt("comments")}</strong>
        <small>{open.length}{' '}{mt("open")}{' '}{comments.filter((c) => c.resolved).length}{' '}{mt("resolved")}{pending.length > 0 ? <> · <b className="make-comment-pending-count" data-testid="make-comments-pending">{pending.length}{' '}{mt("awaitingModeration")}</b></> : null}</small>
        <span className="make-head-spacer" />
        {onAskAssistant && open.length > 0 && <Button size="sm" variant="primary" onClick={() => onAskAssistant(commentsPrompt(comments))}>{mt("fixAll")}</Button>}
        <IconButton size="sm" aria-label={mt("closeComments")} title={mt("close")} onClick={onClose}>✕</IconButton>
      </div>
      <form className="make-comment-form" onSubmit={(e) => { e.preventDefault(); void submit() }}>
        {selected
          ? <code className="make-comment-target" title={selected.selector}>&lt;{selected.tag}&gt; {selected.text ? `«${selected.text.slice(0, 40)}»` : selected.selector}</code>
          : <span className="fsub">{mt("selectAnElementInThePreviewUsingSelectionMode")}</span>}
        <textarea className="tin" aria-label={mt("commentText")} placeholder={selected ? mt("whatIsWrongWithThisElement") : mt("selectAnElementFirst")} rows={2} value={text} disabled={!selected || busy} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit() } }} />
        <Button size="sm" variant="secondary" type="submit" disabled={!selected || !text.trim() || busy} loading={busy}>{mt("add")}</Button>
      </form>
      {comments.length === 0 ? <EmptyState title={mt("noCommentsYet")} description={mt("selectAnElementInThePreviewAndDescribeWhat")} /> : (
        <ul className="make-comment-list" role="list">
          {comments.map((c) => {
            const n = open.indexOf(c) + 1
            return (
              <li key={c.id} className={`make-comment${c.resolved ? ' resolved' : ''}${c.status === 'pending' ? ' make-comment--pending' : ''}`}>
                <button type="button" className="make-comment-pin" aria-label={mt("showCommentElementValue", { p0: c.resolved ? '' : n })} title={mt("showInPreview")} onClick={() => onHighlight(c.selector)}>{c.resolved ? '✓' : n}</button>
                <div className="make-comment-body">
                  <code className="make-comment-el" title={c.selector}>{c.elementLabel || c.selector}</code>
                  <p>{c.text}</p>
                  <small>{c.status === 'pending' ? mt("awaitingModeration_f88224") : ''}{c.author === 'guest' ? mt("viewerValue", { p0: c.guestName ? ` ${c.guestName}` : '' }) : c.author} · {formatMakeDate(c.createdAt)}</small>
                </div>
                <span className="make-comment-actions">
                  {c.status === 'pending' && onApprove ? <Button size="sm" variant="primary" onClick={() => onApprove(c.id)}>{mt("approve")}</Button> : <Button size="sm" variant="ghost" onClick={() => onResolve(c.id, !c.resolved)}>{c.resolved ? mt("restore") : mt("resolved_8113f2")}</Button>}
                  <IconButton size="sm" aria-label={mt("deleteCommentValue", { p0: c.text.slice(0, 20) })} title={mt("delete")} onClick={() => onRemove(c.id)}>✕</IconButton>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </aside>
  )
}
