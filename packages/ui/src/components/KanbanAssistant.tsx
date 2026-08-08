import { useEffect, useRef, useState } from 'react'
import type { KanbanAssistantSelection, SupportedTaskPatch, WidgetAssistantCommand, WidgetAssistantContext, WidgetAssistantProposal, WidgetToolScope } from '@shared/widgetAssistant'
import { isWidgetAssistantProposal, parseWidgetAssistantReply, taskWidgetItem } from '@shared/widgetAssistant'
import type { Conversation, Message } from '@shared/types'
import type { LlmEngineOption } from '@shared/admin'
import type { RendererApi } from '@shared/ipc'
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
}

/** A selector option keeps its source independent from the UI, so new widget kinds need no selector changes. */
export interface ProjectAssistantChat {
  id: string
  title: string
  source: string
}

export function projectAssistantChatSource(conversation: Conversation): string {
  return conversation.assistantKind ?? 'chat'
}

export interface ProjectAssistantChatSelectorProps {
  projectId: string
  api: RendererApi
  onOpenChat: (conversationId: string) => void
  onNewChat?: () => void
}

/** Project chats live in the assistant shell header; its source label is the widget kind or `chat`. */
export function ProjectAssistantChatSelector({ projectId, api, onOpenChat, onNewChat }: ProjectAssistantChatSelectorProps): JSX.Element {
  const [chats, setChats] = useState<ProjectAssistantChat[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(() => globalThis.localStorage?.getItem(`voicechat.projectAssistantChat.${projectId}`) ?? null)

  useEffect(() => {
    setSelectedId(globalThis.localStorage?.getItem(`voicechat.projectAssistantChat.${projectId}`) ?? null)
    void Promise.all([api['conversations:list']({}), api['kanbanAssistant:get']({ projectId })]).then(([items, assistant]) => {
      const projectChats = items
        .filter((item) => item.projectId === projectId)
        .concat(assistant.conversation)
        .filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index)
        .map((item) => ({ id: item.id, title: item.title, source: projectAssistantChatSource(item) }))
      setChats(projectChats)
    })
  }, [api, projectId])

  return <div className="project-assistant-chat-selector">
    <label>
      <span className="vc-sr-only">Чат ассистента</span>
      <select aria-label="Чат ассистента" value={selectedId ?? ''} onChange={(event) => {
        const id = event.target.value
        if (!id) return
        setSelectedId(id)
        globalThis.localStorage?.setItem(`voicechat.projectAssistantChat.${projectId}`, id)
        onOpenChat(id)
      }}>
        <option value="" disabled>Выберите чат</option>
        {chats.map((chat) => <option key={chat.id} value={chat.id}>{chat.title} · {chat.source}</option>)}
      </select>
    </label>
    {onNewChat && <button type="button" onClick={onNewChat}>Новый чат</button>}
  </div>
}

/** Kanban adapter chat. Context is read again for every request, so card/field/action changes cannot go stale. */
export function KanbanAssistant({ projectId, context, api, llmEngines, transport = window.claude, onCommand }: KanbanAssistantProps): JSX.Element {
  const [draft, setDraft] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [effective, setEffective] = useState<{ llmEngineId: string | null; provider: 'claude' | 'codex'; model: string; inherited: boolean } | null>(null)
  const [proposal, setProposal] = useState<{ command: WidgetAssistantProposal; turnId: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [partial, setPartial] = useState('')
  const liveContext = useRef(context)
  useEffect(() => { liveContext.current = context }, [context])
  const reload = async (): Promise<void> => {
    const data = await api['kanbanAssistant:get']({ projectId })
    setConversation(data.conversation); setMessages(data.messages); setEffective(data.effectiveLlm)
  }
  useEffect(() => {
    void reload()
  }, [projectId])
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
      for (const command of parsed.commands) void runCommand(command, event.message?.id)
    })
    const error = transport.onError((event) => { if (event.conversationId === conversation.id) { setBusy(false); setPartial(''); void reload() } })
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
    const idempotencyKey = crypto.randomUUID()
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
    } catch {
      setBusy(false)
    }
  }
  const visibleMessages = messages.map((message) => message.role === 'ai'
    ? { ...message, text: parseWidgetAssistantReply(message.text).text }
    : message)
  const aiLabel = effective?.provider === 'codex' ? 'Codex' : 'Claude'
  const assistantHeader = <div>
    <div className="kanban-assistant-context" data-testid="kanban-assistant-context">
      <span>{context.project?.name ?? 'Без проекта'}</span>
      <span>{context.selection?.openTask?.title ?? 'Доска'}</span>
      {context.selection?.selectedField && <span>{context.selection.selectedField}</span>}
    </div>
    {proposal && <WidgetProposalCard proposal={proposal.command} context={context} onConfirm={() => { const next = proposal; setProposal(null); void confirmProposal(next.command, next.turnId) }} onCancel={() => setProposal(null)} />}
    {conversation && effective && <details className="kanban-assistant-settings"><summary>LLM: {effective.provider} · {effective.model}{effective.inherited ? ' (из проекта)' : ''}</summary><div><label>Исполнитель<select value={conversation.llmEngineId ?? ''} onChange={(event) => void api['conversations:setExecTarget']({ id: conversation.id, execTarget: 'none', llmEngineId: event.target.value || null }).then(reload)}><option value="">Из проекта</option>{llmEngines.map((engine) => <option key={engine.id} value={engine.id}>{engine.name}</option>)}</select></label><label>Provider<select value={conversation.llmProvider ?? ''} onChange={(event) => { const provider = event.target.value as 'claude' | 'codex' | ''; void api['conversations:setExecTarget']({ id: conversation.id, execTarget: 'none', llmProvider: provider || null, llmModel: provider ? effective.model : null }).then(reload) }}><option value="">Из проекта</option><option value="claude">Claude</option><option value="codex">Codex</option></select></label><label>Модель<input value={conversation.llmModel ?? ''} disabled={!conversation.llmProvider} onChange={(event) => setConversation({ ...conversation, llmModel: event.target.value })} onBlur={() => void api['conversations:setExecTarget']({ id: conversation.id, execTarget: 'none', llmModel: conversation.llmModel }).then(reload)} /></label><button type="button" onClick={() => void api['conversations:setExecTarget']({ id: conversation.id, execTarget: 'none', llmEngineId: null, llmProvider: null, llmModel: null }).then(reload)}>Сбросить к проекту</button></div></details>}
  </div>
  return <div className="kanban-assistant">
    <ChatColumn
      title="Канбан-ассистент"
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
    />
  </div>
}
