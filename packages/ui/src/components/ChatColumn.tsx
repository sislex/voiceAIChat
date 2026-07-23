import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Message, TurnMeta, VoiceState } from '@shared/types'
import type { AgentInfo } from '@shared/agentProtocol'
import {
  chipClass,
  engineLabel,
  formatTurnMeta,
  speakerName,
  statusBadge,
  type LiveSegment
} from '../lib/view'
import { Dots } from './animations'
import { Markdown } from './Markdown'
import { copyText } from '../lib/clipboard'

export interface ChatColumnProps {
  title: string
  state: VoiceState
  messages: Message[]
  liveSegments: LiveSegment[]
  diarization: boolean
  /** Стримящийся ответ Claude (растёт по токенам); пусто — нет активного стрима. */
  streamingReply?: string
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
  /** Текущая цель выполнения: id машины или null («на сервере»). */
  execTarget?: string | null
  /** Сменить цель выполнения команд. */
  onChangeExecTarget?: (target: string | null) => void
  /** Имя движка для подписи ответов и статуса (Claude/Codex). */
  aiLabel?: string
}

export function ChatColumn({
  title,
  state,
  messages,
  liveSegments,
  diarization,
  streamingReply = '',
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
  aiLabel = 'Claude'
}: ChatColumnProps): JSX.Element {
  const [exportOpen, setExportOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const copyMessage = (m: Message): void => {
    void copyText(m.text).then(() => {
      setCopiedId(m.id)
      setTimeout(() => setCopiedId((id) => (id === m.id ? null : id)), 1500)
    })
  }

  const canEdit = state === 'idle'
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

  // Автоскролл вниз при новых сообщениях/сегментах/токенах ответа.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, liveSegments, state, streamingReply])

  const isListening = state === 'listening'
  const hasStream = streamingReply.length > 0
  // Индикатор «думает» показываем, пока не пошли токены ответа.
  const isThinking = (state === 'thinking' || state === 'transcribing') && !hasStream

  return (
    <main className="main">
      <header className="mhead">
        <h1 className="mtitle">{title}</h1>
        {agents.length > 0 && onChangeExecTarget && (
          <label className="exectarget" title="Где выполнять команды агента">
            <span className={`exectarget-dot ${execTarget ? 'remote' : 'server'}`} aria-hidden />
            <select
              className="exectarget-sel"
              aria-label="Где выполнять команды"
              value={execTarget ?? ''}
              onChange={(e) => onChangeExecTarget(e.target.value || null)}
            >
              <option value="">🖥 На сервере</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id} disabled={!a.online}>
                  💻 {a.name}
                  {a.online ? '' : ' (офлайн)'}
                </option>
              ))}
            </select>
          </label>
        )}
        <span className="mhead-right">
          <span className="badge">{statusBadge(state, aiLabel)}</span>
          {onExport && messages.length > 0 && (
            <span className="exportwrap">
              <button
                className="exportbtn"
                aria-label="Экспорт разговора"
                title="Экспорт разговора"
                onClick={() => setExportOpen((v) => !v)}
              >
                ⇩
              </button>
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

      {error && (
        <div className="errbar" role="alert" data-testid="error-bar">
          <span>{error}</span>
          <button className="errclose" aria-label="Закрыть ошибку" onClick={onDismissError}>
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

      <div className="scroll" ref={scrollRef} data-testid="scroll">
        <div className="col-c">
          {messages.map((m) => {
            const isAi = m.role === 'ai'
            const isEditing = editingId === m.id
            return (
              <div key={m.id} className={isAi ? 'msg ai' : 'msg me'}>
                <span className={chipClass(m.role, diarization)}>
                  {speakerName(m.role, diarization, isAi ? engineLabel(m.engine) : aiLabel)}
                </span>
                {isEditing ? (
                  <div className="editwrap">
                    <textarea
                      className="editarea"
                      value={editDraft}
                      rows={Math.min(10, editDraft.split('\n').length + 1)}
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
                    <Markdown>{m.text}</Markdown>
                  </div>
                ) : (
                  <p className="bub">{m.text}</p>
                )}
                {!isEditing && (
                  <div className="mfoot">
                    <p className="mtime">{m.time}</p>
                    {isAi && (
                      <button
                        className="msgbtn"
                        aria-label="Копировать ответ"
                        title="Копировать ответ"
                        onClick={() => copyMessage(m)}
                      >
                        {copiedId === m.id ? '✓' : '📋'}
                      </button>
                    )}
                    {isAi && canSpeak && onSpeakMessage && (
                      <button
                        className="speakbtn"
                        aria-label={
                          speakingMessageId === m.id ? 'Остановить озвучку' : 'Озвучить ответ'
                        }
                        title={speakingMessageId === m.id ? 'Остановить' : 'Озвучить'}
                        onClick={() => onSpeakMessage(m.id, m.text)}
                      >
                        {speakingMessageId === m.id ? '⏹' : '🔊'}
                      </button>
                    )}
                    {!isAi && canEdit && onEditMessage && (
                      <button
                        className="msgbtn"
                        aria-label="Изменить сообщение"
                        title="Изменить и переспросить"
                        onClick={() => startEdit(m)}
                      >
                        ✏️
                      </button>
                    )}
                    {onDeleteMessage && (
                      <button
                        className="msgbtn"
                        aria-label="Удалить сообщение"
                        title="Удалить из истории"
                        onClick={() => onDeleteMessage(m.id)}
                      >
                        🗑
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {turnMeta && !hasStream && messages.length > 0 && messages[messages.length - 1].role === 'ai' && (
            <p className="turnmeta" data-testid="turn-meta">
              {formatTurnMeta(turnMeta)}
            </p>
          )}

          {isListening && (
            <div className="live" data-testid="live-block">
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

          {isThinking && (
            <div className="think" data-testid="think">
              <Dots />
              {aiLabel} обрабатывает запрос…
            </div>
          )}

          {hasStream && (
            <div className="msg ai" data-testid="streaming">
              <span className={chipClass('ai', diarization)}>{speakerName('ai', diarization, aiLabel)}</span>
              <div className="bub">
                <Markdown>{streamingReply}</Markdown>
              </div>
            </div>
          )}
        </div>
      </div>

      {voiceBar}
    </main>
  )
}
