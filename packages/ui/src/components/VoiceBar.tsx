import { useEffect, useRef, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react'
import type { ModifierPrompt, PermissionMode, VoiceState } from '@shared/types'
import type { UploadInfo } from '@shared/ipc'
import { useAutoGrow } from '../lib/autoGrow'
import { ACCENT, chipClass, speakerName, statusLine } from '../lib/view'
import { WaveBars, Dots } from './animations'
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
}

export function VoiceBar({
  state,
  draft,
  diarization,
  detectedSpeakers,
  attachments,
  onDraftChange,
  onSubmitText,
  onStartVoice,
  onStopVoice,
  onStopSpeak,
  onCancelRequest,
  onAddFiles,
  onRemoveAttachment,
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
  onClosePromptSuggestions
}: VoiceBarProps): JSX.Element {
  const isIdle = state === 'idle'
  const isListening = state === 'listening'
  const isThinking = state === 'thinking' || state === 'transcribing'
  const isSpeaking = state === 'speaking'
  // Композер доступен в idle, во время озвучки и как только пошёл стриминг ответа —
  // можно печатать следующий вопрос черновиком. Отправка заблокирована до idle.
  const composerMode = isIdle || isSpeaking || replyStarted

  const fileRef = useRef<HTMLInputElement>(null)
  // Композер начинается с двух строк и растёт с текстом до четырёх, дальше — скролл.
  const draftRef = useAutoGrow(draft, DRAFT_MIN_ROWS, DRAFT_MAX_ROWS)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const canSend = draft.trim().length > 0 || attachments.length > 0
  const canSubmit = isIdle && canSend
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

  return (
    <div className="voicebar">
      <div className="vinner">
        {helper.open && (
          <div className="prompt-helper" data-testid="prompt-helper" role="listbox" aria-label="Варианты формулировки запроса">
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
              helper.variants.map((variant, i) => (
                <button
                  key={i}
                  className="prompt-variant"
                  role="option"
                  onClick={() => onApplyPromptSuggestion?.(variant)}
                >
                  {variant}
                </button>
              ))
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

        {isIdle && attachments.length > 0 && (
          <div className="attchips" data-testid="attachments">
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
                ref={(element) => { inputRef.current = element; draftRef(element) }}
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
                <button className="attachbtn wandbtn" {...aiAssist.triggerProps}><WandIcon /></button>
              )}
              {canSuggest && (
                <button
                  className={`attachbtn wandbtn${helper.open ? ' active' : ''}`}
                  onClick={() => (helper.open ? onClosePromptSuggestions?.() : onSuggestPrompts?.())}
                  disabled={helper.loading}
                  aria-expanded={helper.open}
                  title="Подсказать формулировку"
                  aria-label="Подсказать формулировку запроса"
                >
                  <WandIcon />
                </button>
              )}
              <button
                className="attachbtn"
                onClick={() => fileRef.current?.click()}
                title="Прикрепить файл"
                aria-label="Прикрепить файл"
              >
                📎
              </button>
              {isIdle ? (
                canSend ? (
                  <button
                    className="micbtn sendbtn"
                    style={{ background: ACCENT }}
                    onClick={onSubmitText}
                    title="Отправить сообщение"
                    aria-label="Отправить сообщение"
                  >
                    <SendIcon />
                  </button>
                ) : voiceInputEnabled ? (
                  <button
                    className="micbtn"
                    style={{ background: ACCENT }}
                    onClick={onStartVoice}
                    title="Говорить"
                    aria-label="Говорить"
                  >
                    <MicIcon />
                  </button>
                ) : null
              ) : (
                <>
                  <button
                    className="micbtn sendbtn"
                    disabled
                    title="Дождитесь завершения ответа, затем отправьте"
                    aria-label="Отправить сообщение"
                  >
                    <SendIcon />
                  </button>
                  <button
                    className="stopbtn"
                    onClick={isSpeaking ? onStopSpeak : onCancelRequest}
                    title={isSpeaking ? 'Остановить озвучку' : 'Остановить запрос'}
                    aria-label={isSpeaking ? 'Остановить озвучку' : 'Остановить запрос'}
                  >
                    <StopIcon />
                  </button>
                </>
              )}
            </>
          )}

          {isListening && (
            <>
              <div className="wavewrap" data-testid="wave">
                <WaveBars />
              </div>
              <button
                className="stopbtn"
                onClick={onStopVoice}
                title="Готово"
                aria-label="Остановить запись"
              >
                <StopIcon />
              </button>
            </>
          )}

          {isThinking && !replyStarted && (
            <>
              <div className="speak">
                <Dots />
                <span className="fs13 fw6" style={{ color: '#8A877C' }}>
                  Запрос отправлен движку {aiLabel}…
                </span>
              </div>
              <button
                className="stopbtn"
                onClick={onCancelRequest}
                title="Остановить запрос"
                aria-label="Остановить запрос"
              >
                <StopIcon />
              </button>
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
        </div>
      </div>
      <PromptBuilder {...aiAssist.popupProps} />
    </div>
  )
}
