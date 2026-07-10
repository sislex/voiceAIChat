import { useRef, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react'
import type { VoiceState } from '@shared/types'
import type { UploadInfo } from '@shared/ipc'
import { ACCENT, chipClass, speakerName, statusLine } from '../lib/view'
import { WaveBars, EqBars, Dots } from './animations'
import { MicIcon, StopIcon } from './icons'

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
  onRemoveAttachment
}: VoiceBarProps): JSX.Element {
  const isIdle = state === 'idle'
  const isListening = state === 'listening'
  const isThinking = state === 'thinking' || state === 'transcribing'
  const isSpeaking = state === 'speaking'

  const fileRef = useRef<HTMLInputElement>(null)
  const canSend = draft.trim().length > 0 || attachments.length > 0

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    // Enter — отправить, Shift+Enter — перенос строки (многострочный ввод).
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (canSend) onSubmitText()
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
                  aria-label={`Убрать вложение ${a.name}`}
                  onClick={() => onRemoveAttachment(a.id)}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="vrow" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
          {isIdle && (
            <>
              <textarea
                className="tin"
                placeholder="Напишите сообщение (Shift+Enter — новая строка)…"
                value={draft}
                rows={1}
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
              <button
                className="micbtn"
                style={{ background: ACCENT }}
                onClick={onStartVoice}
                title="Говорить"
                aria-label="Говорить"
              >
                <MicIcon />
              </button>
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

          {isThinking && (
            <>
              <div className="speak">
                <Dots />
                <span className="fs13 fw6" style={{ color: '#8A877C' }}>
                  Запрос отправлен в Claude Console…
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

          {isSpeaking && (
            <>
              <div className="speak">
                <span className="eq">
                  <EqBars />
                </span>
                <span className="fs13 fw7">Claude отвечает голосом…</span>
                <span className="fs11" style={{ color: '#A5A296', marginLeft: 'auto' }}>
                  TTS · локально
                </span>
              </div>
              <button
                className="stopbtn"
                onClick={onStopSpeak}
                title="Остановить озвучку"
                aria-label="Остановить озвучку"
              >
                <StopIcon />
              </button>
            </>
          )}
        </div>

        <p className="vstatus">{statusLine(state)}</p>
      </div>
    </div>
  )
}
