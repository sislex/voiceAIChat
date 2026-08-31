import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { ClaudeLogEntry, Message, PermissionMode, TurnMeta, TurnUsage, VoiceState } from '@shared/types'
import type { ChatStorageView, WorkspaceView } from '@shared/projects'
import { ChatStorageCard } from './ChatStorageCard'
import { MachineHealthBadge, MachineHealthWarnings } from './MachineHealthBadge'
import { parseQuestions } from '@shared/questions'
import { parseToolBlock } from '@shared/tools'
import { parseImages, isImagePath } from '@shared/images'
import type { ServerFileInfo, TurnTarget } from '@shared/protocol'
import type { AgentInfo } from '@shared/agentProtocol'
import { MachineUtility } from './MachineUtility'
import { MessageImage } from './MessageImage'
import type { ConsoleHistoryStore, MachineOps, SwitchUtility } from './machine'
import {
  chipClass,
  engineLabel,
  formatTurnMeta,
  clockTime,
  dateTimeTooltip,
  formatElapsed,
  speakerName,
  type LiveSegment
} from '../lib/view'
import { Dots } from './animations'
import { QuestionsForm } from './QuestionsForm'
import { Button } from '@voicechat/ui-kit'
import { Skeleton, RefreshIndicator } from '@voicechat/ui-kit'
import { IconButton } from '@voicechat/ui-kit'
import { SidebarToggle } from './ui/IconButton'
import { MessageMeta } from './MessageMeta'
import {
  MessageTimeline,
  TIMELINE_MODES,
  TIMELINE_MODE_LABEL,
  type TimelineMode
} from './MessageTimeline'
import { copyText } from '../lib/clipboard'
import { useAutoGrow } from '../lib/autoGrow'
import { useDismissibleMenu } from '../lib/useDismissibleMenu'

/** Сколько держим подсветку сообщения, к которому перешли из поиска. */
const HIGHLIGHT_MS = 2000
/** Пользователь остаётся «у конца», пока отступ не превысил этот допуск. */
const BOTTOM_THRESHOLD_PX = 100
const SCROLL_STORAGE_KEY = 'voicechat:chat-scroll:v1'
const DEFAULT_CONVERSATION_KEY = '__default__'

type SavedScroll = { scrollTop: number; autoFollow: boolean }

function readSavedScrolls(): Record<string, SavedScroll> {
  try {
    const value = sessionStorage.getItem(SCROLL_STORAGE_KEY)
    return value ? JSON.parse(value) as Record<string, SavedScroll> : {}
  } catch {
    return {}
  }
}

function writeSavedScroll(conversationId: string, value: SavedScroll): void {
  try {
    const saved = readSavedScrolls()
    saved[conversationId] = value
    sessionStorage.setItem(SCROLL_STORAGE_KEY, JSON.stringify(saved))
  } catch {
    // Хранилище может быть запрещено политикой браузера — прокрутка всё равно работает в текущем DOM.
  }
}

const EDIT_MIN_ROWS = 2
const EDIT_MAX_ROWS = 4

function modeLabel(mode?: string): string {
  if (mode === 'plan') return 'Планирование'
  if (mode === 'acceptEdits') return 'Разработка'
  if (mode === 'bypassPermissions') return 'Полный доступ'
  return 'Режим не записан'
}

export interface ChatColumnProps {
  title: string
  /** Id нужен для независимого восстановления ручной позиции каждого разговора. */
  conversationId?: string | null
  /** Переименовать текущий разговор (клик по заголовку в шапке). */
  onRenameTitle?: (title: string) => void
  /** Показать/скрыть общий Sidebar. */
  onToggleSidebar?: () => void
  /** Фактическое состояние Sidebar для aria-expanded. */
  sidebarExpanded?: boolean
  /** Открыть отдельную страницу настроек текущего разговора. */
  onOpenConversationSettings?: () => void
  /** Фактический режим активного разговора для бейджа в шапке. */
  permissionMode?: PermissionMode
  /** Сколько источников контекста выключено в этом разговоре (бейдж в шапке). */
  disabledContextCount?: number
  /** Открыть настройки сразу на вкладке «Контекст и инструкции». */
  onOpenContextSettings?: () => void
  /** Фактический managed workspace, вычисленный сервером. */
  workspace?: WorkspaceView | null
  /** Каталог результатов чата (привязка к хранилищу машины) — чип в шапке. */
  storage?: ChatStorageView | null
  /** Выполнить сохранённую команду (навык) машины хода: открывает консоль и запускает её. */
  onRunSkill?: (agentId: string, command: string) => void
  /** Выполнить исходный запрос планового ответа в режиме разработки. */
  onExecutePlan?: (answerId: string) => void
  /** Make: откатить правки этого ответа к снимку «До правок» (meta.makeSnapshotId). */
  onMakeRestore?: (snapshotId: string) => void
  /** Разрешено ли эскалировать план (user без машины — нет). */
  canExecutePlan?: boolean
  state: VoiceState
  messages: Message[]
  /** Идёт загрузка сообщений разговора — показываем лоадер вместо ленты. */
  loadingMessages?: boolean
  /**
   * Сообщение, к которому надо прокрутить ленту и подсветить его (переход из
   * результатов поиска). Подсветка гаснет сама — через `onHighlightDone`.
   */
  highlightMessageId?: string | null
  /** Подсветка отработала: стор гасит `highlightMessageId`. */
  onHighlightDone?: () => void
  liveSegments: LiveSegment[]
  diarization: boolean
  /** Зарезервировать место ответа до первого непустого фрагмента. */
  preparingReply?: boolean
  /** Стримящийся ответ Claude (растёт по токенам); пусто — нет активного стрима. */
  streamingReply?: string
  /** Активность текущего (незавершённого) хода — для живого статуса/секций. */
  liveActivity?: ClaudeLogEntry[]
  /** Живые счётчики токенов текущего хода — счётчик под стрим-сообщением. */
  liveUsage?: TurnUsage | null
  /**
   * Раскладка композера. По умолчанию — «по центру» у пустой ленты и «внизу» у беседы;
   * split-режимы (Reader/Консоль/Make) всегда рисуют VoiceBar внизу — иначе у пустого
   * проекта обёртка `--centered` (height 0) уносит докнутый композер за край экрана.
   */
  composerLayout?: 'centered' | 'docked'
  /** Движок/модель/машина идущего хода (claude.start); null — сервер ещё не сообщил. */
  liveTarget?: TurnTarget | null
  /** Текст ошибки для баннера (null/undefined — нет баннера). */
  error?: string | null
  /** Закрыть баннер ошибки. */
  onDismissError?: () => void
  /** Доступна ли озвучка (кнопка ▶ на ответах). */
  canSpeak?: boolean
  /** id сообщения, которое сейчас озвучивается (для иконки ⏹). */
  speakingMessageId?: string | null
  /** Озвучить/остановить сообщение по кнопке. */
  onSpeakMessage?: (id: string, text: string) => void
  /** Удалить сообщение из истории. */
  onDeleteMessage?: (id: string) => void
  /** Исправить сообщение пользователя и перегенерировать ответ. */
  onEditMessage?: (id: string, text: string) => void
  /** Отсутствует ли локальная модель Whisper (показать баннер первого запуска). */
  modelMissing?: boolean
  /** Название модели для баннера. */
  modelLabel?: string
  /** Идёт ли скачивание модели. */
  downloading?: boolean
  /** Прогресс скачивания (0–100). */
  downloadPercent?: number
  /** Запустить скачивание модели. */
  onDownloadModel?: () => void
  /** Экспортировать текущий разговор (Markdown/JSON). */
  onExport?: (format: 'md' | 'json') => void
  /** Мета последнего хода (длительность/токены/стоимость); null — не показывать. */
  turnMeta?: TurnMeta | null
  /** Голосовая панель, рендерится внизу колонки (как в прототипе). */
  voiceBar: ReactNode
  /** Машины-агенты для выбора цели выполнения команд (пусто — селектор скрыт). */
  agents?: AgentInfo[]
  /** Текущая цель выполнения активного чата. */
  execTarget?: string | null
  /** Сменить цель только активного чата из селектора рядом с заголовком. */
  onChangeExecTarget?: (target: string | null) => void
  /** Имя движка для подписи ответов и статуса (Claude/Codex). */
  aiLabel?: string
  /** Отправить собранные ответы на вопросы модели (форма под последним ответом). */
  onAnswerQuestions?: (text: string) => void
  /** Открыть предложение создать задачу, сохранённое в метаданных ответа. */
  /**
   * Ответ на вопрос CI-рана, продублированный в этот чат: уходит в ран, а не
   * запускает новый ход чата (сообщение помечено `meta.ciInteraction`).
   */
  onAnswerCiInteraction?: (runId: string, interactionId: string, text: string) => void
  /** Id пауз рана, на которые уже ответили (форма гаснет, остаётся статика). */
  answeredCiInteractions?: string[]
  /** Шапка чата задачи (контекст канбана + лента рана); рендерится снаружи. */
  taskHeader?: JSX.Element | null
  /** Операции над машиной для встроенных утилит; отсутствуют → виджеты не рендерятся. */
  machineOps?: MachineOps
  /** Память команд консоли по машине (стор) — одна на приложение, см. `machine.ts`. */
  consoleHistory?: ConsoleHistoryStore
  /** Чтение файла с диска сервера — картинки, созданные самим CLI. */
  readServerFile?: (path: string) => Promise<ServerFileInfo | null>
  /** Открыть файл картинки в проводнике нужной машины. */
  onOpenImageInExplorer?: (agentId: string, path: string) => void
  /** Переключить встроенную утилиту сообщения (консоль ↔ проводник) — шапка утилиты. */
  onSwitchUtility?: SwitchUtility
  /** Открыть раздел «Машины» из шапки встроенной утилиты. */
  onOpenMachines?: () => void
  /** Открыть раздел БЗ из «Подробнее» ответа (чипсы «База знаний»). */
  onOpenKbDocument?: (documentId: string, anchor: string) => void
}

export function ChatColumn({
  title,
  conversationId,
  onRenameTitle,
  onToggleSidebar,
  sidebarExpanded = true,
  onOpenConversationSettings,
  permissionMode = 'plan',
  disabledContextCount = 0,
  onOpenContextSettings,
  workspace = null,
  storage = null,
  onRunSkill,
  onExecutePlan,
  onMakeRestore,
  canExecutePlan = true,
  state,
  messages,
  loadingMessages = false,
  highlightMessageId = null,
  onHighlightDone,
  liveSegments,
  diarization,
  preparingReply,
  streamingReply = '',
  liveActivity = [],
  canSpeak = false,
  speakingMessageId = null,
  onSpeakMessage,
  onDeleteMessage,
  onEditMessage,
  error,
  onDismissError,
  modelMissing = false,
  modelLabel = '',
  downloading = false,
  downloadPercent = 0,
  onDownloadModel,
  onExport,
  turnMeta,
  voiceBar,
  agents = [],
  execTarget = null,
  onChangeExecTarget,
  aiLabel = 'Claude',
  liveTarget = null,
  composerLayout,
  onAnswerQuestions,
  onAnswerCiInteraction,
  answeredCiInteractions,
  taskHeader,
  machineOps,
  consoleHistory,
  readServerFile,
  onOpenImageInExplorer,
  onSwitchUtility,
  onOpenMachines,
  onOpenKbDocument
}: ChatColumnProps): JSX.Element {
  const [exportOpen, setExportOpen] = useState(false)
  const exportMenuRef = useRef<HTMLSpanElement>(null)
  useDismissibleMenu(exportOpen, exportMenuRef, () => setExportOpen(false))
  const scrollRef = useRef<HTMLDivElement>(null)
  const conversationKey = conversationId ?? DEFAULT_CONVERSATION_KEY
  const activeConversationRef = useRef(conversationKey)
  const autoFollowRef = useRef(true)
  const programmaticScrollRef = useRef(false)
  const lastScrollHeightRef = useRef(0)
  const lastMessageIdRef = useRef<string | null>(null)
  const [hasNewContent, setHasNewContent] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  // Поле редактирования — как композер: от двух строк до четырёх, дальше скролл.
  // Хук один на колонку: редактируется всегда не больше одного сообщения.
  const editRef = useAutoGrow(editDraft, EDIT_MIN_ROWS, EDIT_MAX_ROWS)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [titleEditing, setTitleEditing] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  // Режим отображения хода по каждому сообщению (дефолт — minimal) и отдельный
  // режим для живого (стримящегося) хода (дефолт — brief).
  const [modeById, setModeById] = useState<Map<string, TimelineMode>>(new Map())
  const [liveMode, setLiveMode] = useState<TimelineMode>('brief')

  const modeOf = (id: string): TimelineMode => modeById.get(id) ?? 'minimal'
  const setModeFor = (id: string, mode: TimelineMode): void =>
    setModeById((prev) => { const next = new Map(prev); next.set(id, mode); return next })

  // Живой таймер ответа: момент старта фиксируем при появлении стрима, значение
  // «сколько уже отвечает» обновляем раз в секунду (эффект — ниже, после hasStream).
  const streamStartRef = useRef<number | null>(null)
  // Момент, когда карточка ответа появилась (ещё до первого фрагмента) — для
  // времени в шапке карточки «Готовим ответ…».
  const prepStartRef = useRef<number | null>(null)

  // Шапка живого ответа: пока ход идёт, движок/модель/машину сообщает сервер
  // (claude.start) — он один знает наследование от проекта. Без сообщения —
  // догадка клиента (aiLabel/execTarget разговора), как раньше.
  const liveHead = (): { engine: 'claude' | 'codex'; label: string; model: string | undefined; machineLabel: string } => {
    const engine: 'claude' | 'codex' = liveTarget?.provider ?? (aiLabel === 'Codex' ? 'codex' : 'claude')
    const target = liveTarget ? liveTarget.execTarget : execTarget
    return {
      engine,
      label: engine === 'codex' ? 'Codex' : 'Claude',
      model: liveTarget?.model || undefined,
      machineLabel: target === 'none' ? 'Без машины' : target ? (agents.find((a) => a.id === target)?.name ?? target) : 'Сервер'
    }
  }
  const [liveNow, setLiveNow] = useState<number>(() => Date.now())

  const startTitleEdit = (): void => {
    if (!onRenameTitle) return
    setTitleDraft(title)
    setTitleEditing(true)
  }
  const commitTitleEdit = (): void => {
    if (onRenameTitle && titleDraft.trim()) onRenameTitle(titleDraft.trim())
    setTitleEditing(false)
    setTitleDraft('')
  }
  const cancelTitleEdit = (): void => {
    setTitleEditing(false)
    setTitleDraft('')
  }

  const copyMessage = (m: Message): void => {
    void copyText(m.text).then((copied) => {
      if (!copied) return
      setCopiedId(m.id)
      setTimeout(() => setCopiedId((id) => (id === m.id ? null : id)), 1500)
    }).catch(() => {
      // Clipboard permissions and browser support are outside the chat's control.
    })
  }

  // Пользовательский вопрос можно исправить и во время ответа: store сначала
  // адресно остановит текущий CLI-ход, затем отправит новую формулировку.
  const canEdit = state !== 'listening' && state !== 'transcribing'
  const startEdit = (m: Message): void => {
    setEditingId(m.id)
    setEditDraft(m.text)
  }
  const cancelEdit = (): void => {
    setEditingId(null)
    setEditDraft('')
  }
  const saveEdit = (): void => {
    if (editingId && editDraft.trim() && onEditMessage) onEditMessage(editingId, editDraft)
    cancelEdit()
  }

  const persistScroll = useCallback((el: HTMLDivElement): void => {
    writeSavedScroll(activeConversationRef.current, {
      scrollTop: el.scrollTop,
      autoFollow: autoFollowRef.current
    })
  }, [])

  const scrollToBottom = useCallback((restoreFollow = true): void => {
    const el = scrollRef.current
    if (!el) return
    programmaticScrollRef.current = true
    el.scrollTop = el.scrollHeight
    lastScrollHeightRef.current = el.scrollHeight
    if (restoreFollow) autoFollowRef.current = true
    setHasNewContent(false)
    persistScroll(el)
    requestAnimationFrame(() => { programmaticScrollRef.current = false })
  }, [persistScroll])

  const markManualScrollIntent = useCallback((): void => {
    programmaticScrollRef.current = false
  }, [])

  const onScroll = useCallback((): void => {
    const el = scrollRef.current
    if (!el || programmaticScrollRef.current) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    const atBottom = distance <= BOTTOM_THRESHOLD_PX
    autoFollowRef.current = atBottom
    if (atBottom) setHasNewContent(false)
    persistScroll(el)
  }, [persistScroll])

  // Смена разговора восстанавливает именно его ручную позицию. Для нового чата
  // исходное состояние — конец ленты; sessionStorage переживает reload/reconnect.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    activeConversationRef.current = conversationKey
    const saved = readSavedScrolls()[conversationKey]
    autoFollowRef.current = saved?.autoFollow ?? true
    setHasNewContent(false)
    programmaticScrollRef.current = true
    el.scrollTop = saved && !saved.autoFollow ? saved.scrollTop : el.scrollHeight
    lastScrollHeightRef.current = el.scrollHeight
    lastMessageIdRef.current = messages[messages.length - 1]?.id ?? null
    requestAnimationFrame(() => { programmaticScrollRef.current = false })
  }, [conversationKey])

  // Новое собственное сообщение начинает новый ход и всегда возвращает follow.
  // В остальных случаях токены двигают ленту только если пользователь был у конца.
  useEffect(() => {
    const last = messages[messages.length - 1]
    const ownMessageAdded = Boolean(last && last.role !== 'ai' && last.id !== lastMessageIdRef.current)
    lastMessageIdRef.current = last?.id ?? null
    if (ownMessageAdded) {
      scrollToBottom()
    } else if (autoFollowRef.current) {
      scrollToBottom(false)
    } else {
      setHasNewContent(true)
    }
  }, [messages, liveSegments, state, streamingReply, scrollToBottom])

  // Markdown, подсветка кода, изображения и раскрываемые блоки меняют высоту уже
  // после рендера. ResizeObserver следует за ними только в follow-режиме.
  useEffect(() => {
    const el = scrollRef.current
    const content = el?.firstElementChild
    if (!el || !content || typeof ResizeObserver !== 'function') return
    const observer = new ResizeObserver(() => {
      const grew = el.scrollHeight > lastScrollHeightRef.current
      lastScrollHeightRef.current = el.scrollHeight
      if (!grew) return
      if (autoFollowRef.current) scrollToBottom(false)
      else setHasNewContent(true)
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [conversationKey, scrollToBottom])

  // Изменение окна и экранной клавиатуры не должно сбрасывать ручное чтение.
  useEffect(() => {
    const followViewport = (): void => {
      if (autoFollowRef.current) scrollToBottom(false)
    }
    window.addEventListener('resize', followViewport)
    window.visualViewport?.addEventListener('resize', followViewport)
    return () => {
      window.removeEventListener('resize', followViewport)
      window.visualViewport?.removeEventListener('resize', followViewport)
    }
  }, [scrollToBottom])

  // Переход из поиска: прокручиваем к найденному сообщению и держим подсветку
  // HIGHLIGHT_MS. Эффект стоит после автоскролла вниз — иначе тот перебил бы
  // прокрутку. Сообщения могут ещё грузиться: пока элемента нет, ждём рендера.
  useEffect(() => {
    if (!highlightMessageId) return
    const el = scrollRef.current?.querySelector(`[data-mid="${highlightMessageId}"]`)
    if (!el) return
    // jsdom не умеет scrollIntoView — в тестах просто нет прокрутки.
    el.scrollIntoView?.({ block: 'center' })
    const timer = setTimeout(() => onHighlightDone?.(), HIGHLIGHT_MS)
    return () => clearTimeout(timer)
  }, [highlightMessageId, messages, onHighlightDone])

  const isListening = state === 'listening'
  const hasStream = streamingReply.length > 0
  const showPreparingReply = (preparingReply ?? state === 'thinking') && !hasStream
  // Картинки в ещё не завершённом ответе: блок вырезаем сразу, чтобы вместо
  // сырого JSON пользователь видел саму картинку, как только файл готов.
  const liveImages = parseImages(streamingReply)

  // Стриминг для скринридера. Сам ответ живой областью не делаем: он растёт по
  // токенам, и читалка перебивала бы сама себя на каждом слове. Объявляем два
  // события — «пошёл ответ» и «ответ получен»; текст доступен обычным чтением
  // ленты, когда пользователь до него дойдёт.
  const [replyAnnounce, setReplyAnnounce] = useState('')
  useEffect(() => {
    if (hasStream) setReplyAnnounce(`${aiLabel} отвечает…`)
    else setReplyAnnounce((prev) => (prev === '' ? '' : 'Ответ получен'))
  }, [hasStream, aiLabel])
  useEffect(() => {
    if (!hasStream) { streamStartRef.current = null; return }
    if (streamStartRef.current === null) streamStartRef.current = Date.now()
    setLiveNow(Date.now())
    const timer = window.setInterval(() => setLiveNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [hasStream])
  // Фиксируем момент появления карточки ожидания и сбрасываем, когда ответа уже нет.
  useEffect(() => {
    if (showPreparingReply && prepStartRef.current === null) prepStartRef.current = Date.now()
    if (!showPreparingReply && !hasStream) prepStartRef.current = null
  }, [showPreparingReply, hasStream])

  return (
    <main className={messages.length === 0 ? 'main main--empty' : 'main main--conversation'} data-chat-layout={composerLayout ?? (messages.length === 0 ? 'centered' : 'docked')}>
      <header className="mhead">
        {onToggleSidebar && (
          <SidebarToggle className="burger" expanded={sidebarExpanded} onToggle={onToggleSidebar} />
        )}
        {titleEditing ? (
          <input
            className="mtitle-edit"
            value={titleDraft}
            autoFocus
            aria-label="Новое название разговора"
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitTitleEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commitTitleEdit()
              } else if (e.key === 'Escape') {
                cancelTitleEdit()
              }
            }}
          />
        ) : (
          <h1
            className={onRenameTitle ? 'mtitle mtitle--editable' : 'mtitle'}
            title={onRenameTitle ? 'Переименовать разговор' : undefined}
            onClick={startTitleEdit}
          >
            {title}
          </h1>
        )}
        {execTarget && execTarget !== 'none'
          ? <MachineHealthBadge agent={agents.find((a) => a.id === execTarget)} onClick={onOpenMachines} />
          : <span className="mtitle-machine" data-testid="head-machine" title="Машина этого разговора">{execTarget === 'none' ? 'Без машины' : 'Сервер'}</span>}
        <ChatStorageCard compact storage={storage} onOpenExplorer={onOpenImageInExplorer} />
        {onRunSkill && execTarget && execTarget !== 'none' && (() => {
          const machine = agents.find((a) => a.id === execTarget)
          if (!machine || !machine.online || machine.policy.skills.length === 0) return null
          return (
            <select
              className="chat-skills"
              aria-label="Навыки машины"
              title="Сохранённые команды машины: выбор открывает консоль и выполняет команду"
              value=""
              onChange={(e) => { const skill = machine.policy.skills.find((s) => s.name === e.target.value); if (skill) onRunSkill(machine.id, skill.command) }}
            >
              <option value="">⚡ Навыки</option>
              {machine.policy.skills.map((s) => <option key={s.name} value={s.name} title={s.command}>{s.name}</option>)}
            </select>
          )
        })()}
        {workspace && (
          <span
            className={`mode-badge workspace-badge workspace-badge--${workspace.state}`}
            data-testid="workspace-badge"
            aria-label={`Workspace: ${workspace.mode}; состояние: ${workspace.state}`}
            title={[workspace.path, workspace.branch, workspace.baseSha, workspace.diagnostic].filter(Boolean).join('\n')}
          >
            {workspace.mode === 'shared_main' ? 'Общий main' : workspace.mode === 'chat_workspace' ? 'Workspace чата' : workspace.mode === 'task_workspace' ? 'Workspace задачи' : 'Legacy cwd'}
            {workspace.baseSha ? ` · ${workspace.baseSha.slice(0, 8)}` : ''}
            {workspace.state !== 'ready' ? ` · ${workspace.state}` : ''}
          </span>
        )}
        <button
          className={`mode-badge mode-badge--${permissionMode}`}
          data-testid="mode-badge"
          onClick={onOpenConversationSettings}
          disabled={!onOpenConversationSettings}
          title="Открыть настройки режима разговора"
        >
          {modeLabel(permissionMode)}
        </button>
        {/* Выключенные источники контекста меняют то, что получает модель, но
            узнать об этом можно было только зайдя в настройки. Бейдж делает факт
            видимым там же, где режим доступа, и ведёт на нужную вкладку. */}
        {disabledContextCount > 0 && (
          <button
            className="mode-badge mode-badge--context"
            data-testid="context-badge"
            onClick={onOpenContextSettings ?? onOpenConversationSettings}
            disabled={!(onOpenContextSettings ?? onOpenConversationSettings)}
            title="Часть источников контекста выключена для этого разговора — открыть «Контекст и инструкции»"
          >
            Контекст изменён · {disabledContextCount}
          </button>
        )}
        {onOpenConversationSettings && (
          <button className="convsettings-open" aria-label="Настройки разговора" title="Настройки разговора" onClick={onOpenConversationSettings}>⚙</button>
        )}
        {onChangeExecTarget && (
          <label className="exectarget" title="Машина для новых сообщений этого чата">
            <span className={`exectarget-dot ${execTarget === 'none' ? 'disabled' : execTarget ? 'remote' : 'server'}`} aria-hidden />
            <select className="exectarget-sel" aria-label="Машина активного чата" value={execTarget ?? ''} disabled={state !== 'idle'} onChange={(e) => onChangeExecTarget(e.target.value || null)}>
              <option value="">Сервер</option><option value="none">Без машины</option>
              {agents.map((a) => <option key={a.id} value={a.id} disabled={!a.online}>{a.name}{a.online ? '' : ' (офлайн)'}</option>)}
            </select>
          </label>
        )}
        <span className="mhead-right">
          {onExport && messages.length > 0 && (
            <span className="exportwrap" ref={exportMenuRef}>
              <IconButton
                size="sm"
                variant="secondary"
                aria-label="Экспорт разговора"
                title="Экспорт разговора"
                aria-expanded={exportOpen}
                onClick={() => setExportOpen((v) => !v)}
              >
                ⇩
              </IconButton>
              {exportOpen && (
                <span className="exportmenu" data-testid="export-menu">
                  <button
                    onClick={() => {
                      onExport('md')
                      setExportOpen(false)
                    }}
                  >
                    Markdown (.md)
                  </button>
                  <button
                    onClick={() => {
                      onExport('json')
                      setExportOpen(false)
                    }}
                  >
                    JSON (.json)
                  </button>
                </span>
              )}
            </span>
          )}
        </span>
      </header>

      {taskHeader}

      {error && (
        <div className={error.startsWith('Предупреждение:') ? 'errbar warnbar' : 'errbar'} role="alert" data-testid="error-bar">
          <span>{error}</span>
          <button className="errclose" aria-label="Закрыть ошибку" title="Закрыть ошибку" onClick={onDismissError}>
            ✕
          </button>
        </div>
      )}

      {modelMissing && (
        <div className="modelbar" data-testid="model-bar">
          <span>
            Модель распознавания{modelLabel ? ` (${modelLabel})` : ''} не найдена. Скачайте её для
            работы голосового ввода.
          </span>
          {downloading ? (
            <span className="modelprog" data-testid="model-progress">
              Скачивание… {downloadPercent}%
            </span>
          ) : (
            <button className="modeldl" onClick={onDownloadModel}>
              Скачать
            </button>
          )}
        </div>
      )}

      <p className="vc-sr-only" role="status" aria-live="polite" data-testid="reply-announce">
        {replyAnnounce}
      </p>

      <div
        className="scroll"
        ref={scrollRef}
        data-testid="scroll"
        tabIndex={0}
        onScroll={onScroll}
        onWheel={markManualScrollIntent}
        onTouchMove={markManualScrollIntent}
        onPointerDown={markManualScrollIntent}
        onKeyDown={markManualScrollIntent}
      >
        <div className="col-c">
          {/* Первая загрузка ленты — скелетон реплик той же геометрии, что у
              сообщений (свои слева, ответы модели шире справа). Повторная
              загрузка уже показанной истории её не подменяет: иначе лента
              мигает на каждом обновлении. */}
          {loadingMessages && messages.length === 0 && (
            <div className="msgskel" data-testid="messages-loading" aria-busy="true">
              <Skeleton variant="card" className="msgskel-item msgskel-item--me" height={62} lines={2} />
              <Skeleton variant="card" className="msgskel-item msgskel-item--ai" height={96} lines={3} />
              <Skeleton variant="card" className="msgskel-item msgskel-item--me" height={62} lines={2} />
            </div>
          )}
          {loadingMessages && messages.length > 0 && (
            <div className="msgrefresh">
              <RefreshIndicator label="Обновляем историю…" />
            </div>
          )}
          {messages.map((m) => {
            const isAi = m.role === 'ai'
            const isEditing = editingId === m.id
            // Встроенная утилита (консоль/проводник) — блок ```tool в тексте.
            const toolParsed = isAi && machineOps ? parseToolBlock(m.text) : null
            const baseText = toolParsed ? toolParsed.body : m.text
            // Картинки, созданные моделью: блок вырезаем всегда (иначе в тексте
            // виден сырой JSON), а показываем, только если есть доступ к машине.
            const imagesParsed = isAi ? parseImages(baseText) : null
            const imageText = imagesParsed ? imagesParsed.body : baseText
            // Уточняющие вопросы модели: вырезаем блок из текста; форма — только
            // у последнего сообщения ленты (после ответа пользователя она исчезает).
            const parsed = isAi ? parseQuestions(imageText) : null
            const aiText = parsed ? parsed.body : imageText
            const isLast = messages[messages.length - 1]?.id === m.id
            return (
              <div
                key={m.id}
                data-mid={m.id}
                className={[isAi ? 'msg ai' : 'msg me', m.id === highlightMessageId && 'msg--found']
                  .filter(Boolean)
                  .join(' ')}
              >
                {isAi ? (() => {
                  const msgModel = m.meta?.model ?? m.meta?.request?.model
                  const startMs = typeof m.meta?.durationMs === 'number' ? m.createdAt - m.meta.durationMs : null
                  const hasActivity = Boolean(m.meta?.activity && m.meta.activity.length > 0)
                  const machineLabel = m.execTarget === 'none' ? 'Без машины' : agents.find((a) => a.id === m.execTarget)?.name ?? 'Сервер'
                  return (
                    <div className="msg-head">
                      {/* Движок; используемая модель скрыта и появляется при наведении. */}
                      <span className={`${chipClass(m.role, diarization, m.engine)} msg-engine`} title={msgModel ? `Модель: ${msgModel}` : undefined}>
                        {engineLabel(m.engine)}
                        {msgModel && <span className="msg-model"> · {msgModel}</span>}
                      </span>
                      {/* Машина выполнения — сразу за движком/моделью. */}
                      <span className="msg-machine-head" title="Машина выполнения этого ответа">{machineLabel}</span>
                      {hasActivity && (
                        <label className="msg-view">
                          <span className="vc-sr-only">Вид ответа</span>
                          <select aria-label="Вид ответа" value={modeOf(m.id)} onChange={(event) => setModeFor(m.id, event.target.value as TimelineMode)}>
                            {TIMELINE_MODES.map((mode) => <option key={mode} value={mode}>{TIMELINE_MODE_LABEL[mode]}</option>)}
                          </select>
                        </label>
                      )}
                      {/* Крайнее правое сверху — время начала ответа (тот же формат ЧЧ:ММ:СС). */}
                      <span className="msg-head-right">
                        {startMs !== null && <span className="msg-start" title={`Начало ответа: ${dateTimeTooltip(startMs)}`}>{clockTime(startMs)}</span>}
                      </span>
                    </div>
                  )
                })() : (
                  <span className={chipClass(m.role, diarization)}>
                    {speakerName(m.role, diarization, aiLabel)}
                  </span>
                )}
                {isEditing ? (
                  <div className="editwrap">
                    <textarea
                      ref={editRef}
                      className="editarea"
                      value={editDraft}
                      rows={EDIT_MIN_ROWS}
                      onChange={(e) => setEditDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          saveEdit()
                        } else if (e.key === 'Escape') {
                          cancelEdit()
                        }
                      }}
                      aria-label="Редактирование сообщения"
                      autoFocus
                    />
                    <div className="editbtns">
                      <button className="editsave" onClick={saveEdit}>
                        Отправить
                      </button>
                      <button className="editcancel" onClick={cancelEdit}>
                        Отмена
                      </button>
                    </div>
                  </div>
                ) : isAi ? (
                  <div className="bub">
                    {/* Копировать ответ — той же иконкой и в том же углу, что копия кода. */}
                    <button
                      className="copymsg"
                      aria-label="Копировать ответ"
                      title="Копировать ответ"
                      onClick={() => copyMessage(m)}
                    >
                      {copiedId === m.id ? '✓' : '⧉'}
                    </button>
                    {m.meta?.interrupted && (
                      <p className="msg-interrupted" data-testid="msg-interrupted">
                        ⚠️ Ответ прерван перезапуском сервера — сохранена набранная часть.
                      </p>
                    )}
                    <MessageTimeline
                      text={aiText}
                      activity={m.meta?.activity ?? []}
                      mode={modeOf(m.id)}
                      endMs={m.createdAt}
                      execTarget={execTarget}
                    />
                    {machineOps &&
                      imagesParsed?.images.map((img) => (
                        <MessageImage
                          key={img.path}
                          image={img}
                          execAgentId={m.execTarget ?? execTarget}
                          ops={machineOps}
                          readServerFile={readServerFile}
                          agents={agents}
                          attachment={m.attachments?.find((file) => file.path === img.path)}
                          conversationId={m.conversationId}
                          onOpenInExplorer={onOpenImageInExplorer}
                        />
                      ))}
                    {toolParsed && machineOps && (
                      <MachineUtility
                        tool={toolParsed.tool}
                        agents={agents}
                        ops={machineOps}
                        {...(consoleHistory ? { consoleHistory } : {})}
                        variant="embedded"
                        onSwitchUtility={onSwitchUtility}
                        onOpenMachines={onOpenMachines}
                      />
                    )}
                    {parsed &&
                      (() => {
                        const ci = m.meta?.ciInteraction
                        const closed = ci ? answeredCiInteractions?.includes(ci.interactionId) : false
                        if (ci && onAnswerCiInteraction && !closed) {
                          return (
                            <QuestionsForm
                              questions={parsed.questions}
                              onSubmit={(text) => onAnswerCiInteraction(ci.runId, ci.interactionId, text)}
                            />
                          )
                        }
                        return null
                      })()}
                    {parsed && (!m.meta?.ciInteraction || answeredCiInteractions?.includes(m.meta.ciInteraction.interactionId)) &&
                      (isLast && onAnswerQuestions && state === 'idle' ? (
                        <QuestionsForm questions={parsed.questions} onSubmit={onAnswerQuestions} />
                      ) : (
                        <div className="qstatic" data-testid="questions-static">
                          {parsed.questions.map((q, i) => (
                            <p className="qstaticitem" key={i}>
                              {q.q} <span className="qstaticopts">({q.options.join(' / ')})</span>
                            </p>
                          ))}
                        </div>
                      ))}
                  </div>
                ) : (
                  <div className="bub">
                    <button
                      className="copymsg"
                      aria-label="Копировать вопрос"
                      title="Копировать вопрос"
                      onClick={() => copyMessage(m)}
                    >
                      {copiedId === m.id ? '✓' : '⧉'}
                    </button>
                    <p>{m.text}</p>
                    {m.meta?.previewElement && (
                      <details className="message-preview-context" data-testid="message-preview-context">
                        <summary>⌖ {m.meta.previewElement.tag}{m.meta.previewElement.id ? `#${m.meta.previewElement.id}` : m.meta.previewElement.classes[0] ? `.${m.meta.previewElement.classes[0]}` : ''} · {m.meta.previewElement.pageUrl}</summary>
                        <pre>{JSON.stringify(m.meta.previewElement, null, 2)}</pre>
                      </details>
                    )}
                    {machineOps && m.attachments?.filter((file) => file.mimeType.startsWith('image/') || isImagePath(file.path)).map((file) => (
                      <MessageImage
                        key={file.uploadId ?? file.path}
                        image={{ path: file.path, ...(file.agentId ? { agentId: file.agentId } : {}), ...(file.caption ? { caption: file.caption } : {}) }}
                        execAgentId={m.execTarget ?? execTarget}
                        ops={machineOps}
                        readServerFile={readServerFile}
                        agents={agents}
                        attachment={file}
                        conversationId={m.conversationId}
                        onOpenInExplorer={onOpenImageInExplorer}
                      />
                    ))}
                  </div>
                )}
                {!isEditing && (
                  <div className="mfoot">
                    {/* Слева: токены со стоимостью хода — наведение даёт сводку, клик открывает
                        «Что было отправлено модели». */}
                    {isAi && m.meta && (
                      <MessageMeta meta={m.meta} messageId={m.id} {...(onOpenKbDocument ? { onOpenKbDocument } : {})} />
                    )}
                    {isAi && isLast && m.meta?.request?.permissionMode === 'plan' && onExecutePlan && canExecutePlan && state === 'idle' && (
                      <Button size="sm" className="execute-plan" onClick={() => onExecutePlan(m.id)}>
                        Выполнить план
                      </Button>
                    )}
                    {isAi && m.meta?.makeSnapshotId && onMakeRestore && (
                      <Button size="sm" variant="ghost" className="make-restore-turn" title="Вернуть файлы проекта к состоянию до правок этого ответа" onClick={() => onMakeRestore(m.meta!.makeSnapshotId!)}>
                        Откатить правки
                      </Button>
                    )}
                    {/* Справа: озвучить, удалить и — крайним правым — время окончания (ЧЧ:ММ:СС). */}
                    <span className="mfoot-right">
                      {isAi && canSpeak && onSpeakMessage && (
                        <IconButton
                          size="sm"
                          aria-label={
                            speakingMessageId === m.id ? 'Остановить озвучку' : 'Озвучить ответ'
                          }
                          title={speakingMessageId === m.id ? 'Остановить' : 'Озвучить'}
                          onClick={() => onSpeakMessage(m.id, aiText)}
                        >
                          {speakingMessageId === m.id ? '⏹' : '🔊'}
                        </IconButton>
                      )}
                      {!isAi && canEdit && onEditMessage && (
                        <IconButton
                          size="sm"
                          aria-label="Изменить сообщение"
                          title="Изменить и переспросить"
                          onClick={() => startEdit(m)}
                        >
                          ✏️
                        </IconButton>
                      )}
                      {onDeleteMessage && (
                        <IconButton
                          size="sm"
                          aria-label="Удалить сообщение"
                          title="Удалить из истории"
                          onClick={() => onDeleteMessage(m.id)}
                        >
                          🗑
                        </IconButton>
                      )}
                      <p className="mtime" title={isAi ? `Конец ответа: ${dateTimeTooltip(m.createdAt)}` : dateTimeTooltip(m.createdAt)}>{clockTime(m.createdAt)}</p>
                    </span>
                  </div>
                )}
              </div>
            )
          })}

          {showPreparingReply && (() => {
            const live = liveHead()
            const prepStart = prepStartRef.current ?? liveNow
            return (
              <div className="msg ai" data-testid="reply-preparing">
                <div className="msg-head">
                  <span className={`${chipClass('ai', diarization, live.engine)} msg-engine`} title={live.model ? `Модель: ${live.model}` : undefined}>
                    {speakerName('ai', diarization, live.label)}
                    {live.model && <span className="msg-model"> · {live.model}</span>}
                  </span>
                  <span className="msg-machine-head" title="Машина выполнения этого ответа">{live.machineLabel}</span>
                  <span className="msg-head-right">
                    <span className="msg-start" title={`Начало ответа: ${dateTimeTooltip(prepStart)}`}>{clockTime(prepStart)}</span>
                  </span>
                </div>
                <div className="bub" role="status" aria-live="polite">
                  <span className="reply-preparing" data-testid="reply-preparing-inner">
                    <Dots />
                    <span>Готовим ответ…</span>
                  </span>
                </div>
              </div>
            )
          })()}

          {turnMeta && !hasStream && messages.length > 0 && messages[messages.length - 1].role === 'ai' && (
            <p className="turnmeta" data-testid="turn-meta">
              {formatTurnMeta(turnMeta)}
            </p>
          )}

          {isListening && (
            /* Распознанный текст появляется по частям — это журнал, и читалка
               должна дочитывать добавленное, а не молчать до конца записи. */
            <div className="live" data-testid="live-block" role="log" aria-live="polite" aria-label="Распознавание речи">
              <p className="livehdr">
                <span className="reddot" />
                РАСПОЗНАВАНИЕ · ЛОКАЛЬНО (WHISPER)
              </p>
              {liveSegments.map((s, i) => {
                const role = `u${s.speakerId}` as const
                return (
                  <p className="seg" key={i}>
                    <span className={chipClass(role, diarization)}>
                      {speakerName(role, diarization)}
                    </span>
                    <span>{s.text}</span>
                  </p>
                )
              })}
            </div>
          )}

          {hasStream && (
            <div className="msg ai" data-testid="streaming">
              <div className="msg-head">
                <span className={`${chipClass('ai', diarization, liveHead().engine)} msg-engine`} data-testid="live-engine" title={liveHead().model ? `Модель: ${liveHead().model}` : undefined}>
                  {speakerName('ai', diarization, liveHead().label)}
                  {liveHead().model && <span className="msg-model"> · {liveHead().model}</span>}
                </span>
                <span className="msg-machine-head" data-testid="live-machine" title="Машина выполнения этого ответа">
                  {liveHead().machineLabel}
                </span>
                <label className="msg-view">
                  <span className="vc-sr-only">Вид ответа</span>
                  <select aria-label="Вид ответа" value={liveMode} onChange={(event) => setLiveMode(event.target.value as TimelineMode)}>
                    {TIMELINE_MODES.map((mode) => <option key={mode} value={mode}>{TIMELINE_MODE_LABEL[mode]}</option>)}
                  </select>
                </label>
                <span className="msg-head-right">
                  {streamStartRef.current !== null && <span className="msg-start" title={`Начало ответа: ${dateTimeTooltip(streamStartRef.current)}`}>{clockTime(streamStartRef.current)}</span>}
                </span>
              </div>
              <div className="bub">
                <MessageTimeline
                  live
                  voice={state}
                  text={liveImages.body}
                  activity={liveActivity}
                  mode={liveMode}
                  execTarget={execTarget}
                />
                {machineOps &&
                  liveImages.images.map((img) => (
                    <MessageImage
                      key={img.path}
                      image={img}
                      execAgentId={execTarget}
                      ops={machineOps}
                      readServerFile={readServerFile}
                      agents={agents}
                      onOpenInExplorer={onOpenImageInExplorer}
                      live
                    />
                  ))}
              </div>
              {/* Таймер: сколько модель уже отвечает, обновляется раз в секунду; крайним правым. */}
              <div className="mfoot">
                <span className="mfoot-right">
                  <span className="msg-timer" data-testid="live-timer" role="timer" aria-live="off">
                    Отвечает: {formatElapsed(liveNow - (streamStartRef.current ?? liveNow))}
                  </span>
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {hasNewContent && (
        <div className="new-message-row">
          <Button
            className="new-message-button"
            variant="secondary"
            size="sm"
            aria-label="К новому сообщению"
            onClick={() => scrollToBottom()}
          >
            ↓ К новому сообщению
          </Button>
        </div>
      )}

      {execTarget && execTarget !== 'none' && <MachineHealthWarnings agent={agents.find((a) => a.id === execTarget)} />}
      <div className={(composerLayout ?? (messages.length === 0 ? 'centered' : 'docked')) === 'centered' ? 'chat-composer chat-composer--centered' : 'chat-composer chat-composer--docked'}>
        {voiceBar}
      </div>
    </main>
  )
}
