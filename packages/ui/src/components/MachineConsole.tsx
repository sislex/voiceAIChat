import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import type { AgentExecResult, AgentInfo } from '@shared/agentProtocol'
import type { ConsoleHistoryStore, SwitchUtility, UtilityVariant } from './machine'
import { MachineUtilityHeader } from './MachineUtilityHeader'
import { copyText } from '../lib/clipboard'
import { IconButton } from '@voicechat/ui-kit'
import { ToolFrame } from './ToolFrame'
import { RefreshIndicator } from '@voicechat/ui-kit'
import { EmptyState } from '@voicechat/ui-kit'
import { ErrorState } from '@voicechat/ui-kit'

/** Сколько команд помнит сама консоль, когда историю не держит стор. */
const LOCAL_HISTORY_MAX = 100

export interface MachineConsoleProps {
  agents: AgentInfo[]
  initialAgentId?: string | null
  /** Выполнить команду на машине; `signal` — кнопка «Стоп». */
  exec: (agentId: string, command: string, signal?: AbortSignal) => Promise<AgentExecResult>
  /**
   * Память набранных команд по машине (стор). Не задана — история живёт только
   * до закрытия окна: сам компонент умирает вместе с утилитой.
   */
  historyStore?: ConsoleHistoryStore
  /**
   * Папка, для которой открыли утилиту. Сама команда идёт не в ней, а в корне
   * агента (`exec` без cwd), поэтому консоль её не показывает — папка нужна лишь
   * затем, чтобы переход в проводник открылся там, откуда пришли.
   */
  initialCwd?: string
  /** Команда, выполняемая сразу после открытия (навык из шапки чата). */
  initialCommand?: string
  variant?: UtilityVariant
  onClose?: () => void
  /** Переключиться на проводник этой машины (шапка утилиты). */
  onSwitchUtility?: SwitchUtility
  /** Ссылка в раздел «Машины» из шапки утилиты. */
  onOpenMachines?: () => void
}

export interface HistoryItem {
  command: string
  output: string
  exitCode: number | null
  error?: string
  /** Прервали кнопкой «Стоп» — это не ошибка, а неполный вывод. */
  cancelled?: boolean
}

/** Дописать команду в список набранных; подряд повторённую не дублируем. */
function remember(list: string[], command: string): string[] {
  if (list[list.length - 1] === command) return list
  return [...list, command].slice(-LOCAL_HISTORY_MAX)
}

/** Текст сеанса для кнопки копирования: команда, её вывод и итог. */
export function consoleTranscript(items: HistoryItem[]): string {
  return items
    .map((h) => {
      const lines = [`$ ${h.command}`]
      if (h.output) lines.push(h.output.replace(/\n+$/, ''))
      if (h.error) lines.push(`ошибка: ${h.error}`)
      else if (h.cancelled) lines.push('отменено')
      else if (h.exitCode !== 0 && h.exitCode !== null) lines.push(`exit ${h.exitCode}`)
      return lines.join('\n')
    })
    .join('\n\n')
}

/** Самодостаточная консоль по машине: ввод команды → вывод (по политике машины). */
export function MachineConsole({
  agents,
  initialAgentId,
  exec,
  historyStore,
  initialCommand,
  initialCwd,
  variant = 'modal',
  onClose,
  onSwitchUtility,
  onOpenMachines
}: MachineConsoleProps): JSX.Element {
  const [agentId, setAgentId] = useState<string | null>(
    initialAgentId ?? agents.find((a) => a.online)?.id ?? agents[0]?.id ?? null
  )
  const [cmd, setCmd] = useState('')
  const [history, setHistory] = useState<HistoryItem[]>([])
  /** Команда, которая идёт прямо сейчас; null — простой (её же ждёт «Стоп»). */
  const [running, setRunning] = useState<string | null>(null)
  /** Набранные команды по машине, когда historyStore не передали. */
  const [localCommands, setLocalCommands] = useState<Record<string, string[]>>({})
  /** Позиция в истории при листании ↑/↓; null — набираем свою строку. */
  const [histPos, setHistPos] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)
  /** Строка, которую затёрло листание: по ↓ за конец истории возвращаем её. */
  const draft = useRef('')
  const abort = useRef<AbortController | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const selectedAgent = agents.find((agent) => agent.id === agentId)
  const agentOnline = selectedAgent?.online ?? false
  const commands = agentId ? historyStore?.get(agentId) ?? localCommands[agentId] ?? [] : []

  /** Строка снова «своя», а не взятая из истории. */
  const resetNav = (): void => {
    setHistPos(null)
    draft.current = ''
  }

  /** Выполнить команду и дописать результат в историю (та же дорога у «Повторить»). */
  const runCommand = async (command: string): Promise<void> => {
    if (!command || !agentId || !agentOnline || running !== null) return
    if (historyStore) historyStore.push(agentId, command)
    else setLocalCommands((m) => ({ ...m, [agentId]: remember(m[agentId] ?? [], command) }))
    const ctrl = new AbortController()
    abort.current = ctrl
    setRunning(command)
    try {
      const res = await exec(agentId, command, ctrl.signal)
      setHistory((h) => [
        ...h,
        { command, output: res.output, exitCode: res.exitCode }
      ])
    } catch (err) {
      // Отмена — не ошибка выполнения: помечаем строку прерванной, чтобы было
      // видно, что вывода нет по нашей воле, а не из-за падения команды.
      setHistory((h) => [
        ...h,
        ctrl.signal.aborted
          ? { command, output: '', exitCode: null, cancelled: true }
          : {
              command,
              output: '',
              exitCode: null,
              error: err instanceof Error ? err.message : String(err)
            }
      ])
    } finally {
      abort.current = null
      setRunning(null)
    }
  }

  // Навык из шапки чата: консоль открыли ради одной команды — выполняем её один раз, как только машина в сети.
  const autoRan = useRef(false)
  useEffect(() => {
    if (!initialCommand || autoRan.current || !agentId || !agentOnline) return
    autoRan.current = true
    void runCommand(initialCommand)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCommand, agentId, agentOnline])

  const skills = selectedAgent?.policy.skills ?? []

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    const command = cmd.trim()
    if (!command || !agentId || running !== null) return
    setCmd('')
    resetNav()
    await runCommand(command)
  }

  /** «Стоп»: рвём запрос — по его закрытию сервер шлёт агенту `exec.cancel`. */
  const stop = (): void => abort.current?.abort()

  /** ↑/↓ по набранным ранее командам — как в шелле, с возвратом к своей строке. */
  const step = (dir: -1 | 1): void => {
    if (commands.length === 0) return
    if (dir === -1) {
      if (histPos === null) draft.current = cmd
      const next = histPos === null ? commands.length - 1 : Math.max(0, histPos - 1)
      setHistPos(next)
      setCmd(commands[next] ?? '')
      return
    }
    if (histPos === null) return
    const next = histPos + 1
    if (next >= commands.length) {
      setCmd(draft.current)
      resetNav()
      return
    }
    setHistPos(next)
    setCmd(commands[next] ?? '')
  }

  /**
   * Esc очищает строку ввода. В modal Esc забирает общий стек окон и до input не
   * доходит — там событие отдаёт `ToolFrame` через `onEscape`; у embedded-карточки
   * слоя нет, и Esc ловит сам input. Пустую строку не «съедаем»: тогда Esc
   * работает как обычно (свернуть разворот, закрыть окно).
   */
  const clearInput = (): boolean => {
    if (!cmd && histPos === null) return false
    setCmd('')
    resetNav()
    return true
  }

  const onKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      step(-1)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      step(1)
      return
    }
    // Иначе Esc ушёл бы дальше в глобальные хоткеи (отмена записи голоса).
    if (e.key === 'Escape' && clearInput()) e.stopPropagation()
  }

  /** Клик по строке «$ команда» — быстрый повтор: команда встаёт в поле ввода. */
  const fillFromHistory = (command: string): void => {
    setCmd(command)
    resetNav()
    input.current?.focus()
  }

  const copyOutput = (): void => {
    void copyText(consoleTranscript(history)).then((ok) => {
      if (!ok) return
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <ToolFrame
      title="Консоль машины"
      variant={variant}
      onClose={onClose}
      onEscape={clearInput}
      testId={variant === 'modal' ? 'console-overlay' : 'console-embed'}
      actions={
        <IconButton
          title="Копировать вывод"
          aria-label="Копировать вывод"
          disabled={history.length === 0}
          onClick={copyOutput}
        >
          {copied ? '✓' : '⧉'}
        </IconButton>
      }
    >
      <MachineUtilityHeader
        agents={agents}
        agentId={agentId}
        onAgentChange={(id) => {
          // У другой машины своя история — листание начинаем заново.
          setAgentId(id)
          resetNav()
        }}
        kind="console"
        consoleLabel="Консоль"
        dir={initialCwd}
        onSwitch={onSwitchUtility && agentId ? (next) => onSwitchUtility(next, agentId, initialCwd) : undefined}
        onOpenMachines={onOpenMachines}
      />

      <div className="consout" data-testid="console-output">
        {agents.length === 0 && (
          <EmptyState
            icon="💻"
            title="Нет машин — добавьте первую"
            description="Машина подключается в настройках: там выдаётся команда установки агента."
          />
        )}
        {agentId && !agentOnline && (
          <EmptyState
            icon="⏳"
            title={'Машина «' + (selectedAgent?.name ?? agentId) + '» переподключается'}
            description="Консоль станет доступна после восстановления соединения. Попробуйте снова через несколько секунд."
          />
        )}
        {agentOnline && history.length === 0 && running === null && (
          <EmptyState
            icon="▶"
            title="Команд ещё не было"
            description="Наберите команду в поле ниже — вывод и код возврата появятся здесь."
          />
        )}
        {history.map((h, i) => (
          <div className="conshist" key={i}>
            <button
              type="button"
              className="conscmd"
              title="Подставить команду в поле ввода"
              onClick={() => fillFromHistory(h.command)}
            >
              $ {h.command}
            </button>
            {h.output && <pre className="conspre">{h.output}</pre>}
            {h.cancelled && <p className="consnote">Отменено</p>}
            {h.error && (
              <ErrorState
                compact
                className="conserr"
                message="Команда не выполнилась"
                detail={h.error}
                onRetry={() => void runCommand(h.command)}
              />
            )}
            {!h.error && !h.cancelled && h.exitCode !== 0 && h.exitCode !== null && (
              <p className="conserr">exit {h.exitCode}</p>
            )}
          </div>
        ))}
        {running !== null && (
          <div className="conshist">
            <p className="conscmd">$ {running}</p>
            <p className="consrun">
              <RefreshIndicator label="Выполняю…" />
            </p>
          </div>
        )}
      </div>

      {skills.length > 0 && (
        <div className="consskills" data-testid="console-skills" aria-label="Сохранённые команды машины">
          {skills.map((skill) => (
            <button
              key={skill.name}
              type="button"
              className="consskill"
              title={skill.description ? `${skill.description}\n${skill.command}` : skill.command}
              disabled={!agentOnline || running !== null}
              onClick={() => void runCommand(skill.command)}
            >⚡ {skill.name}</button>
          ))}
        </div>
      )}
      <form className="consbar" onSubmit={submit}>
        <span className="consprompt">$</span>
        <input
          ref={input}
          className="consinput"
          aria-label="Команда"
          placeholder="команда…"
          value={cmd}
          // Пока команда идёт, ввод НЕ блокируем: следующую набирают заранее, а
          // текущую при желании обрывают «Стопом».
          disabled={!agentOnline}
          onChange={(e) => {
            setCmd(e.target.value)
            resetNav()
          }}
          onKeyDown={onKey}
        />
        {running !== null && (
          <IconButton size="sm" variant="danger" title="Стоп" aria-label="Стоп" onClick={stop}>
            ⏹
          </IconButton>
        )}
        <IconButton
          size="sm"
          type="submit"
          title="Выполнить команду"
          aria-label="Выполнить команду"
          loading={running !== null}
          disabled={!agentOnline || !cmd.trim()}
        >
          ▶
        </IconButton>
      </form>
    </ToolFrame>
  )
}
