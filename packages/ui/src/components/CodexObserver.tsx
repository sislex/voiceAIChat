import type { MouseEvent } from 'react'
import type { CxProject, CxSession, CxItem, CxItemKind } from '@shared/codexSessions'
import { Markdown } from './Markdown'

export interface CodexObserverProps {
  projects: CxProject[]
  sessions: CxSession[]
  transcript: CxItem[]
  /** Активный проект — по cwd. */
  activeProject: string | null
  /** Активная сессия — по id. */
  activeSession: string | null
  onSelectProject: (cwd: string) => void
  onSelectSession: (id: string) => void
  /** Продолжить сессию в приложении (импорт истории + привязка session-id). */
  onResumeSession: (id: string) => void
  onClose: () => void
}

const KIND_LABEL: Record<CxItemKind, string> = {
  user: 'Вы',
  assistant: 'Codex',
  thinking: 'рассуждает',
  tool_use: 'инструмент',
  tool_result: 'результат',
  other: '···'
}

/** Относительное время (сегодня HH:MM / дата). */
function when(ms: number): string {
  const d = new Date(ms)
  const today = new Date()
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  return sameDay
    ? d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

/** Одна запись транскрипта: сообщения — Markdown, активность — компактная строка. */
function TranscriptItem({ item }: { item: CxItem }): JSX.Element {
  if (item.kind === 'user' || item.kind === 'assistant') {
    return (
      <div className={`cc-msg cc-${item.kind}`}>
        <span className="cc-role">{KIND_LABEL[item.kind]}</span>
        {item.kind === 'assistant' ? (
          <div className="bub">
            <Markdown>{item.text}</Markdown>
          </div>
        ) : (
          <p className="bub">{item.text}</p>
        )}
      </div>
    )
  }
  return (
    <div className={`cc-act clk-${item.kind}${item.isError ? ' cc-err' : ''}`}>
      <span className="clbadge">{KIND_LABEL[item.kind]}</span>
      <span className="cc-act-text">{item.text}</span>
    </div>
  )
}

/** Проводник сессий Codex: проекты (cwd) → сессии → транскрипт (read-only + live). */
export function CodexObserver({
  projects,
  sessions,
  transcript,
  activeProject,
  activeSession,
  onSelectProject,
  onSelectSession,
  onResumeSession,
  onClose
}: CodexObserverProps): JSX.Element {
  const stop = (e: MouseEvent): void => e.stopPropagation()
  return (
    <div className="ovl" onClick={onClose} data-testid="cx-overlay">
      <div className="ccobs" onClick={stop} role="dialog" aria-label="Проводник Codex">
        <div className="mdhead">
          <h2 className="mdh">Проводник Codex</h2>
          <button className="xbtn" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>
        <div className="ccobs-body">
          <nav className="cc-col cc-projects" aria-label="Проекты">
            {projects.length === 0 && <p className="cc-empty">Проектов не найдено</p>}
            {projects.map((p) => (
              <button
                key={p.cwd}
                className={p.cwd === activeProject ? 'cc-item on' : 'cc-item'}
                onClick={() => onSelectProject(p.cwd)}
              >
                <span className="cc-name">{p.name}</span>
                <span className="cc-sub">
                  {p.sessionCount} · {when(p.lastActivity)}
                </span>
              </button>
            ))}
          </nav>

          <nav className="cc-col cc-sessions" aria-label="Сессии">
            {activeProject && sessions.length === 0 && <p className="cc-empty">Нет сессий</p>}
            {sessions.map((s) => (
              <button
                key={s.id}
                className={s.id === activeSession ? 'cc-item on' : 'cc-item'}
                onClick={() => onSelectSession(s.id)}
              >
                <span className="cc-name">{s.title}</span>
                <span className="cc-sub">{when(s.updatedAt)}</span>
              </button>
            ))}
          </nav>

          <div className="cc-col cc-transcript" data-testid="cx-transcript">
            {activeSession && (
              <div className="cc-actions">
                <span className="cc-live">
                  <span className="reddot" /> LIVE · слежение за сессией
                </span>
                <button
                  className="vdl"
                  aria-label="Продолжить эту сессию"
                  onClick={() => onResumeSession(activeSession)}
                >
                  ▶ Продолжить эту сессию
                </button>
              </div>
            )}
            {!activeSession && <p className="cc-empty">Выберите сессию</p>}
            {transcript.map((item, i) => (
              <TranscriptItem key={i} item={item} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
