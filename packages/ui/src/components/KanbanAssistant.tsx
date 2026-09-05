// Панель канбан-ассистента. Вёрстка и состояния повторяют живой Make-макет
// «Проект 14» (index.html): слева список чатов проекта, справа «оболочка чата» —
// шапка со знаком ассистента, статус-пилюля, приветственный экран с подсказками
// и композер, который после первого сообщения прижимается к низу. Функции
// прежней панели (контекст, предложения, планы работ, автопилот, настройки LLM)
// сохранены и разложены по местам макета, а не спрятаны.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { KanbanAssistantSelection, SupportedTaskPatch, WidgetAssistantCommand, WidgetAssistantContext, WidgetAssistantProposal, WidgetToolScope } from '@shared/widgetAssistant'
import { isWidgetAssistantProposal, parseWidgetAssistantReply, taskWidgetItem } from '@shared/widgetAssistant'
import type { Conversation, ConversationStatus, Message } from '@shared/types'
import type { Orchestration } from '@shared/orchestration'
import type { LlmEngineOption } from '@shared/admin'
import type { RendererApi } from '@shared/ipc'
import { browserId } from '@shared/browserId'
import { formatDate } from '../lib/dateFormat'
import { projectAssistantChatKey } from '../store/contracts'
import { WidgetProposalCard } from './WidgetAssistantFrame'
import { Markdown } from './Markdown'

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
  /** Есть обработчик — панель показывает список чатов проекта (боковую колонку макета). */
  onSelectConversation?: (conversationId: string) => void
  /** Закрыть панель; кнопка живёт в шапке макета, поэтому рамка свою не рисует. */
  onClose?: () => void
}

/** Точка выбора чата хранит источник отдельно от UI: новые виды виджетов не трогают список. */
export interface ProjectAssistantChat {
  id: string
  title: string
  source: string
  status: ConversationStatus | null
  updatedAt: number
  taskId: string | null
}

/** Значок шага плана: статус читается взглядом, без легенды. */
const PLAN_ITEM_MARKS: Record<string, string> = {
  pending: '·', running: '▸', done: '✓', failed: '✕', cancelled: '—'
}

const PLAN_STATUS_TITLES: Record<string, string> = {
  running: 'идёт', done: 'выполнен', failed: 'остановлен', cancelled: 'отменён'
}

/** Подсказки пустого экрана — из макета; клик подставляет текст в композер. */
const SUGGESTIONS: Array<{ tone: 'yellow' | 'red' | 'blue' | 'green'; icon: string; title: string; hint: string; prompt: string }> = [
  { tone: 'yellow', icon: '◇', title: 'Продумать функцию', hint: 'Собрать требования и план', prompt: 'Помоги спланировать новую функцию для продукта' },
  { tone: 'red', icon: '⌁', title: 'Исправить ошибку', hint: 'Разобраться в проблеме', prompt: 'Найди причину ошибки и предложи исправление' },
  { tone: 'blue', icon: '◎', title: 'Изучить проект', hint: 'Объяснить код и связи', prompt: 'Проанализируй проект и объясни, как он устроен' },
  { tone: 'green', icon: '✣', title: 'Создать интерфейс', hint: 'От идеи до готового экрана', prompt: 'Создай аккуратный интерфейс для новой страницы' }
]

const SOURCE_LABELS: Record<string, string> = { kanban: 'Ассистент доски', make: 'Make', chat: 'Без задачи', 'web-recorder': 'Веб-рекордер', 'playwright-reader': 'Web Reader', 'console-reader': 'Консоль' }

export function projectAssistantChatSource(conversation: Conversation): string {
  return conversation.assistantKind ?? 'chat'
}

/** Точка списка: «работает / в очереди / готов / завершён» — как у карточек макета. */
export function projectAssistantChatState(status: ConversationStatus | null | undefined): 'working' | 'waiting' | 'ready' | 'done' {
  if (status === 'developing') return 'working'
  if (status === 'planned' || status === 'planning_done') return 'waiting'
  if (status === 'done' || status === 'development_done') return 'done'
  return 'ready'
}

const CHAT_STATE_LABELS = { working: 'Работает', waiting: 'В очереди', ready: 'Готов', done: 'Завершён' } as const

/** «Только что · Вчера»: список чатов читается как лента, а не как таблица дат. */
export function relativeTime(at: number, now = Date.now()): string {
  const delta = Math.max(0, now - at)
  if (delta < 60_000) return 'Только что'
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} мин назад`
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} ч назад`
  if (delta < 172_800_000) return 'Вчера'
  return formatDate(at)
}

export interface ProjectAssistantChatSelectorProps {
  projectId: string
  api: RendererApi
  selectedId: string | null
  onSelect: (conversationId: string) => void
  /** Подпись «Проект · …» в шапке списка. */
  projectName?: string | null
  /** Закрыть выдвижной список (узкая панель). */
  onClose?: () => void
}

/** Боковая колонка макета: чаты проекта со статусом, поиском, созданием и удалением. */
export function ProjectAssistantChatSelector({ projectId, api, selectedId, onSelect, projectName, onClose }: ProjectAssistantChatSelectorProps): JSX.Element {
  const [chats, setChats] = useState<ProjectAssistantChat[]>([])
  const [query, setQuery] = useState('')
  const [showDone, setShowDone] = useState(false)

  const select = (id: string): void => {
    globalThis.localStorage?.setItem(projectAssistantChatKey(projectId), id)
    onSelect(id)
  }
  const toChat = (item: Conversation): ProjectAssistantChat => ({
    id: item.id, title: item.title, source: projectAssistantChatSource(item),
    status: item.status ?? null, updatedAt: item.updatedAt, taskId: item.taskId ?? null
  })
  useEffect(() => {
    let current = true
    void Promise.all([api['conversations:list']({ scope: 'kanban', projectId, includeCompleted: true }), api['kanbanAssistant:get']({ projectId })]).then(([items, assistant]) => {
      if (!current) return
      const projectChats = items
        .filter((item) => item.projectId === projectId)
        .concat(assistant.conversation)
        .filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index)
        .map(toChat)
      setChats(projectChats)
      const saved = globalThis.localStorage?.getItem(projectAssistantChatKey(projectId)) ?? null
      select(projectChats.some((chat) => chat.id === saved) ? saved! : assistant.conversation.id)
    })
    return () => { current = false }
  }, [api, projectId])

  const createChat = async (): Promise<void> => {
    const chat = await api['conversations:create']({ title: 'Новый разговор', scope: 'kanban', projectId })
    setChats((items) => [toChat(chat), ...items])
    select(chat.id)
    onClose?.()
  }
  const removeChat = async (chat: ProjectAssistantChat): Promise<void> => {
    await api['conversations:delete']({ id: chat.id })
    const rest = chats.filter((item) => item.id !== chat.id)
    setChats(rest)
    // Удалили текущий — переключаемся на чат ассистента, чтобы панель не осталась без разговора.
    if (chat.id === selectedId) {
      const fallback = rest.find((item) => item.source === 'kanban') ?? rest[0]
      if (fallback) select(fallback.id)
    }
  }

  const visible = chats
    .filter((chat) => showDone || projectAssistantChatState(chat.status) !== 'done')
    .filter((chat) => !query.trim() || chat.title.toLowerCase().includes(query.trim().toLowerCase()))
  const doneCount = chats.filter((chat) => projectAssistantChatState(chat.status) === 'done').length
  const count = visible.length
  const countLabel = count === 1 ? '1 чат' : count >= 2 && count <= 4 ? `${count} чата` : `${count} чатов`

  return <div className="ka-sidebar" data-testid="kanban-assistant-chats">
    <div className="ka-sidebar__head">
      <div>
        <span className="ka-eyebrow">Проект · {projectName ?? 'ChatAI'}</span>
        <h2>Чаты канбана</h2>
      </div>
      {onClose && <button type="button" className="ka-sidebar__close" aria-label="Закрыть список чатов" onClick={onClose}>×</button>}
    </div>
    <button type="button" className="ka-new-chat" onClick={() => { void createChat() }}><span aria-hidden="true">＋</span> Новый чат</button>
    <div className="ka-sidebar__tools">
      <label className="ka-search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4" /></svg>
        <input type="search" aria-label="Найти чат" placeholder="Найти чат" value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      <button type="button" className="ka-filter" aria-pressed={showDone} aria-label={showDone ? 'Скрыть завершённые чаты' : `Показать завершённые чаты${doneCount ? ` (${doneCount})` : ''}`} title={showDone ? 'Скрыть завершённые' : 'Показать завершённые'} onClick={() => setShowDone((value) => !value)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4" /></svg>
      </button>
    </div>
    <div className="ka-list-meta"><span>Недавние</span><span>{countLabel}</span></div>
    <nav className="ka-chat-list" aria-label="Чаты канбана">
      {visible.length === 0 && <p className="ka-chat-list__empty">{query.trim() ? 'Ничего не найдено' : 'Чатов пока нет'}</p>}
      {visible.map((chat) => {
        const state = projectAssistantChatState(chat.status)
        return <article key={chat.id} className={`ka-chat${chat.id === selectedId ? ' ka-chat--active' : ''}`} data-state={state}>
          <button type="button" className="ka-chat__open" aria-current={chat.id === selectedId ? 'true' : undefined} onClick={() => { select(chat.id); onClose?.() }}>
            <span className={`ka-dot ka-dot--${state}`} aria-hidden="true" />
            <span className="ka-chat__copy">
              <strong>{chat.title}</strong>
              <small>{state === 'working' ? <><span className="ka-working">Работает</span> · </> : `${relativeTime(chat.updatedAt)} · `}{SOURCE_LABELS[chat.source] ?? chat.source}</small>
            </span>
          </button>
          {chat.source !== 'kanban' && <button type="button" className="ka-chat__delete" aria-label={`Удалить ${chat.title}`} onClick={() => { void removeChat(chat) }}>×</button>}
        </article>
      })}
    </nav>
    <div className="ka-legend">
      <span><i className="ka-dot ka-dot--working" />{CHAT_STATE_LABELS.working}</span>
      <span><i className="ka-dot ka-dot--waiting" />{CHAT_STATE_LABELS.waiting}</span>
      <span><i className="ka-dot ka-dot--ready" />{CHAT_STATE_LABELS.ready}</span>
    </div>
  </div>
}

function AssistantMark({ className }: { className: string }): JSX.Element {
  return <span className={className} aria-hidden="true">
    <svg viewBox="0 0 24 24"><path d="M12 2.8l1.25 4.36a4.9 4.9 0 003.35 3.35L21 11.77l-4.4 1.26a4.9 4.9 0 00-3.35 3.35L12 20.8l-1.25-4.42a4.9 4.9 0 00-3.35-3.35L3 11.77l4.4-1.26a4.9 4.9 0 003.35-3.35L12 2.8z" /></svg>
  </span>
}

/** Адаптер-чат канбана. Контекст читается заново для каждого запроса: карточка, поле и действия не устаревают. */
export function KanbanAssistant({ projectId, context, api, llmEngines, transport = window.claude, onCommand, conversationId, onOpenTask, onSelectConversation, onClose }: KanbanAssistantProps): JSX.Element {
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
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [chatsOpen, setChatsOpen] = useState(false)
  // Завершённый план остаётся на виду до явного «Скрыть»: иначе результат
  // серии задач исчезает ровно в тот момент, когда он и стал интересен.
  const [hiddenPlans, setHiddenPlans] = useState<string[]>([])
  const liveContext = useRef(context)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
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
    const failed = transport.onError((event) => {
      if (event.conversationId !== conversation.id) return
      setBusy(false); setPartial(''); setError(event.message || 'Не удалось получить ответ ассистента')
    })
    return () => { done(); failed() }
  }, [transport, conversation?.id])
  // Лента прокручивается к последнему сообщению и к растущему ответу.
  useEffect(() => {
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [messages.length, partial])

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
  const visibleMessages = useMemo(() => messages.map((message) => message.role === 'ai'
    ? { ...message, text: parseWidgetAssistantReply(message.text).text }
    : message), [messages])
  const aiLabel = effective?.provider === 'codex' ? 'Codex' : 'Claude'
  const hasMessages = visibleMessages.length > 0 || busy
  const state = loading ? 'loading' : error ? 'error' : !transport ? 'unavailable' : busy ? 'streaming' : hasMessages ? 'active' : 'empty'
  const statusText = state === 'loading' ? 'Загружаем разговор…'
    : state === 'error' ? error
      : state === 'unavailable' ? 'Ассистент временно недоступен: транспорт не подключён.'
        : state === 'streaming' ? 'Готовит ответ…' : 'Готов к работе'
  const canType = !loading && Boolean(conversation)
  const projectName = context.project?.name ?? 'ChatAI'
  const autonomy = (conversation?.assistantAutonomy ?? 'auto') === 'auto'
  const setAutonomy = (checked: boolean): void => {
    if (!conversation) return
    const next = checked ? 'auto' : 'confirm'
    setConversation({ ...conversation, assistantAutonomy: next })
    void api['kanbanAssistant:setAutonomy']({ conversationId: conversation.id, autonomy: next }).then((updated) => setConversation(updated))
  }

  const composer: ReactNode = <form className={`ka-composer${hasMessages ? '' : ' ka-composer--centered'}`} onSubmit={(event) => { event.preventDefault(); void submit() }}>
    <textarea
      ref={inputRef}
      aria-label="Поле ввода сообщения"
      placeholder={hasMessages ? 'Сообщение…' : 'Напишите, что хотите сделать…'}
      value={draft}
      disabled={!canType}
      rows={hasMessages ? 1 : 3}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit() }
      }}
    />
    <div className="ka-composer__toolbar">
      <div className="ka-tool-group">
        {conversation && <label className="ka-autopilot" title={autonomy ? 'Ассистент применяет изменения сам' : 'Каждое изменение — с подтверждением'}>
          <input type="checkbox" checked={autonomy} onChange={(event) => setAutonomy(event.target.checked)} />
          <span>Автопилот</span>
          <small className="ka-autopilot__hint">{autonomy ? 'ассистент применяет изменения сам' : 'каждое изменение — с подтверждением'}</small>
        </label>}
        {effective && <button type="button" className="ka-model" aria-expanded={settingsOpen} aria-controls="ka-settings" onClick={() => setSettingsOpen((value) => !value)}>
          <span className="ka-model__dot" aria-hidden="true" />{aiLabel} <span aria-hidden="true">⌄</span>
        </button>}
      </div>
      <button type="submit" className="ka-send" aria-label="Отправить сообщение" disabled={!canType || busy || !draft.trim()}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
      </button>
    </div>
  </form>

  const inserts: ReactNode = <>
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
  </>

  return <div className={`kanban-assistant ka-layout${chatsOpen ? ' ka-layout--chats-open' : ''}${onSelectConversation ? ' ka-layout--with-chats' : ''}`} data-state={state}>
    {onSelectConversation && <>
      <aside className="ka-sidebar-slot" aria-label="Список чатов">
        <ProjectAssistantChatSelector projectId={projectId} api={api} selectedId={conversationId ?? conversation?.id ?? null} onSelect={onSelectConversation} projectName={projectName} onClose={() => setChatsOpen(false)} />
      </aside>
      <div className="ka-backdrop" onClick={() => setChatsOpen(false)} />
    </>}
    <div className={`ka-shell${hasMessages ? ' ka-shell--has-messages' : ''}`}>
      <header className="ka-header">
        {onSelectConversation && <button type="button" className="ka-icon-button ka-chats-button" aria-label="Открыть канбан-чаты" aria-expanded={chatsOpen} onClick={() => setChatsOpen(true)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
        </button>}
        <div className="ka-title-block">
          <AssistantMark className="ka-mark" />
          <div className="ka-title-copy">
            <div className="ka-eyebrow">{projectName}</div>
            <h1>{conversation?.title ?? (loading ? 'Загружаем…' : 'Новый разговор')}</h1>
          </div>
        </div>
        <div className="ka-header__actions">
          <div className="kanban-assistant-status ka-status" data-state={state} role={state === 'error' || state === 'unavailable' ? 'alert' : 'status'}>
            {state === 'loading' ? <span className="kanban-assistant-spinner" aria-hidden="true" /> : <span className="ka-status__dot" aria-hidden="true" />}
            <span>{statusText}</span>
            {state === 'error' && <button type="button" onClick={() => { setLoading(true); void reload() }}>Повторить</button>}
          </div>
          {conversation && effective && <button type="button" className="ka-icon-button" aria-label="Настройки ассистента" aria-expanded={settingsOpen} aria-controls="ka-settings" onClick={() => setSettingsOpen((value) => !value)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.2a3.8 3.8 0 100 7.6 3.8 3.8 0 000-7.6zm8 4.72v-1.84l-2.15-.75a6.3 6.3 0 00-.53-1.27l1-2.05-1.3-1.3-2.05 1a6.3 6.3 0 00-1.27-.53L12.92 4h-1.84l-.75 2.18a6.3 6.3 0 00-1.27.53l-2.05-1-1.3 1.3 1 2.05a6.3 6.3 0 00-.53 1.27L4 11.08v1.84l2.18.75c.13.45.31.87.53 1.27l-1 2.05 1.3 1.3 2.05-1c.4.22.82.4 1.27.53l.75 2.18h1.84l.75-2.18c.45-.13.87-.31 1.27-.53l2.05 1 1.3-1.3-1-2.05c.22-.4.4-.82.53-1.27L20 12.92z" /></svg>
          </button>}
          {onClose && <button type="button" className="ka-icon-button ka-close" aria-label="Закрыть ассистента" onClick={onClose}>×</button>}
        </div>
      </header>
      <div className="kanban-assistant-context ka-context" data-testid="kanban-assistant-context">
        <span>{context.project?.name ?? 'Без проекта'}</span>
        <span>{context.selection?.openTask?.title ?? 'Доска'}</span>
        {context.selection?.selectedField && <span>{context.selection.selectedField}</span>}
      </div>
      {settingsOpen && conversation && effective && <section id="ka-settings" className="kanban-assistant-settings ka-settings" aria-label="Настройки ассистента">
        <div className="ka-settings__title">LLM: {effective.provider} · {effective.model}{effective.inherited ? ' (из проекта)' : ''}</div>
        <div className="ka-settings__grid">
          <label>Исполнитель<select value={conversation.llmEngineId ?? ''} onChange={(event) => void api['conversations:setExecTarget']({ id: conversation.id, execTarget: 'none', llmEngineId: event.target.value || null }).then(reload)}><option value="">Из проекта</option>{llmEngines.map((engine) => <option key={engine.id} value={engine.id}>{engine.name}</option>)}</select></label>
          <label>Provider<select value={conversation.llmProvider ?? ''} onChange={(event) => { const provider = event.target.value as 'claude' | 'codex' | ''; void api['conversations:setExecTarget']({ id: conversation.id, execTarget: 'none', llmProvider: provider || null, llmModel: provider ? effective.model : null }).then(reload) }}><option value="">Из проекта</option><option value="claude">Claude</option><option value="codex">Codex</option></select></label>
          <label>Модель<input value={conversation.llmModel ?? ''} disabled={!conversation.llmProvider} onChange={(event) => setConversation({ ...conversation, llmModel: event.target.value })} onBlur={() => void api['conversations:setExecTarget']({ id: conversation.id, execTarget: 'none', llmModel: conversation.llmModel }).then(reload)} /></label>
          <button type="button" onClick={() => void api['conversations:setExecTarget']({ id: conversation.id, execTarget: 'none', llmEngineId: null, llmProvider: null, llmModel: null }).then(reload)}>Сбросить к проекту</button>
        </div>
      </section>}
      <section className="ka-conversation" aria-label="Диалог с ассистентом">
        {!hasMessages && <div className="ka-empty">
          <div className="ka-inserts">{inserts}</div>
          <div className="ka-welcome">
            <span className="ka-welcome__icon" aria-hidden="true">✦</span>
            <h2>С чего начнём?</h2>
            <p>Опишите задачу своими словами. Ассистент поможет разобраться, спланировать и довести работу до результата.</p>
          </div>
          {composer}
          <div className="ka-suggestions" aria-label="Примеры задач">
            {SUGGESTIONS.map((item) => <button key={item.title} type="button" className="ka-suggestion" disabled={!canType} onClick={() => { setDraft(item.prompt); inputRef.current?.focus() }}>
              <span className={`ka-suggestion__icon ka-suggestion__icon--${item.tone}`} aria-hidden="true">{item.icon}</span>
              <span><strong>{item.title}</strong><small>{item.hint}</small></span>
              <span className="ka-suggestion__arrow" aria-hidden="true">→</span>
            </button>)}
          </div>
          <p className="ka-hint">Enter — отправить · Shift + Enter — новая строка</p>
        </div>}
        {hasMessages && <>
          <div className="ka-messages" ref={listRef} aria-live="polite">
            <div className="ka-inserts">{inserts}</div>
            {visibleMessages.map((message) => message.role === 'ai'
              ? <div key={message.id} className="ka-message ka-message--assistant"><AssistantMark className="ka-mini-mark" /><div className="ka-message__copy"><Markdown>{message.text}</Markdown></div></div>
              : <div key={message.id} className="ka-message ka-message--user"><div className="ka-bubble">{message.text}</div></div>)}
            {busy && <div className="ka-message ka-message--assistant" data-testid="kanban-assistant-streaming"><AssistantMark className="ka-mini-mark" /><div className="ka-message__copy">
              {partial ? <Markdown>{partial}</Markdown> : null}
              <span className="ka-typing" aria-label="Ассистент печатает"><i /><i /><i /></span>
            </div></div>}
          </div>
          <div className="ka-dock">{composer}</div>
        </>}
      </section>
    </div>
  </div>
}
