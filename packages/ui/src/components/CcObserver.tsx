import type { ReactNode } from 'react'
import type { CcProject, CcSession, CcItem, CcItemKind } from '@shared/cc'
import { Markdown } from './Markdown'
import { Button } from '@voicechat/ui-kit'
import { ToolFrame } from './ToolFrame'

export interface CcObserverProps {
  /** Размещение: модалка из меню (по умолчанию) или страница контентной колонки. */
  variant?: 'modal' | 'page'
  projects: CcProject[]
  sessions: CcSession[]
  transcript: CcItem[]
  activeProject: string | null
  activeSession: string | null
  onSelectProject: (slug: string) => void
  onSelectSession: (slug: string, id: string) => void
  /** Продолжить сессию в приложении (импорт истории + привязка session-id). */
  onResumeSession: (slug: string, id: string) => void
  onClose: () => void
  /** Узел в шапку ToolFrame (переключатель движка объединённого наблюдателя). */
  toolbar?: ReactNode
  /** Панель над телом (сводка расхода: модель/токены/стоимость). */
  banner?: ReactNode
  /** Заголовок рамки; объединённый наблюдатель задаёт общее имя. */
  title?: string
}

const KIND_LABEL: Record<CcItemKind, string> = {
  user: 'Вы',
  assistant: 'Claude',
  thinking: 'думает',
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
function TranscriptItem({ item }: { item: CcItem }): JSX.Element {
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

/** Проводник сессий Claude Code: проекты → сессии → транскрипт (read-only + live). */
export function CcObserver({
  projects,
  sessions,
  transcript,
  activeProject,
  activeSession,
  onSelectProject,
  onSelectSession,
  onResumeSession,
  onClose,
  toolbar,
  banner,
  title = 'Проводник Claude Code',
  variant = 'modal'
}: CcObserverProps): JSX.Element {
  return (
    <ToolFrame title={title} variant={variant} onClose={onClose} testId="cc-overlay" actions={toolbar}>
      {banner}
      <div className="ccobs-body">
        <nav className="cc-col cc-projects" aria-label="Проекты">
          {projects.length === 0 && <p className="cc-empty">Проектов не найдено</p>}
          {projects.map((p) => (
            <button
              key={p.slug}
              className={p.slug === activeProject ? 'cc-item on' : 'cc-item'}
              onClick={() => onSelectProject(p.slug)}
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
              onClick={() => activeProject && onSelectSession(activeProject, s.id)}
            >
              <span className="cc-name">{s.title}</span>
              <span className="cc-sub">{when(s.updatedAt)}</span>
            </button>
          ))}
        </nav>

        <div className="cc-col cc-transcript" data-testid="cc-transcript">
          {activeSession && (
            <div className="cc-actions">
              <span className="cc-live">
                <span className="reddot" /> LIVE · слежение за сессией
              </span>
              <Button
                variant="primary"
                size="sm"
                aria-label="Продолжить эту сессию"
                onClick={() => activeProject && onResumeSession(activeProject, activeSession)}
              >
                ▶ Продолжить эту сессию
              </Button>
            </div>
          )}
          {!activeSession && <p className="cc-empty">Выберите сессию</p>}
          {transcript.map((item, i) => (
            <TranscriptItem key={i} item={item} />
          ))}
        </div>
      </div>
    </ToolFrame>
  )
}
