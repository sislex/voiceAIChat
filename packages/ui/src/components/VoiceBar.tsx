// Композер чата: поле ввода, вложения, микрофон, режим и статус голосового
// цикла. Панель сворачивается в одну строку: вместе с виджетом задачи она
// занимала половину экрана телефона и не оставляла ленте сообщений места.
// На мобильной ширине открывается свёрнутой, на десктопе — развёрнутой.
// Состояние нигде не хранится и ручной выбор не меняется при resize.

import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react'
import type { ModifierPrompt, PermissionMode, VoiceState } from '@shared/types'
import type { UploadInfo } from '@shared/ipc'
import type { PreviewElementPayload } from '@shared/previewInspector'
import type { QueuedTurn, ServerFileInfo } from '@shared/protocol'
import { useAutoGrow } from '../lib/autoGrow'
import { chipClass, composerPeek, speakerName, voiceAnnouncement } from '../lib/view'
import { WaveBars, Dots } from './animations'
import { IconButton } from '@voicechat/ui-kit'
import { DiagonalResizeIcon, MicIcon, SendIcon, StopIcon, WandIcon } from './icons'
import { PromptBuilder, type GenerateParams, type Suggestion } from './prompt-builder/PromptBuilder'
import { applyNativeInputValue, useAiAssist } from './prompt-builder/useAiAssist'

const DRAFT_MIN_ROWS = 1
const DRAFT_MAX_ROWS = 4

export interface ComposerAttachment {
  localId?: string
  status?: 'processing' | 'ready' | 'error'
  previewUrl?: string | null
  error?: string | null
  upload?: UploadInfo | null
  file?: File
  id?: string
  name?: string
  path?: string
  mimeType?: string
  size?: number
}

function AttachmentChip({
  attachment,
  onRemove,
  onRetry,
  readServerFile
}: {
  attachment: ComposerAttachment
  onRemove: () => void
  onRetry?: () => void
  readServerFile?: (path: string) => Promise<ServerFileInfo | null>
}): JSX.Element {
  const upload = attachment.upload ?? attachment
  const name = upload.name ?? attachment.name ?? attachment.file?.name ?? 'Файл'
  const mimeType = upload.mimeType ?? attachment.mimeType ?? ''
  const path = upload.path ?? attachment.path
  const status = attachment.status ?? 'ready'
  const image = mimeType.startsWith('image/') || Boolean(attachment.previewUrl)
  const [src, setSrc] = useState<string | null>(attachment.previewUrl ?? null)

  useEffect(() => {
    if (attachment.previewUrl) {
      setSrc(attachment.previewUrl)
      return
    }
    if (!image || !readServerFile || !path) return
    let alive = true
    void readServerFile(path).then((file) => {
      if (alive && file) setSrc(`data:${mimeType};base64,${file.dataBase64}`)
    }).catch(() => undefined)
    return () => { alive = false }
  }, [attachment.previewUrl, mimeType, path, image, readServerFile])

  if (!image) {
    return (
      <span className={`attchip attchip--${status}`}>
        📎 {name}
        {status === 'processing' && <span role="status">Загрузка…</span>}
        {status === 'error' && onRetry && <button type="button" onClick={onRetry}>Повторить</button>}
        <button className="attx" aria-label={`Убрать вложение ${name}`} title={`Убрать вложение ${name}`} onClick={onRemove}>✕</button>
      </span>
    )
  }

  return (
    <figure className={`attpreview attpreview--${status}`} data-testid="attachment-image-preview" data-status={status}>
      <div className="attpreview-image">
        {src ? <img src={src} alt="" /> : <span aria-hidden="true">🖼</span>}
        {status === 'processing' && <span className="attpreview-state" role="status">Загрузка…</span>}
        {status === 'error' && <span className="attpreview-state" role="alert">Ошибка</span>}
      </div>
      <figcaption title={name}>{name}</figcaption>
      {status === 'error' && onRetry && <button className="attpreview-retry" type="button" onClick={onRetry}>Повторить</button>}
      <button className="attx attpreview-remove" aria-label={`Убрать вложение ${name}`} title={`Убрать вложение ${name}`} onClick={onRemove}>✕</button>
    </figure>
  )
}

export interface VoiceBarProps {
  state: VoiceState
  draft: string
  diarization: boolean
  /** Номера обнаруженных спикеров во время записи (для строки «Обнаружено говорящих»). */
  detectedSpeakers: number[]
  /** Прикреплённые к следующему сообщению файлы. */
  attachments: ComposerAttachment[]
  /** DOM-область из веб-превью, приложенная к следующей реплике. */
  previewElement?: PreviewElementPayload | null
  queuedTurns?: QueuedTurn[]
  queuePaused?: boolean
  onEditQueued?: (id: string, text: string) => void
  onDeleteQueued?: (id: string) => void
  onReorderQueued?: (ids: string[]) => void
  onSendQueuedNow?: (id: string) => void
  onDraftChange: (value: string) => void
  onSubmitText: () => void
  onStartVoice: () => void
  onStopVoice: () => void
  onStopSpeak: () => void
  /** Отменить текущий запрос к Claude (случайно отправил). */
  onCancelRequest: () => void
  /** Прикрепить выбранные файлы. */
  onAddFiles: (files: File[]) => void
  /** Убрать вложение по id. */
  onRemoveAttachment: (id: string) => void
  onRetryAttachment?: (id: string) => void
  /** Прочитать загруженное изображение для миниатюры композера. */
  readServerFile?: (path: string) => Promise<ServerFileInfo | null>
  /** Убрать выбранную DOM-область. */
  onRemovePreviewElement?: () => void
  /** Имя движка ответа (Claude / Codex) — для подписей статуса. */
  aiLabel?: string
  /** Ответ уже начал стримиться (пошли токены) — держим поле ввода доступным для черновика. */
  replyStarted?: boolean
  /** Ошибка активного хода; нужна для краткого итогового состояния строки. */
  requestError?: string | null
  /** Фактический режим активного разговора. */
  permissionMode?: PermissionMode
  /** Быстро переключить планирование/разработку для всего разговора. */
  onChangePermissionMode?: (mode: PermissionMode) => void
  /** Глобальная доступность голосового ввода. */
  voiceInputEnabled?: boolean
  aiAssistPrompts?: ModifierPrompt[]
  onAiAssistPromptsChange?: (next: ModifierPrompt[]) => void
  generateAiAssist?: (params: GenerateParams) => Promise<Suggestion[]>
  /** Состояние помощника промптов (панель переформулировок). */
  promptHelper?: { open: boolean; loading: boolean; variants: string[]; error: string | null }
  /** Запросить у LLM варианты переформулировки текущего черновика. */
  onSuggestPrompts?: () => void
  /** Применить выбранный вариант (заполнить поле ввода). */
  onApplyPromptSuggestion?: (text: string) => void
  /** Закрыть панель помощника, ничего не меняя. */
  onClosePromptSuggestions?: () => void
  /**
   * С какого состояния открыть панель. Приложение передаёт адаптивное значение,
   * а проп также позволяет витрине и изолированным тестам выбрать нужный вид.
   */
  defaultCollapsed?: boolean
  layout?: 'centered' | 'docked'
}

export function VoiceBar({
  state,
  draft,
  diarization,
  detectedSpeakers,
  attachments,
  previewElement = null,
  queuedTurns = [],
  queuePaused = false,
  onEditQueued,
  onDeleteQueued,
  onReorderQueued,
  onSendQueuedNow,
  onDraftChange,
  onSubmitText,
  onStartVoice,
  onStopVoice,
  onStopSpeak,
  onCancelRequest,
  onAddFiles,
  onRemoveAttachment,
  onRetryAttachment,
  readServerFile,
  onRemovePreviewElement,
  aiLabel = 'Claude',
  replyStarted = false,
  requestError = null,
  permissionMode = 'plan',
  onChangePermissionMode,
  voiceInputEnabled = true,
  aiAssistPrompts = [],
  onAiAssistPromptsChange,
  generateAiAssist,
  promptHelper,
  onSuggestPrompts,
  onApplyPromptSuggestion,
  onClosePromptSuggestions,
  defaultCollapsed = true,
  layout = 'docked'
}: VoiceBarProps): JSX.Element {
  const isIdle = state === 'idle'
  const isListening = state === 'listening'
  const isSpeaking = state === 'speaking'
  type RequestPhase = 'sending' | 'processing' | 'streaming' | 'stopping' | 'stopped' | 'error'
  const [requestPhase, setRequestPhase] = useState<RequestPhase | null>(null)
  const [queueExpanded, setQueueExpanded] = useState(false)
  const [editorExpanded, setEditorExpanded] = useState(false)
  const [editingQueueId, setEditingQueueId] = useState<string | null>(null)
  const [queueEditText, setQueueEditText] = useState('')
  const [draggedQueueId, setDraggedQueueId] = useState<string | null>(null)
  const requestWasActive = useRef(false)
  const cancelSent = useRef(false)

  // Realtime-события только переводят одну строку между этапами: повторный token
  // не создаёт новый DOM-элемент. Итог виден коротко, затем строка исчезает.
  useEffect(() => {
    if (state === 'thinking') {
      requestWasActive.current = true
      if (!cancelSent.current) setRequestPhase(replyStarted ? 'streaming' : 'processing')
      return
    }
    if (!requestWasActive.current) return
    requestWasActive.current = false
    if (!requestError && !cancelSent.current) {
      setRequestPhase(null)
      return
    }
    setRequestPhase(requestError ? 'error' : 'stopped')
    const timer = window.setTimeout(() => setRequestPhase(null), 1500)
    return () => window.clearTimeout(timer)
  }, [state, replyStarted, requestError])

  const submitRequest = (): void => {
    if (state === 'idle') {
      cancelSent.current = false
      setRequestPhase('sending')
    }
    onSubmitText()
  }

  const stopRequest = (): void => {
    if (cancelSent.current) return
    cancelSent.current = true
    setRequestPhase('stopping')
    onCancelRequest()
  }

  const requestStatus = requestPhase ? {
    sending: 'Запрос отправляется…',
    processing: 'Готовим ответ…',
    streaming: `${aiLabel} формирует ответ…`,
    stopping: 'Останавливаем запрос…',
    stopped: 'Запрос остановлен',
    error: 'Ошибка выполнения'
  }[requestPhase] : null
  const requestActive = requestPhase === 'sending' || requestPhase === 'processing' || requestPhase === 'streaming' || requestPhase === 'stopping'

  // Композер остаётся доступным во время ожидания и стриминга: сервер сам
  // сериализует новые реплики в очередь разговора.
  const composerMode = !isListening

  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const focusAfterExpandRef = useRef(false)
  const collapse = (): void => setCollapsed(true)
  const expand = (): void => {
    focusAfterExpandRef.current = true
    setCollapsed(false)
  }

  const fileRef = useRef<HTMLInputElement>(null)
  // Композер начинается с одной строки и растёт с текстом до четырёх, дальше — скролл.
  const draftRef = useAutoGrow(draft, DRAFT_MIN_ROWS, DRAFT_MAX_ROWS)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const blockedAttachments = attachments.filter((item) => item.status && item.status !== 'ready')
  const processingAttachmentCount = blockedAttachments.filter((item) => item.status === 'processing').length
  const errorAttachmentCount = blockedAttachments.filter((item) => item.status === 'error').length
  const readyAttachments = attachments.filter((item) => !item.status || item.status === 'ready')
  const canSend = draft.trim().length > 0 || readyAttachments.length > 0 || previewElement !== null
  const canSubmit = canSend && blockedAttachments.length === 0
  const helper = promptHelper ?? { open: false, loading: false, variants: [], error: null }
  // Палочку показываем в idle, когда есть что переформулировать.
  const canSuggest = isIdle && draft.trim().length > 0 && !!onSuggestPrompts
  const aiAssist = useAiAssist({
    value: draft,
    onChange: (value) => {
      if (inputRef.current) applyNativeInputValue(inputRef.current, value)
      else onDraftChange(value)
    },
    prompts: aiAssistPrompts,
    onPromptsChange: onAiAssistPromptsChange,
    generate: generateAiAssist ?? (async () => [])
  })
  const aiAssistEnabled = isIdle && !!generateAiAssist

  // Esc закрывает панель вариантов. Слушатель на фазе перехвата со stopPropagation,
  // чтобы не сработали глобальные хоткеи (как в ToolFrame).
  useEffect(() => {
    if (!helper.open) return
    const onKey = (e: WindowEventMap['keydown']): void => {
      if (e.key !== 'Escape' && e.code !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onClosePromptSuggestions?.()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [helper.open, onClosePromptSuggestions])

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    // Enter — отправить, Shift+Enter — перенос строки (многострочный ввод).
    if (e.key === 'Enter' && !e.shiftKey && !e.repeat) {
      e.preventDefault()
      if (canSubmit) submitRequest()
    }
  }

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>): void => {
    const files = Array.from(e.clipboardData?.files ?? [])
    if (files.length > 0) {
      e.preventDefault()
      onAddFiles(files)
    }
  }

  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    const files = Array.from(e.dataTransfer?.files ?? [])
    if (files.length > 0) {
      e.preventDefault()
      onAddFiles(files)
    }
  }

  const pickFiles = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const files = Array.from(e.target.files ?? [])
    if (files.length > 0) onAddFiles(files)
    e.target.value = '' // позволяет выбрать тот же файл повторно
  }

  const moveQueued = (id: string, targetId: string): void => {
    if (id === targetId) return
    const ids = queuedTurns.map((item) => item.id)
    const from = ids.indexOf(id)
    const to = ids.indexOf(targetId)
    if (from < 0 || to < 0) return
    ids.splice(to, 0, ids.splice(from, 1)[0]!)
    onReorderQueued?.(ids)
  }
  // Очередь остаётся самостоятельной поверхностью возле композера даже когда
  // само поле свёрнуто (это дефолт на телефоне). Иначе ожидающие сообщения и все
  // действия над ними пропадали до ручного раскрытия поля ввода.
  const renderTurnQueue = (): JSX.Element | null => queuedTurns.length > 0 ? (
    <section className="turn-queue" aria-label="В очереди" data-testid="turn-queue">
      <div className="turn-queue__header">
        <strong>В очереди · {queuedTurns.length}</strong>
        {queuePaused && <span className="turn-queue__paused" role="status">Очередь остановлена после ошибки</span>}
      </div>
      <ol className={queueExpanded ? 'turn-queue__list turn-queue__list--expanded' : 'turn-queue__list'}>
        {(queueExpanded ? queuedTurns : queuedTurns.slice(0, 3)).map((item) => (
          <li
            key={item.id}
            data-testid="turn-queue-item"
            draggable={editingQueueId !== item.id}
            onDragStart={(event) => {
              setDraggedQueueId(item.id)
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData('text/plain', item.id)
            }}
            onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move' }}
            onDrop={(event) => {
              event.preventDefault()
              const sourceId = draggedQueueId ?? event.dataTransfer.getData('text/plain')
              if (sourceId) moveQueued(sourceId, item.id)
              setDraggedQueueId(null)
            }}
            onDragEnd={() => setDraggedQueueId(null)}
          >
            {editingQueueId === item.id ? (
              <form className="turn-queue__edit" onSubmit={(event) => {
                event.preventDefault()
                if (!queueEditText.trim()) return
                onEditQueued?.(item.id, queueEditText)
                setEditingQueueId(null)
              }}>
                <label>
                  <span className="sr-only">Текст ожидающего сообщения</span>
                  <textarea autoFocus value={queueEditText} onChange={(event) => setQueueEditText(event.target.value)} />
                </label>
                <div className="turn-queue__edit-actions">
                  <button type="submit">Сохранить</button>
                  <button type="button" onClick={() => setEditingQueueId(null)}>Отмена</button>
                </div>
              </form>
            ) : (
              <div className="turn-queue__row">
                <span className="turn-queue__text" title={item.text}>{item.text}</span>
                {item.status === 'failed' && <span className="turn-queue__failed">Ошибка</span>}
                {item.attachments.length > 0 && (
                  <span
                    className="turn-queue__attachment-count"
                    title={(item.attachmentDetails ?? []).map((attachment) => attachment.name).join(', ') || `${item.attachments.length} вложений`}
                  >
                    📎 {item.attachments.length}
                  </span>
                )}
                <div className="turn-queue__actions">
                  <IconButton size="sm" aria-label={`Редактировать сообщение № ${item.position}`} title="Редактировать" onClick={() => {
                    setEditingQueueId(item.id)
                    setQueueEditText(item.text)
                  }}>✎</IconButton>
                  <IconButton size="sm" aria-label={`Отправить сейчас сообщение № ${item.position}`} title="Отправить сейчас" onClick={() => onSendQueuedNow?.(item.id)}>↑</IconButton>
                  <IconButton size="sm" aria-label={`Удалить сообщение № ${item.position}`} title="Удалить" onClick={() => onDeleteQueued?.(item.id)}>×</IconButton>
                </div>
              </div>
            )}
          </li>
        ))}
      </ol>
      {queuedTurns.length > 3 && (
        <button
          className="turn-queue__toggle"
          type="button"
          aria-expanded={queueExpanded}
          onClick={() => setQueueExpanded((value) => !value)}
        >
          {queueExpanded ? 'Свернуть очередь' : `Показать ещё ${queuedTurns.length - 3}`}
        </button>
      )}
    </section>
  ) : null

  // Свёрнутая панель: строка-заглушка с тем, что в композере осталось, и — если
  // ход не в простое — красная кнопка остановки. Прятать её за разворот нельзя:
  // ход модели и запись должны обрываться одним нажатием откуда угодно.
  const collapsedStop = isListening
    ? { onClick: onStopVoice, label: 'Остановить запись' }
    : isSpeaking
      ? { onClick: onStopSpeak, label: 'Остановить озвучку' }
      : state === 'thinking'
        ? { onClick: stopRequest, label: 'Остановить ответ' }
        : null

  if (collapsed) {
    return (
      <div className="voicebar voicebar--collapsed">
        <div className="vinner">
          {renderTurnQueue()}
          <div className="vcollapsed">
            <button
              className="vcollapsed-peek"
              data-testid="composer-expand"
              aria-expanded={false}
              title="Развернуть поле ввода"
              onClick={expand}
            >
              <span className="vcollapsed-chevron" aria-hidden>⌃</span>
              <span className="vcollapsed-text">{composerPeek(draft, attachments.length, state, aiLabel)}</span>
            </button>
            {collapsedStop && (
              <IconButton
                className="vc-btn--circle"
                size="sm"
                variant="danger"
                onClick={collapsedStop.onClick}
                title={collapsedStop.label}
                aria-label={collapsedStop.label}
                disabled={requestPhase === 'stopping'}
                aria-busy={requestPhase === 'stopping' || undefined}
              >
                <StopIcon />
              </IconButton>
            )}
          </div>
          {/* Живая область остаётся и свёрнутой: читалка не должна замолкать
              только оттого, что панель убрали в строку. */}
          <p className="vc-sr-only" role="status" aria-live="polite" data-testid="voice-announce">
            {voiceAnnouncement(state, aiLabel)}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className={`voicebar voicebar--${layout}${editorExpanded ? ' voicebar--expanded' : ''}`} data-layout={layout}>
      {layout === 'centered' && <h2 className="voicebar-greeting">Чем я могу помочь?</h2>}
      <div className="vinner">
        <div className="vhandle">
          <IconButton
            className="vhandle-btn"
            size="sm"
            aria-expanded
            aria-label="Свернуть поле ввода"
            title="Свернуть поле ввода"
            data-testid="composer-collapse"
            onClick={collapse}
          >
            ⌄
          </IconButton>
          {(editorExpanded || draft.includes('\n')) && (
            <IconButton
              className="vhandle-btn"
              size="sm"
              aria-expanded={editorExpanded}
              aria-label={editorExpanded ? 'Свернуть поле ввода' : 'Развернуть поле ввода'}
              title={editorExpanded ? 'Свернуть поле ввода' : 'Развернуть поле ввода'}
              data-testid="composer-size-toggle"
              onClick={() => {
                const element = inputRef.current
                const selection = element ? [element.selectionStart, element.selectionEnd] as const : null
                setEditorExpanded((value) => !value)
                requestAnimationFrame(() => {
                  if (!element) return
                  element.focus()
                  if (selection) element.setSelectionRange(selection[0], selection[1])
                })
              }}
            >
              <DiagonalResizeIcon expanded={editorExpanded} />
            </IconButton>
          )}
        </div>
        {helper.open && (
          <div className="prompt-helper" data-testid="prompt-helper" role="group" aria-label="Варианты формулировки запроса">
            <div className="prompt-helper-head">
              <span>Варианты формулировки</span>
              <button
                className="prompt-helper-close"
                onClick={() => onClosePromptSuggestions?.()}
                aria-label="Закрыть варианты"
                title="Закрыть"
              >
                ✕
              </button>
            </div>
            {helper.loading ? (
              <div className="prompt-helper-msg">
                <Dots />
                Подбираю варианты…
              </div>
            ) : helper.error ? (
              <div className="prompt-helper-msg">{helper.error}</div>
            ) : helper.variants.length === 0 ? (
              <div className="prompt-helper-msg">Вариантов нет</div>
            ) : (
              /* role=listbox — только на обёртке вариантов: внутри listbox
                 допустимы одни option, а шапка панели с крестиком — нет. */
              <div className="prompt-helper-list" role="listbox" aria-label="Варианты формулировки">
                {helper.variants.map((variant, i) => (
                  <button
                    key={i}
                    className="prompt-variant"
                    role="option"
                    aria-selected={false}
                    onClick={() => onApplyPromptSuggestion?.(variant)}
                  >
                    {variant}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {isListening && (
          <div className="spkline" data-testid="spkline">
            Обнаружено говорящих:
            {detectedSpeakers.map((n) => {
              const role = `u${n}` as const
              return (
                <span key={n} className={chipClass(role, diarization)}>
                  {speakerName(role, diarization)}
                </span>
              )
            })}
          </div>
        )}

        {(attachments.length > 0 || previewElement) && (
          <div className="attchips" data-testid="attachments">
            {previewElement && (
              <span className="attchip previewchip" data-testid="preview-element-chip" title={previewElement.selector}>
                ⌖ {previewElement.tag}{previewElement.id ? `#${previewElement.id}` : previewElement.classes[0] ? `.${previewElement.classes[0]}` : ''} · {(() => { try { return new URL(previewElement.pageUrl).hostname } catch { return previewElement.pageUrl } })()}
                <button className="attx" aria-label="Убрать выбранную область" title="Убрать выбранную область" onClick={onRemovePreviewElement}>✕</button>
              </span>
            )}
            {attachments.map((attachment) => (
              <AttachmentChip
                key={attachment.localId ?? attachment.id}
                attachment={attachment}
                onRemove={() => onRemoveAttachment(attachment.localId ?? attachment.id ?? '')}
                onRetry={onRetryAttachment ? () => onRetryAttachment(attachment.localId ?? attachment.id ?? '') : undefined}
                {...(readServerFile ? { readServerFile } : {})}
              />
            ))}
          </div>
        )}

        {renderTurnQueue()}

        {blockedAttachments.length > 0 && (
          <p className="attachment-submit-error" id="attachment-submit-error" role="status">
            {[
              processingAttachmentCount > 0 ? `Обрабатывается файлов: ${processingAttachmentCount}. Дождитесь завершения.` : '',
              errorAttachmentCount > 0 ? `Файлов с ошибкой: ${errorAttachmentCount}. Повторите загрузку или удалите их.` : ''
            ].filter(Boolean).join(' ')}
          </p>
        )}

        <div className="vrow" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
          {composerMode && (
            <>
              <textarea
                ref={(element) => {
                  inputRef.current = element
                  draftRef(element)
                  if (element && focusAfterExpandRef.current) {
                    focusAfterExpandRef.current = false
                    element.focus()
                  }
                }}
                className={`tin${editorExpanded ? ' tin--expanded' : ''}`}
                placeholder="Напишите сообщение (Shift+Enter — новая строка)…"
                value={draft}
                rows={DRAFT_MIN_ROWS}
                onChange={(e) => onDraftChange(e.target.value)}
                onKeyDown={onKey}
                onPaste={onPaste}
                aria-label="Поле ввода сообщения"
                aria-invalid={blockedAttachments.length > 0 || undefined}
                data-ai-assist={aiAssistEnabled ? '' : undefined}
              />
              <input
                ref={fileRef}
                type="file"
                multiple
                hidden
                onChange={pickFiles}
                data-testid="file-input"
                aria-hidden="true"
              />
              {aiAssistEnabled && (
                <IconButton className="vc-btn--circle composer-wand" size="sm" {...aiAssist.triggerProps}><WandIcon /></IconButton>
              )}
              {canSuggest && (
                <IconButton
                  className="vc-btn--circle composer-wand"
                  size="sm"
                  onClick={() => (helper.open ? onClosePromptSuggestions?.() : onSuggestPrompts?.())}
                  loading={helper.loading}
                  aria-expanded={helper.open}
                  title="Подсказать формулировку"
                  aria-label="Подсказать формулировку запроса"
                >
                  <WandIcon />
                </IconButton>
              )}
              <IconButton
                className="vc-btn--circle"
                size="sm"
                onClick={() => fileRef.current?.click()}
                title="Прикрепить файл"
                aria-label="Прикрепить файл"
              >
                📎
              </IconButton>
              {canSend ? (
                  <IconButton
                    className="vc-btn--circle"
                    variant="primary"
                    onClick={submitRequest}
                    title={isIdle ? 'Отправить сообщение' : 'Добавить сообщение в очередь'}
                    aria-label={isIdle ? 'Отправить сообщение' : 'Добавить сообщение в очередь'}
                    disabled={!canSubmit}
                    aria-describedby={blockedAttachments.length > 0 ? 'attachment-submit-error' : undefined}
                  >
                    <SendIcon />
                  </IconButton>
                ) : isIdle && voiceInputEnabled ? (
                  <IconButton
                    className="vc-btn--circle"
                    variant="primary"
                    onClick={onStartVoice}
                    title="Говорить"
                    aria-label="Говорить"
                  >
                    <MicIcon />
                  </IconButton>
                ) : null}
              {requestActive && (
                <IconButton
                  className="vc-btn--circle composer-stop"
                  size="sm"
                  variant="danger"
                  onClick={stopRequest}
                  disabled={requestPhase === 'stopping'}
                  aria-busy={requestPhase === 'stopping' || undefined}
                  title="Остановить ответ"
                  aria-label="Остановить ответ"
                >
                  <StopIcon />
                </IconButton>
              )}
              {isSpeaking && (
                <IconButton
                  className="vc-btn--circle"
                  variant="danger"
                  onClick={onStopSpeak}
                  title="Остановить озвучку"
                  aria-label="Остановить озвучку"
                >
                  <StopIcon />
                </IconButton>
              )}
            </>
          )}

          {isListening && (
            <>
              <div className="wavewrap" data-testid="wave">
                <WaveBars />
              </div>
              <IconButton
                className="vc-btn--circle"
                variant="danger"
                onClick={onStopVoice}
                title="Готово"
                aria-label="Остановить запись"
              >
                <StopIcon />
              </IconButton>
            </>
          )}

        </div>

        {requestStatus && (
          <span className="vc-sr-only" data-testid="request-status" role="status" aria-live="polite">
            {requestStatus}
          </span>
        )}

        <div className="vbottom">
          {onChangePermissionMode && (
            <div className="mode-toggle" role="group" aria-label="Режим работы">
              <button
                className={permissionMode === 'plan' ? 'active' : ''}
                aria-pressed={permissionMode === 'plan'}
                disabled={!isIdle}
                onClick={() => onChangePermissionMode('plan')}
              >
                План
              </button>
              <button
                className={permissionMode !== 'plan' ? 'active' : ''}
                aria-pressed={permissionMode !== 'plan'}
                disabled={!isIdle}
                onClick={() => onChangePermissionMode('acceptEdits')}
              >
                Разработка
              </button>
            </div>
          )}
          {/* Статус записи — скринридеру. Видимую .vstatus живой областью не
              делаем: в простое там длинная подсказка про пробел и Esc, и
              читалка зачитывала бы её после каждого ответа. Здесь — короткая
              фраза о том, что происходит с микрофоном и запросом. */}
          <p className="vc-sr-only" role="status" aria-live="polite" data-testid="voice-announce">
            {voiceAnnouncement(state, aiLabel)}
          </p>
        </div>
      </div>
      <PromptBuilder {...aiAssist.popupProps} />
    </div>
  )
}
