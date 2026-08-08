import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { KanbanAssistantSelection, WidgetAssistantCommand, WidgetAssistantContext, WidgetAssistantProposal } from '@shared/widgetAssistant'
import { isWidgetAssistantProposal } from '@shared/widgetAssistant'
import { WidgetProposalCard } from './WidgetAssistantFrame'

export interface KanbanAssistantReply {
  text: string
  commands?: WidgetAssistantCommand[]
}

export interface KanbanAssistantProps {
  context: WidgetAssistantContext<KanbanAssistantSelection>
  request: (text: string, context: WidgetAssistantContext<KanbanAssistantSelection>) => Promise<KanbanAssistantReply>
  onCommand: (command: WidgetAssistantCommand) => void | Promise<void>
}

/** Kanban adapter chat. Context is read again for every request, so card/field/action changes cannot go stale. */
export function KanbanAssistant({ context, request, onCommand }: KanbanAssistantProps): JSX.Element {
  const [draft, setDraft] = useState('')
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; text: string }>>([])
  const [proposal, setProposal] = useState<WidgetAssistantProposal | null>(null)
  const [busy, setBusy] = useState(false)
  const liveContext = useRef(context)
  useEffect(() => { liveContext.current = context }, [context])

  const runCommand = async (command: WidgetAssistantCommand): Promise<void> => {
    if (isWidgetAssistantProposal(command)) { setProposal(command); return }
    await onCommand(command)
  }
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const text = draft.trim()
    if (!text || busy) return
    setDraft('')
    setMessages((items) => [...items, { role: 'user', text }])
    setBusy(true)
    try {
      const reply = await request(text, liveContext.current)
      setMessages((items) => [...items, { role: 'assistant', text: reply.text }])
      for (const command of reply.commands ?? []) await runCommand(command)
    } catch {
      setMessages((items) => [...items, { role: 'assistant', text: 'Не удалось получить ответ. Попробуйте ещё раз.' }])
    } finally { setBusy(false) }
  }
  return <div className="kanban-assistant">
    <div className="kanban-assistant-context" data-testid="kanban-assistant-context">
      <span>{context.project?.name ?? 'Без проекта'}</span>
      <span>{context.selection?.openTask?.title ?? 'Доска'}</span>
      {context.selection?.selectedField && <span>{context.selection.selectedField}</span>}
    </div>
    <div className="kanban-assistant-messages" aria-live="polite">
      {messages.length === 0 && <p className="kanban-assistant-empty">Спросите о доске или открытой задаче. Любые изменения появятся как предложение.</p>}
      {messages.map((message, index) => <p key={index} className={`kanban-assistant-message kanban-assistant-message--${message.role}`}>{message.text}</p>)}
      {busy && <p role="status">Ассистент думает…</p>}
      {proposal && <WidgetProposalCard proposal={proposal} context={context} onConfirm={() => { const next = proposal; setProposal(null); void onCommand(next) }} onCancel={() => setProposal(null)} />}
    </div>
    <form className="kanban-assistant-form" onSubmit={(event) => void submit(event)}>
      <label><span className="vc-sr-only">Сообщение ассистенту</span><textarea rows={3} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Спросить ассистента…" /></label>
      <button className="vc-btn vc-btn--primary" type="submit" disabled={busy || !draft.trim()}>Отправить</button>
    </form>
  </div>
}
