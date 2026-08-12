// Композер чата: поле ввода, вложения, микрофон, режим и статус голосового
// цикла. Панель сворачивается в одну строку: вместе с виджетом задачи она
// занимала половину экрана телефона и не оставляла ленте сообщений места.
// На мобильной ширине открывается свёрнутой, на десктопе — развёрнутой.
// Состояние нигде не хранится и ручной выбор не меняется при resize.

import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react'
import type { ModifierPrompt, PermissionMode, VoiceState } from '@shared/types'
import type { UploadInfo } from '@shared/ipc'
import type { PreviewElementPayload } from '@shared/previewInspector'
import { useAutoGrow } from '../lib/autoGrow'
import { chipClass, composerPeek, speakerName, statusLine, voiceAnnouncement } from '../lib/view'
import { WaveBars, Dots } from './animations'
import { IconButton } from './ui/IconButton'
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
  const isThinking = state === 'thinking' || state === 'transcribing'
  const isSpeaking = state === 'speaking'
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
      if (canSubmit) onSubmitText()
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
      : !isIdle
        ? { onClick: onCancelRequest, label: 'Остановить запрос' }
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
                    onClick={onSubmitText}
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
              {!isIdle && (
                <IconButton
                  className="vc-btn--circle"
                  variant="danger"
                  onClick={isSpeaking ? onStopSpeak : onCancelRequest}
                  title={isSpeaking ? 'Остановить озвучку' : 'Остановить запрос'}
                  aria-label={isSpeaking ? 'Остановить озвучку' : 'Остановить запрос'}
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

          {isThinking && !replyStarted && (
            <>
              <div className="speak">
                <Dots />
                <span className="fs13 fw6 speak-dim">
                  Запрос отправлен движку {aiLabel}…
                </span>
              </div>
              <IconButton
                className="vc-btn--circle"
                variant="danger"
                onClick={onCancelRequest}
                title="Остановить запрос"
                aria-label="Остановить запрос"
              >
                <StopIcon />
              </IconButton>
            </>
          )}

        </div>

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
          <p className="vstatus">
            {voiceInputEnabled ? statusLine(state, aiLabel) : (state === 'idle' ? '' : statusLine(state, aiLabel))}
          </p>
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
