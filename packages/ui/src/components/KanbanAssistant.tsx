import { useEffect, useRef, useState } from 'react'
import { EmbeddedChat } from '@voicechat/chat-app'
import type { KanbanAssistantSelection, SupportedTaskPatch, WidgetAssistantCommand, WidgetAssistantContext, WidgetAssistantProposal, WidgetToolScope } from '@shared/widgetAssistant'
import { isWidgetAssistantProposal, parseWidgetAssistantReply, taskWidgetItem } from '@shared/widgetAssistant'
import type { Conversation, Message } from '@shared/types'
import type { Orchestration } from '@shared/orchestration'
import type { LlmEngineOption } from '@shared/admin'
import type { RendererApi } from '@shared/ipc'
import { browserId } from '@shared/browserId'
import { projectAssistantChatKey } from '../store/contracts'
import { WidgetProposalCard } from './WidgetAssistantFrame'
import { ChatColumn } from './ChatColumn'
import { VoiceBar } from './VoiceBar'

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
  conversationId?: string | null
  /** Открыть карточку шага плана; без него названия шагов остаются текстом. */
  onOpenTask?: (taskId: string) => void
}

/** A selector option keeps its source independent from the UI, so new widget kinds need no selector changes. */
export interface ProjectAssistantChat {
  id: string
  title: string
  source: string
}

/** Значок шага плана: статус читается взглядом, без легенды. */
const PLAN_ITEM_MARKS: Record<string, string> = {
  pending: '·', running: '▸', done: '✓', failed: '✕', cancelled: '—'
}

const PLAN_STATUS_TITLES: Record<string, string> = {
  running: 'идёт', done: 'выполнен', failed: 'остановлен', cancelled: 'отменён'
}

export function projectAssistantChatSource(conversation: Conversation): string {
  return conversation.assistantKind ?? 'chat'
}

export interface ProjectAssistantChatSelectorProps {
  projectId: string
  api: RendererApi
  selectedId: string | null
  onSelect: (conversationId: string) => void
}

/** Project chats live in the assistant shell header; its source label is the widget kind or `chat`. */
export function ProjectAssistantChatSelector({ projectId, api, selectedId, onSelect }: ProjectAssistantChatSelectorProps): JSX.Element {
  const [chats, setChats] = useState<ProjectAssistantChat[]>([])

  const select = (id: string): void => {
    globalThis.localStorage?.setItem(projectAssistantChatKey(projectId), id)
    onSelect(id)
  }
  useEffect(() => {
    let current = true
    void Promise.all([api['conversations:list']({}), api['kanbanAssistant:get']({ projectId })]).then(([items, assistant]) => {
      if (!current) return
      const projectChats = items
        .filter((item) => item.projectId === projectId)
        .concat(assistant.conversation)
        .filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index)
        .map((item) => ({ id: item.id, title: item.title, source: projectAssistantChatSource(item) }))
      setChats(projectChats)
      const saved = globalThis.localStorage?.getItem(projectAssistantChatKey(projectId)) ?? null
      select(projectChats.some((chat) => chat.id === saved) ? saved! : assistant.conversation.id)
    })
    return () => { current = false }
  }, [api, projectId])

  const createChat = async (): Promise<void> => {
    const created = await api['conversations:create']({ title: 'Новый разговор' })
    const chat = await api['conversations:setProject']({ id: created.id, projectId })
    setChats((items) => [...items, { id: chat.id, title: chat.title, source: projectAssistantChatSource(chat) }])
    select(chat.id)
  }

  return <div className="project-assistant-chat-selector">
    <label>
      <span className="vc-sr-only">Чат ассистента</span>
      <select aria-label="Чат ассистента" value={selectedId ?? ''} onChange={(event) => { if (event.target.value) select(event.target.value) }}>
        <option value="" disabled>Выберите чат</option>
        {chats.map((chat) => <option key={chat.id} value={chat.id}>{chat.title} · {chat.source}</option>)}
      </select>
    </label>
    <button type="button" onClick={() => { void createChat() }}>Новый чат</button>
  </div>
}

/** Kanban adapter chat. Context is read again for every request, so card/field/action changes cannot go stale. */
export function KanbanAssistant({ projectId, context, api, llmEngines, transport = window.claude, onCommand, conversationId, onOpenTask }: KanbanAssistantProps): JSX.Element {
  const [draft, setDraft] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [effective, setEffective] = useState<{ llmEngineId: string | null; provider: 'claude' | 'codex'; model: string; inherited: boolean } | null>(null)
  const [proposal, setProposal] = useState<{ command: WidgetAssistantProposal; turnId: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [partial, setPartial] = useState('')
  const [plans, setPlans] = useState<Orchestration[]>([])
  // Завершённый план остаётся на виду до явного «Скрыть»: иначе результат
  // серии задач исчезает ровно в тот момент, когда он и стал интересен.
  const [hiddenPlans, setHiddenPlans] = useState<string[]>([])
  const liveContext = useRef(context)
  useEffect(() => { liveContext.current = context }, [context])
  const reload = async (): Promise<void> => {
    try {
      const data = await api['kanbanAssistant:get']({ projectId, ...(conversationId ? { conversationId } : {}) })
      setConversation(data.conversation); setMessages(data.messages); setEffective(data.effectiveLlm); setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить разговор')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    let current = true
    setConversation(null); setMessages([]); setPartial(''); setBusy(false); setProposal(null); setError(null); setLoading(true)
    void api['kanbanAssistant:get']({ projectId, ...(conversationId ? { conversationId } : {}) }).then((data) => {
      if (!current) return
      setConversation(data.conversation); setMessages(data.messages); setEffective(data.effectiveLlm); setLoading(false)
    }, (err: unknown) => {
      if (!current) return
      setError(err instanceof Error ? err.message : 'Не удалось загрузить разговор'); setLoading(false)
    })
    return () => { current = false }
  }, [api, projectId, conversationId])
  useEffect(() => {
    if (!transport || !conversation) return
    return transport.onToken((event) => { if (event.conversationId === conversation.id) setPartial((value) => value + event.delta) })
  }, [transport, conversation?.id])
  // Планы работ ассистента: снимок при открытии и живые изменения кадром.
  // Панель нужна и после F5, и когда план поставил другой чат этого проекта.
  useEffect(() => {
    let current = true
    void api['orchestrations:list']({ projectId }).then((items) => { if (current) setPlans(items) })
    const bridge = window.widgetUi
    const off = bridge?.onOrchestration((plan) => {
      if (plan.projectId !== projectId) return
      setPlans((items) => [plan, ...items.filter((item) => item.id !== plan.id)])
      // Итог плана сервер кладёт в ленту обычным сообщением — перечитываем её,
      // иначе отчёт появится только после перезагрузки страницы.
      if (plan.status !== 'running') void reload()
    })
    return () => { current = false; off?.() }
  }, [api, projectId])
  useEffect(() => {
    if (!transport || !conversation) return
    const done = transport.onDone((event) => {
      if (event.conversationId !== conversation.id) return
      setBusy(false); setPartial('')
      if (event.message) setMessages((items) => [...items.filter((item) => item.id !== event.message!.id), event.message!])
      const parsed = parseWidgetAssistantReply(event.text)
      for (const command of parsed.commands) void runCommand(command, event.message?.id)
    })
    const error = transport.onError((event) => {
      if (event.conversationId !== conversation.id) return
      setBusy(false); setPartial(''); setError(event.message || 'Не удалось получить ответ ассистента')
    })
    return () => { done(); error() }
  }, [transport, conversation?.id])

  const runCommand = async (command: WidgetAssistantCommand, turnId?: string): Promise<void> => {
    if (isWidgetAssistantProposal(command)) { if (turnId) setProposal({ command, turnId }); return }
    await onCommand(command)
  }
  const toolScope = (turnId: string): WidgetToolScope | null => conversation ? {
    version: 1,
    widgetKind: liveContext.current.widget.kind,
    widgetInstanceId: liveContext.current.widget.instanceId,
    projectId,
    conversationId: conversation.id,
    turnId
  } : null
  const confirmProposal = async (command: WidgetAssistantProposal, turnId: string): Promise<void> => {
    if (command.type === 'propose.settings-update') { await onCommand(command); return }
    const scope = toolScope(turnId)
    if (!scope) throw new Error('Чат ассистента больше не активен')
    const idempotencyKey = browserId()
    if (command.type === 'propose.task-create') {
      await api['widget:action']({
        ...scope,
        action: { name: 'kanban.task.create', input: command.input },
        confirmation: { confirmed: true, proposalId: turnId },
        idempotencyKey
      })
      return
    }
    const task = liveContext.current.selection?.board.tasks.find((item) => item.id === command.taskId)
    if (!task) throw new Error('Карточка отсутствует в актуальном снимке')
    const patch: SupportedTaskPatch = command.type === 'propose.task-update'
      ? command.patch
      : command.type === 'propose.acceptance-criteria'
        ? { acceptanceCriteria: command.value }
        : { [command.field]: command.value }
    await api['widget:action']({
      ...scope,
      action: { name: 'kanban.task.update', taskId: task.id, expectedVersion: String(task.updatedAt), patch },
      confirmation: { confirmed: true, proposalId: turnId },
      idempotencyKey
    })
  }
  const submit = async (input = draft): Promise<void> => {
    const text = input.trim()
    if (!text || busy) return
    if (input === draft) setDraft('')
    if (!conversation || !transport) return
    setError(null)
    setBusy(true)
    try {
      const message = await api['messages:add']({ conversationId: conversation.id, role: 'u0', text, time: new Date().toTimeString().slice(0, 5) })
      const scope = toolScope(message.id)!
      const semantic = liveContext.current.selection?.board
      const query = await api['widget:query']({
        ...scope,
        text,
        limit: 100,
        ...(semantic ? { ui: { revision: semantic.revision, items: semantic.tasks.map(taskWidgetItem) } } : {})
      })
      setMessages((items) => [...items, message])
      transport.send({ conversationId: conversation.id, segments: [{ speakerId: 0, text, start: 0, end: 0 }], verbose: true, execTarget: 'none', assistantContext: { ...liveContext.current, toolResults: { query } } })
    } catch (err) {
      setBusy(false)
      setError(err instanceof Error ? err.message : 'Не удалось отправить сообщение')
    }
  }
  const visiblePlans = plans
    .filter((plan) => !hiddenPlans.includes(plan.id))
    .filter((plan, index, all) => plan.status === 'running' || all.findIndex((item) => item.status !== 'running') === index)
  const visibleMessages = messages.map((message) => message.role === 'ai'
    ? { ...message, text: parseWidgetAssistantReply(message.text).text }
    : message)
  const aiLabel = effective?.provider === 'codex' ? 'Codex' : 'Claude'
  const assistantHeader = <div>
    <div className="kanban-assistant-status" data-state={loading ? 'loading' : error ? 'error' : !transport ? 'unavailable' : messages.length === 0 ? 'empty' : busy ? 'streaming' : 'active'} role={error || !transport ? 'alert' : 'status'}>
      {loading ? <><span className="kanban-assistant-spinner" aria-hidden="true" />Загружаем разговор…</> : error ? <><span>{error}</span><button type="button" onClick={() => { setLoading(true); void reload() }}>Повторить</button></> : !transport ? 'Ассистент временно недоступен: транспорт не подключён.' : messages.length === 0 ? 'С чего начнём? Опишите задачу — я помогу спланировать работу.' : busy ? 'Ассистент готовит ответ…' : 'Готов к работе'}
    </div>
    <div className="kanban-assistant-context" data-testid="kanban-assistant-context">
      <span>{context.project?.name ?? 'Без проекта'}</span>
      <span>{context.selection?.openTask?.title ?? 'Доска'}</span>
      {context.selection?.selectedField && <span>{context.selection.selectedField}</span>}
    </div>
    {proposal && <WidgetProposalCard proposal={proposal.command} context={context} onConfirm={() => { const next = proposal; setProposal(null); void confirmProposal(next.command, next.turnId) }} onCancel={() => setProposal(null)} />}
    {visiblePlans.map((plan) => <section key={plan.id} className="kanban-assistant-plan" data-status={plan.status} aria-label={`План работ: ${plan.title}`}>
      <header>
        <strong>{plan.title}</strong>
        <span>{PLAN_STATUS_TITLES[plan.status] ?? plan.status} · {plan.items.filter((item) => item.status === 'done').length}/{plan.items.length}</span>
        {plan.status === 'running'
          ? <button type="button" onClick={() => void api['orchestrations:cancel']({ planId: plan.id }).then((cancelled) => { if (cancelled) setPlans((items) => items.map((item) => item.id === cancelled.id ? cancelled : item)) })}>Остановить</button>
          : <button type="button" onClick={() => setHiddenPlans((items) => [...items, plan.id])} aria-label={`Скрыть план ${plan.title}`}>Скрыть</button>}
      </header>
      <ol>{plan.items.map((item) => <li key={item.id} data-status={item.status}>
        <span className="kanban-assistant-plan-status">{PLAN_ITEM_MARKS[item.status]}</span>
        {item.taskId
          ? <button type="button" className="kanban-assistant-plan-open" onClick={() => onOpenTask?.(item.taskId!)}>{item.title}</button>
          : <span>{item.title}</span>}
        {item.attempts > 0 && <span className="kanban-assistant-plan-attempts">попытка {item.attempts + 1}</span>}
        {item.error && <em>{item.error}</em>}
      </li>)}</ol>
    </section>)}
    {conversation && <label className="kanban-assistant-autonomy">
      <input
        type="checkbox"
        checked={(conversation.assistantAutonomy ?? 'auto') === 'auto'}
        onChange={(event) => {
          const autonomy = event.target.checked ? 'auto' : 'confirm'
          setConversation({ ...conversation, assistantAutonomy: autonomy })
          void api['kanbanAssistant:setAutonomy']({ conversationId: conversation.id, autonomy }).then((updated) => setConversation(updated))
        }}
      />
      <span>Автопилот</span>
      <span className="kanban-assistant-autonomy-hint">
        {(conversation.assistantAutonomy ?? 'auto') === 'auto'
          ? 'ассистент применяет изменения сам'
          : 'каждое изменение — с подтверждением'}
      </span>
    </label>}
    {conversation && effective && <details className="kanban-assistant-settings"><summary>LLM: {effective.provider} · {effective.model}{effective.inherited ? ' (из проекта)' : ''}</summary><div><label>Исполнитель<select value={conversation.llmEngineId ?? ''} onChange={(event) => void api['conversations:setExecTarget']({ id: conversation.id, execTarget: 'none', llmEngineId: event.target.value || null }).then(reload)}><option value="">Из проекта</option>{llmEngines.map((engine) => <option key={engine.id} value={engine.id}>{engine.name}</option>)}</select></label><label>Provider<select value={conversation.llmProvider ?? ''} onChange={(event) => { const provider = event.target.value as 'claude' | 'codex' | ''; void api['conversations:setExecTarget']({ id: conversation.id, execTarget: 'none', llmProvider: provider || null, llmModel: provider ? effective.model : null }).then(reload) }}><option value="">Из проекта</option><option value="claude">Claude</option><option value="codex">Codex</option></select></label><label>Модель<input value={conversation.llmModel ?? ''} disabled={!conversation.llmProvider} onChange={(event) => setConversation({ ...conversation, llmModel: event.target.value })} onBlur={() => void api['conversations:setExecTarget']({ id: conversation.id, execTarget: 'none', llmModel: conversation.llmModel }).then(reload)} /></label><button type="button" onClick={() => void api['conversations:setExecTarget']({ id: conversation.id, execTarget: 'none', llmEngineId: null, llmProvider: null, llmModel: null }).then(reload)}>Сбросить к проекту</button></div></details>}
  </div>
  return <EmbeddedChat>
    <div className="kanban-assistant"><ChatColumn
      title={conversation?.title ?? 'Канбан-ассистент'}
      state={busy ? 'thinking' : 'idle'}
      messages={visibleMessages}
      liveSegments={[]}
      diarization={false}
      streamingReply={partial}
      aiLabel={aiLabel}
      onAnswerQuestions={(text) => { void submit(text) }}
      taskHeader={assistantHeader}
      voiceBar={<VoiceBar
        state={busy ? 'thinking' : 'idle'}
        replyStarted={partial.length > 0}
        draft={draft}
        diarization={false}
        detectedSpeakers={[]}
        aiLabel={aiLabel}
        attachments={[]}
        onDraftChange={setDraft}
        onSubmitText={() => { void submit() }}
        onStartVoice={() => {}}
        onStopVoice={() => {}}
        onStopSpeak={() => {}}
        onCancelRequest={() => {}}
        onAddFiles={() => {}}
        onRemoveAttachment={() => {}}
        permissionMode="plan"
        voiceInputEnabled={false}
        defaultCollapsed={false}
      />}
    /></div>
  </EmbeddedChat>
}
