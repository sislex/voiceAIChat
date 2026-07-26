import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { ClaudeLogEntry, Message, PermissionMode, TurnMeta, VoiceState } from '@shared/types'
import { parseQuestions } from '@shared/questions'
import { parseToolBlock } from '@shared/tools'
import { parseImages } from '@shared/images'
import type { ServerFileInfo } from '@shared/protocol'
import type { AgentInfo } from '@shared/agentProtocol'
import { MachineUtility } from './MachineUtility'
import { MessageImage } from './MessageImage'
import type { MachineOps } from './machine'
import {
  activityStatus,
  chipClass,
  engineLabel,
  formatTurnMeta,
  messageTime,
  pluralActions,
  speakerName,
  statusBadge,
  type LiveSegment
} from '../lib/view'
import { Dots } from './animations'
import { Markdown } from './Markdown'
import { QuestionsForm } from './QuestionsForm'
import { MessageMeta } from './MessageMeta'
import { MessageActivity } from './MessageActivity'
import { copyText } from '../lib/clipboard'
import { useAutoGrow } from '../lib/autoGrow'

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
  /** Переименовать текущий разговор (клик по заголовку в шапке). */
  onRenameTitle?: (title: string) => void
  /** Показать/скрыть сайдбар (кнопка ☰, видна только на мобильных). */
  onToggleSidebar?: () => void
  /** Открыть отдельную страницу настроек текущего разговора. */
  onOpenConversationSettings?: () => void
  /** Фактический режим активного разговора для бейджа в шапке. */
  permissionMode?: PermissionMode
  /** Выполнить исходный запрос планового ответа в режиме разработки. */
  onExecutePlan?: (answerId: string) => void
  /** Разрешено ли эскалировать план (user без машины — нет). */
  canExecutePlan?: boolean
  state: VoiceState
  messages: Message[]
  /** Идёт загрузка сообщений разговора — показываем лоадер вместо ленты. */
  loadingMessages?: boolean
  liveSegments: LiveSegment[]
  diarization: boolean
  /** Стримящийся ответ Claude (растёт по токенам); пусто — нет активного стрима. */
  streamingReply?: string
  /** Активность текущего (незавершённого) хода — для живого статуса/секций. */
  liveActivity?: ClaudeLogEntry[]
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
  /** Операции над машиной для встроенных утилит; отсутствуют → виджеты не рендерятся. */
  machineOps?: MachineOps
  /** Чтение файла с диска сервера — картинки, созданные самим CLI. */
  readServerFile?: (path: string) => Promise<ServerFileInfo | null>
  /** Открыть файл картинки в проводнике нужной машины. */
  onOpenImageInExplorer?: (agentId: string, path: string) => void
  /** Открыть терминал из встроенного проводника в сообщении. */
  onOpenTerminal?: (agentId: string, cwd: string) => void
}

export function ChatColumn({
  title,
  onRenameTitle,
  onToggleSidebar,
  onOpenConversationSettings,
  permissionMode = 'plan',
  onExecutePlan,
  canExecutePlan = true,
  state,
  messages,
  loadingMessages = false,
  liveSegments,
  diarization,
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
  onAnswerQuestions,
  machineOps,
  readServerFile,
  onOpenImageInExplorer,
  onOpenTerminal
}: ChatColumnProps): JSX.Element {
  const [exportOpen, setExportOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  // Поле редактирования — как композер: от двух строк до четырёх, дальше скролл.
  // Хук один на колонку: редактируется всегда не больше одного сообщения.
  const editRef = useAutoGrow(editDraft, EDIT_MIN_ROWS, EDIT_MAX_ROWS)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [titleEditing, setTitleEditing] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  // id сообщений в подробном виде (по умолчанию все в простом); плюс отдельный
  // флаг подробного вида для живого (стримящегося) хода.
  const [detailedIds, setDetailedIds] = useState<Set<string>>(new Set())
  const [liveDetailed, setLiveDetailed] = useState(false)

  const toggleDetailed = (id: string): void =>
    setDetailedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

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
  // Картинки в ещё не завершённом ответе: блок вырезаем сразу, чтобы вместо
  // сырого JSON пользователь видел саму картинку, как только файл готов.
  const liveImages = parseImages(streamingReply)
  // Индикатор «думает» показываем, пока не пошли токены ответа.
  const isThinking = (state === 'thinking' || state === 'transcribing') && !hasStream

  return (
    <main className="main">
      <header className="mhead">
        {onToggleSidebar && (
          <button
            className="burger"
            aria-label="Меню разговоров"
            title="Меню разговоров"
            onClick={onToggleSidebar}
          >
            ☰
          </button>
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
        <span className="mtitle-machine" data-testid="head-machine" title="Машина этого разговора">
          {execTarget === 'none' ? 'Без машины' : execTarget ? (agents.find((a) => a.id === execTarget)?.name ?? execTarget) : 'Сервер'}
        </span>
        <button
          className={`mode-badge mode-badge--${permissionMode}`}
          data-testid="mode-badge"
          onClick={onOpenConversationSettings}
          disabled={!onOpenConversationSettings}
          title="Открыть настройки режима разговора"
        >
          {modeLabel(permissionMode)}
        </button>
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

      <div className="scroll" ref={scrollRef} data-testid="scroll">
        <div className="col-c">
          {loadingMessages && (
            <div className="msgloading" data-testid="messages-loading">
              <Dots />
              <span>Загрузка сообщений…</span>
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
              <div key={m.id} className={isAi ? 'msg ai' : 'msg me'}>
                <span className={chipClass(m.role, diarization, isAi ? m.engine : undefined)}>
                  {speakerName(m.role, diarization, isAi ? engineLabel(m.engine) : aiLabel)}
                </span>
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
                    {m.meta?.interrupted && (
                      <p className="msg-interrupted" data-testid="msg-interrupted">
                        ⚠️ Ответ прерван перезапуском сервера — сохранена набранная часть.
                      </p>
                    )}
                    {m.meta?.activity && m.meta.activity.length > 0 && (
                      <MessageActivity
                        activity={m.meta.activity}
                        detailed={detailedIds.has(m.id)}
                        execTarget={execTarget}
                      />
                    )}
                    {aiText && <Markdown>{aiText}</Markdown>}
                    {machineOps &&
                      imagesParsed?.images.map((img) => (
                        <MessageImage
                          key={img.path}
                          image={img}
                          execAgentId={m.execTarget ?? execTarget}
                          ops={machineOps}
                          readServerFile={readServerFile}
                          agents={agents}
                          onOpenInExplorer={onOpenImageInExplorer}
                        />
                      ))}
                    {toolParsed && machineOps && (
                      <MachineUtility
                        tool={toolParsed.tool}
                        agents={agents}
                        ops={machineOps}
                        variant="embedded"
                        onOpenTerminal={onOpenTerminal}
                      />
                    )}
                    {parsed &&
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
                  <p className="bub">{m.text}</p>
                )}
                {!isEditing && (
                  <div className="mfoot">
                    <span className="msg-machine" title="Снимок машины в момент выполнения">
                      {isAi ? 'Ответ' : 'Вопрос'}: {m.execTarget === 'none' ? 'Без машины' : agents.find((a) => a.id === m.execTarget)?.name ?? 'Сервер'}
                    </span>
                    {isAi && (
                      <span className="msg-mode" data-testid={`message-mode-${m.id}`} title="Режим этого ответа">
                        {modeLabel(m.meta?.request?.permissionMode)}
                      </span>
                    )}
                    <p className="mtime">{messageTime(m)}</p>
                    {isAi && m.meta && <MessageMeta meta={m.meta} />}
                    {isAi && m.meta?.activity && m.meta.activity.length > 0 && (
                      <button
                        className="msgbtn actbtn"
                        aria-label={detailedIds.has(m.id) ? 'Свернуть подробности' : 'Показать подробности'}
                        title={detailedIds.has(m.id) ? 'Кратко' : 'Подробнее'}
                        aria-pressed={detailedIds.has(m.id)}
                        onClick={() => toggleDetailed(m.id)}
                      >
                        {detailedIds.has(m.id) ? '≡ Кратко' : '≣ Подробнее'}
                      </button>
                    )}
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
                    {isAi && isLast && m.meta?.request?.permissionMode === 'plan' && onExecutePlan && canExecutePlan && state === 'idle' && (
                      <button className="execute-plan" onClick={() => onExecutePlan(m.id)}>
                        Выполнить план
                      </button>
                    )}
                    {isAi && canSpeak && onSpeakMessage && (
                      <button
                        className="speakbtn"
                        aria-label={
                          speakingMessageId === m.id ? 'Остановить озвучку' : 'Озвучить ответ'
                        }
                        title={speakingMessageId === m.id ? 'Остановить' : 'Озвучить'}
                        onClick={() => onSpeakMessage(m.id, aiText)}
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
              {liveActivity.length > 0 ? (
                <MessageActivity
                  live
                  voice={state}
                  activity={liveActivity}
                  detailed={liveDetailed}
                  execTarget={execTarget}
                />
              ) : (
                <>
                  <Dots />
                  {aiLabel} обрабатывает запрос…
                </>
              )}
              {liveActivity.length > 0 && (
                <button
                  className="msgbtn actbtn"
                  aria-pressed={liveDetailed}
                  onClick={() => setLiveDetailed((v) => !v)}
                >
                  {liveDetailed ? '≡ Кратко' : '≣ Подробнее'}
                </button>
              )}
            </div>
          )}

          {hasStream && (
            <div className="msg ai" data-testid="streaming">
              <span className={chipClass('ai', diarization, aiLabel === 'Codex' ? 'codex' : 'claude')}>
                {speakerName('ai', diarization, aiLabel)}
              </span>
              <div className="bub">
                <div className="live-machine" data-testid="live-machine">
                  Машина: {execTarget === 'none' ? 'Без машины' : agents.find((a) => a.id === execTarget)?.name ?? 'Сервер'}
                </div>
                {liveActivity.length > 0 && (
                  <MessageActivity
                    live
                    voice={state}
                    activity={liveActivity}
                    detailed={liveDetailed}
                    execTarget={execTarget}
                  />
                )}
                <Markdown>{liveImages.body}</Markdown>
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
                {/* Дубль статуса внизу пузыря: при длинном ответе верхняя строка
                    уезжает из вида, а здесь всегда видно, что модель делает. */}
                <div className="msgact-status msgact--bottom" data-testid="live-status-bottom">
                  <Dots />
                  <span className="msgact-phrase">
                    {liveActivity.length > 0
                      ? activityStatus(liveActivity, state, execTarget)
                      : `${aiLabel} отвечает…`}
                  </span>
                  {liveActivity.length > 0 && (
                    <span className="msgact-count">
                      {liveActivity.length} {pluralActions(liveActivity.length)}
                    </span>
                  )}
                  {liveActivity.length > 0 && (
                    <button
                      className="msgbtn actbtn actbtn--stream"
                      aria-pressed={liveDetailed}
                      onClick={() => setLiveDetailed((v) => !v)}
                    >
                      {liveDetailed ? '≡ Кратко' : '≣ Подробнее'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {voiceBar}
    </main>
  )
}
