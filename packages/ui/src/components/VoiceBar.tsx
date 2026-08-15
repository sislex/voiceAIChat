// Композер чата: поле ввода, вложения, микрофон, режим и статус голосового
// цикла. Панель сворачивается в одну строку: вместе с виджетом задачи она
// занимала половину экрана телефона и не оставляла ленте сообщений места.
// На мобильной ширине открывается свёрнутой, на десктопе — развёрнутой.
// Состояние нигде не хранится и ручной выбор не меняется при resize.

import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react'
import type { ModifierPrompt, PermissionMode, VoiceState } from '@shared/types'
import type { UploadInfo } from '@shared/ipc'
import type { PreviewElementPayload } from '@shared/previewInspector'
import type { QueuedTurn } from '@shared/protocol'
import { useAutoGrow } from '../lib/autoGrow'
import { chipClass, composerPeek, speakerName, voiceAnnouncement } from '../lib/view'
import { WaveBars, Dots } from './animations'
import { IconButton } from '@voicechat/ui-kit'
import { MicIcon, SendIcon, StopIcon, WandIcon } from './icons'
import { PromptBuilder, type GenerateParams, type Suggestion } from './prompt-builder/PromptBuilder'
import { applyNativeInputValue, useAiAssist } from './prompt-builder/useAiAssist'

const DRAFT_MIN_ROWS = 2
const DRAFT_MAX_ROWS = 4

export interface VoiceBarProps {
  state: VoiceState
  draft: string
  diarization: boolean
  /** Номера обнаруженных спикеров во время записи (для строки «Обнаружено говорящих»). */
  detectedSpeakers: number[]
  /** Прикреплённые к следующему сообщению файлы. */
  attachments: UploadInfo[]
  /** DOM-область из веб-превью, приложенная к следующей реплике. */
  previewElement?: PreviewElementPayload | null
  queuedTurns?: QueuedTurn[]
  queuePaused?: boolean
  onEditQueued?: (id: string, text: string) => void
  onDeleteQueued?: (id: string) => void
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
  onSendQueuedNow,
  onDraftChange,
  onSubmitText,
  onStartVoice,
  onStopVoice,
  onStopSpeak,
  onCancelRequest,
  onAddFiles,
  onRemoveAttachment,
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
  defaultCollapsed = true
}: VoiceBarProps): JSX.Element {
  const isIdle = state === 'idle'
  const isListening = state === 'listening'
  const isSpeaking = state === 'speaking'
  type RequestPhase = 'sending' | 'processing' | 'streaming' | 'stopping' | 'stopped' | 'error'
  const [requestPhase, setRequestPhase] = useState<RequestPhase | null>(null)
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
    processing: `${aiLabel} обрабатывает запрос…`,
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
  // Композер начинается с двух строк и растёт с текстом до четырёх, дальше — скролл.
  const draftRef = useAutoGrow(draft, DRAFT_MIN_ROWS, DRAFT_MAX_ROWS)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const canSend = draft.trim().length > 0 || attachments.length > 0 || previewElement !== null
  const canSubmit = canSend
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
    if (e.key === 'Enter' && !e.shiftKey) {
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
          <div className="vcollapsed">
            <button
              className="vcollapsed-peek"
              data-testid="composer-expand"
              aria-expanded={false}
              title="Развернуть поле ввода"
              onClick={expand}
            >
              <span className="vcollapsed-chevron" aria-hidden>⌃</span>
              <span className="vcollapsed-text">{requestStatus ?? composerPeek(draft, attachments.length, state, aiLabel)}</span>
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
    <div className="voicebar">
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
            {attachments.map((a) => (
              <span className="attchip" key={a.id}>
                📎 {a.name}
                <button
                  className="attx"
                  aria-label={`Убрать вложение ${a.name}`} title={`Убрать вложение ${a.name}`}
                  onClick={() => onRemoveAttachment(a.id)}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}

        {queuedTurns.length > 0 && (
          <section className="turn-queue" aria-label="В очереди" data-testid="turn-queue">
            <div className="turn-queue__header">
              <strong>В очереди</strong>
              {queuePaused && <span className="turn-queue__paused">Пауза после остановки</span>}
            </div>
            <ol>
              {queuedTurns.map((item) => (
                <li key={item.id} data-testid="turn-queue-item">
                  <div className="turn-queue__meta">№ {item.position} · {item.status === 'failed' ? 'Ошибка отправки' : 'Ожидает'}</div>
                  <p>{item.text}</p>
                  {item.attachments.length > 0 && <div className="turn-queue__attachments">📎 {item.attachments.length} влож.</div>}
                  <div className="turn-queue__actions">
                    <button type="button" onClick={() => {
                      const next = window.prompt('Изменить вопрос', item.text)
                      if (next?.trim()) onEditQueued?.(item.id, next)
                    }}>Редактировать</button>
                    <button type="button" onClick={() => onDeleteQueued?.(item.id)}>Удалить</button>
                    <button type="button" onClick={() => onSendQueuedNow?.(item.id)}>Отправить сейчас</button>
                  </div>
                </li>
              ))}
            </ol>
          </section>
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
                className="tin"
                placeholder="Напишите сообщение (Shift+Enter — новая строка)…"
                value={draft}
                rows={DRAFT_MIN_ROWS}
                onChange={(e) => onDraftChange(e.target.value)}
                onKeyDown={onKey}
                onPaste={onPaste}
                aria-label="Поле ввода сообщения"
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
          <div className="request-status" data-testid="request-status" role="status" aria-live="polite">
            {requestActive && <Dots />}
            <span className="request-status__text">{requestStatus}</span>
            {requestActive && (
              <IconButton
                className="vc-btn--circle request-status__stop"
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
          </div>
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
