import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { KanbanAssistantSelection, WidgetAssistantCommand, WidgetAssistantContext, WidgetAssistantProposal } from '@shared/widgetAssistant'
import { isWidgetAssistantProposal, parseWidgetAssistantReply } from '@shared/widgetAssistant'
import type { Conversation, Message } from '@shared/types'
import type { LlmEngineOption } from '@shared/admin'
import type { RendererApi } from '@shared/ipc'
import { WidgetProposalCard } from './WidgetAssistantFrame'

export interface KanbanAssistantReply {
  text: string
  commands?: WidgetAssistantCommand[]
}

export interface KanbanAssistantProps {
  projectId: string
  context: WidgetAssistantContext<KanbanAssistantSelection>
  api: RendererApi
  llmEngines: LlmEngineOption[]
  transport?: Pick<NonNullable<typeof window.claude>, 'send' | 'onToken' | 'onDone' | 'onError'>
  onCommand: (command: WidgetAssistantCommand) => void | Promise<void>
}

/** Kanban adapter chat. Context is read again for every request, so card/field/action changes cannot go stale. */
export function KanbanAssistant({ projectId, context, api, llmEngines, transport = window.claude, onCommand }: KanbanAssistantProps): JSX.Element {
  const [draft, setDraft] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [effective, setEffective] = useState<{ llmEngineId: string | null; provider: 'claude' | 'codex'; model: string; inherited: boolean } | null>(null)
  const [proposal, setProposal] = useState<WidgetAssistantProposal | null>(null)
  const [busy, setBusy] = useState(false)
  const [partial, setPartial] = useState('')
  const liveContext = useRef(context)
  useEffect(() => { liveContext.current = context }, [context])
  const reload = async (): Promise<void> => {
    const data = await api['kanbanAssistant:get']({ projectId })
    setConversation(data.conversation); setMessages(data.messages); setEffective(data.effectiveLlm)
  }
  useEffect(() => { void reload() }, [projectId])
  useEffect(() => {
    if (!transport || !conversation) return
    return transport.onToken((event) => { if (event.conversationId === conversation.id) setPartial((value) => value + event.delta) })
  }, [transport, conversation?.id])
  useEffect(() => {
    if (!transport || !conversation) return
    const done = transport.onDone((event) => {
      if (event.conversationId !== conversation.id) return
      setBusy(false); setPartial('')
      if (event.message) setMessages((items) => [...items.filter((item) => item.id !== event.message!.id), event.message!])
      const parsed = parseWidgetAssistantReply(event.text)
      for (const command of parsed.commands) void runCommand(command)
    })
    const error = transport.onError((event) => { if (event.conversationId === conversation.id) { setBusy(false); setPartial(''); void reload() } })
    return () => { done(); error() }
  }, [transport, conversation?.id])

  const runCommand = async (command: WidgetAssistantCommand): Promise<void> => {
    if (isWidgetAssistantProposal(command)) { setProposal(command); return }
    await onCommand(command)
  }
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const text = draft.trim()
    if (!text || busy) return
    setDraft('')
    if (!conversation || !transport) return
    setBusy(true)
    try {
      const message = await api['messages:add']({ conversationId: conversation.id, role: 'u0', text, time: new Date().toTimeString().slice(0, 5) })
      setMessages((items) => [...items, message])
      transport.send({ conversationId: conversation.id, segments: [{ speakerId: 0, text, start: 0, end: 0 }], verbose: true, execTarget: 'none', assistantContext: liveContext.current })
    } catch {
      setBusy(false)
    }
  }
  return <div className="kanban-assistant">
    <div className="kanban-assistant-context" data-testid="kanban-assistant-context">
      <span>{context.project?.name ?? 'Без проекта'}</span>
      <span>{context.selection?.openTask?.title ?? 'Доска'}</span>
      {context.selection?.selectedField && <span>{context.selection.selectedField}</span>}
    </div>
    <div className="kanban-assistant-messages" aria-live="polite">
      {messages.length === 0 && <p className="kanban-assistant-empty">Спросите о доске или открытой задаче. Любые изменения появятся как предложение.</p>}
      {messages.map((message) => { const parsed = message.role === 'ai' ? parseWidgetAssistantReply(message.text) : null; return <p key={message.id} className={`kanban-assistant-message kanban-assistant-message--${message.role === 'ai' ? 'assistant' : 'user'}`}>{parsed?.text ?? message.text}</p> })}
      {partial && <p className="kanban-assistant-message kanban-assistant-message--assistant">{partial}</p>}
      {busy && <p role="status">Ассистент думает…</p>}
      {proposal && <WidgetProposalCard proposal={proposal} context={context} onConfirm={() => { const next = proposal; setProposal(null); void onCommand(next) }} onCancel={() => setProposal(null)} />}
    </div>
    {conversation && effective && <details className="kanban-assistant-settings"><summary>LLM: {effective.provider} · {effective.model}{effective.inherited ? ' (из проекта)' : ''}</summary><div><label>Исполнитель<select value={conversation.llmEngineId ?? ''} onChange={(event) => void api['conversations:setExecTarget']({ id: conversation.id, execTarget: 'none', llmEngineId: event.target.value || null }).then(reload)}><option value="">Из проекта</option>{llmEngines.map((engine) => <option key={engine.id} value={engine.id}>{engine.name}</option>)}</select></label><label>Provider<select value={conversation.llmProvider ?? ''} onChange={(event) => { const provider = event.target.value as 'claude' | 'codex' | ''; void api['conversations:setExecTarget']({ id: conversation.id, execTarget: 'none', llmProvider: provider || null, llmModel: provider ? effective.model : null }).then(reload) }}><option value="">Из проекта</option><option value="claude">Claude</option><option value="codex">Codex</option></select></label><label>Модель<input value={conversation.llmModel ?? ''} disabled={!conversation.llmProvider} onChange={(event) => setConversation({ ...conversation, llmModel: event.target.value })} onBlur={() => void api['conversations:setExecTarget']({ id: conversation.id, execTarget: 'none', llmModel: conversation.llmModel }).then(reload)} /></label><button type="button" onClick={() => void api['conversations:setExecTarget']({ id: conversation.id, execTarget: 'none', llmEngineId: null, llmProvider: null, llmModel: null }).then(reload)}>Сбросить к проекту</button></div></details>}
    <form className="kanban-assistant-form" onSubmit={(event) => void submit(event)}>
      <label><span className="vc-sr-only">Сообщение ассистенту</span><textarea rows={3} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Спросить ассистента…" /></label>
      <button className="vc-btn vc-btn--primary" type="submit" disabled={busy || !draft.trim()}>Отправить</button>
    </form>
  </div>
}
