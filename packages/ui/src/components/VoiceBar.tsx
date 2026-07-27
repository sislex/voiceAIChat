import { useRef, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react'
import type { PermissionMode, VoiceState } from '@shared/types'
import type { UploadInfo } from '@shared/ipc'
import { useAutoGrow } from '../lib/autoGrow'
import { ACCENT, chipClass, speakerName, statusLine } from '../lib/view'
import { WaveBars, Dots } from './animations'
import { MicIcon, SendIcon, StopIcon } from './icons'

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
  voiceInputEnabled = true
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
  const canSend = draft.trim().length > 0 || attachments.length > 0
  const canSubmit = isIdle && canSend

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
                ref={draftRef}
                className="tin"
                placeholder="Напишите сообщение (Shift+Enter — новая строка)…"
                value={draft}
                rows={DRAFT_MIN_ROWS}
                onChange={(e) => onDraftChange(e.target.value)}
                onKeyDown={onKey}
                onPaste={onPaste}
                aria-label="Поле ввода сообщения"
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
                ) : (
                  <button
                    className="micbtn"
                    style={{ background: voiceInputEnabled ? ACCENT : undefined }}
                    onClick={onStartVoice}
                    disabled={!voiceInputEnabled}
                    title={voiceInputEnabled ? 'Говорить' : 'Голосовой ввод временно недоступен'}
                    aria-label="Говорить"
                  >
                    <MicIcon />
                  </button>
                )
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
            {voiceInputEnabled ? statusLine(state, aiLabel) : 'Голосовой ввод временно недоступен'}
          </p>
        </div>
      </div>
    </div>
  )
}
