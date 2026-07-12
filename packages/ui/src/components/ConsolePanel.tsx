import { useState } from 'react'
import type { ClaudeLogEntry, ClaudeLogKind } from '@shared/types'

export interface ConsolePanelProps {
  /** Записи активности агента (в порядке поступления). */
  log: ClaudeLogEntry[]
  /** Развёрнута ли панель. */
  open: boolean
  /** Свернуть/развернуть панель. */
  onToggle: () => void
}

/** Ярлык вида активности для бейджа (короткий, как в терминале). */
const KIND_LABEL: Record<ClaudeLogKind, string> = {
  system: 'sys',
  thinking: 'think',
  tool_use: 'tool',
  tool_result: 'res',
  result: 'done',
  stt: '🎤',
  tts: '🔊',
  other: '···'
}

/** Одна запись лога: клик раскрывает сырой stream-json. */
function LogRow({ entry }: { entry: ClaudeLogEntry }): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className={`clrow clk-${entry.kind}`} data-testid="console-row">
      <button
        className="clrow-head"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="clbadge">{KIND_LABEL[entry.kind]}</span>
        <span className="clsum">{entry.summary}</span>
      </button>
      {expanded && (
        <div className="clraw" data-testid="console-raw">
          {entry.detail && <div className="cldetail">{entry.detail}</div>}
          <pre className="clpre">{entry.raw}</pre>
        </div>
      )}
    </div>
  )
}

/** Сворачиваемая панель активности агента (режим консоли). */
export function ConsolePanel({ log, open, onToggle }: ConsolePanelProps): JSX.Element {
  return (
    <aside className={open ? 'console console--open' : 'console'} data-testid="console-panel">
      <button
        className="console-head"
        onClick={onToggle}
        aria-expanded={open}
        aria-label="Режим консоли"
      >
        <span className="console-title">Консоль</span>
        <span className="console-count">{log.length}</span>
        <span className="console-chev">{open ? '▸' : '◂'}</span>
      </button>
      {open && (
        <div className="console-body" data-testid="console-body">
          {log.length === 0 ? (
            <p className="console-empty">Пока нет активности агента.</p>
          ) : (
            log.map((entry, i) => <LogRow key={i} entry={entry} />)
          )}
        </div>
      )}
    </aside>
  )
}
