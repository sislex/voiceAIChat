import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { AgentInfo } from '@sislexa/agent-contracts'
import type { RendererPtyBridge } from '@shared/ipc'
import { ToolFrame } from '@voicechat/ui-foundation/components/ToolFrame'
import { MachineUtilityHeader } from './MachineUtilityHeader'
import { EmptyState, Button, IconButton } from '@voicechat/ui-kit'
import { copyText } from '@voicechat/ui-foundation/lib/clipboard'
import { useCommandSource } from '@voicechat/ui-foundation/runtime'
import type { Command } from '@voicechat/ui-foundation/lib/commands'
import type { PtySessionStore, PtySessionTab, SwitchUtility, UtilityVariant } from '@voicechat/ui-foundation/components/machine'
import { ptySessionStore } from '../store/ptySessions'

export interface MachineTerminalProps {
  agents: AgentInfo[]
  initialAgentId?: string | null
  /** Начальный рабочий каталог PTY. */
  initialCwd?: string
  /** Явный проектный контекст для делегированной машины. */
  projectId?: string
  /** Мост живого PTY (web). */
  pty: RendererPtyBridge
  variant?: UtilityVariant
  onClose?: () => void
  /** Переключиться на проводник этой машины в её cwd (шапка утилиты). */
  onSwitchUtility?: SwitchUtility
  /** У рабочей копии есть панель кода — кнопка в переключателе шапки. */
  gitAvailable?: boolean
  /** Ссылка в раздел «Машины» из шапки утилиты. */
  onOpenMachines?: () => void
  /** Стор открытых сеансов (вкладок). По умолчанию — общий стор приложения. */
  sessions?: PtySessionStore
  /** Команда навыка: выполняется в сеансе запрошенной машины сразу после приглашения shell. */
  initialCommand?: string
}

/** Подпись вкладки: машина, номер сеанса (если их несколько) и каталог. */
function tabLabel(tab: PtySessionTab, tabs: PtySessionTab[], agents: AgentInfo[]): string {
  const name = agents.find((a) => a.id === tab.agentId)?.name ?? tab.agentId
  const sameMachine = tabs.filter((t) => t.agentId === tab.agentId)
  const num = sameMachine.length > 1 ? ` #${sameMachine.indexOf(tab) + 1}` : ''
  const dir = tab.cwd ? ` · ${tab.cwd.replace(/\/+$/, '').split('/').pop() || '/'}` : ''
  return `${name}${num}${dir}`
}

/** Представление одного присоединённого PTY-сеанса. Экспортируется для панели
 *  «Консоль с ассистентом», где ptyId детерминирован по разговору. */
export function TerminalView({ agentId, cwd, projectId, pty, ptyId, initialCommand }: { agentId: string; cwd?: string; projectId?: string; pty: RendererPtyBridge; ptyId: string ; initialCommand?: string}): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'live' | 'exited' | 'error'>('live')
  const [statusMsg, setStatusMsg] = useState('')
  const terminal = useRef<Terminal | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [searchResult, setSearchResult] = useState('')
  const [help, setHelp] = useState(false)
  const [wrap, setWrap] = useState(true)
  const wrapped = useRef(true)
  const fitView = useRef<() => void>(() => {})
  const searchPosition = useRef(-1)
  const [notice, setNotice] = useState('')
  const copy = (): void => {
    const term = terminal.current
    if (!term) return
    const lines: string[] = []
    for (let i = 0; i < term.buffer.active.length; i++) lines.push(term.buffer.active.getLine(i)?.translateToString(true) ?? '')
    void copyText(lines.join('\n')).then((ok) => setNotice(ok ? 'Вывод скопирован' : 'Не удалось скопировать вывод'))
  }
  const toggleWrap = (): void => { wrapped.current = !wrapped.current; setWrap(wrapped.current); fitView.current() }
  const actions: Command[] = [
    { id: `pty:${ptyId}:copy`, section: 'machine', title: 'Копировать вывод терминала', hotkey: 'mod+shift+c', run: copy },
    { id: `pty:${ptyId}:clear`, section: 'machine', title: 'Очистить экран терминала', hotkey: 'mod+shift+l', run: () => terminal.current?.clear() },
    { id: `pty:${ptyId}:find`, section: 'machine', title: 'Поиск в терминале', hotkey: 'mod+shift+f', run: () => setSearchOpen(true) },
    { id: `pty:${ptyId}:wrap`, section: 'machine', title: 'Перенос строк терминала', hotkey: 'mod+shift+w', run: toggleWrap }
  ]
  useCommandSource(() => actions)
  const actionRef = useRef(actions)
  actionRef.current = actions
  const find = (): void => {
    const term = terminal.current
    if (!term || !query) return
    for (let offset = 1; offset <= term.buffer.active.length; offset++) {
      const row = (searchPosition.current + offset) % term.buffer.active.length
      const line = term.buffer.active.getLine(row)
      const column = line?.translateToString(true).toLocaleLowerCase().indexOf(query.toLocaleLowerCase()) ?? -1
      if (column >= 0) { searchPosition.current = row; term.select(column, row, query.length); term.scrollToLine(row); setSearchResult('Совпадение найдено'); return }
    }
    setSearchResult('Нет совпадений')
  }

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 13,
      scrollback: 5000,
      allowProposedApi: true,
      theme: { background: '#0b0e14', foreground: '#d7dce5' }
    })
    terminal.current = term
    term.attachCustomKeyEventHandler?.((event) => {
      if (event.type !== 'keydown' || !(event.ctrlKey || event.metaKey) || !event.shiftKey) return true
      const action = actionRef.current.find((item) => item.hotkey === `mod+shift+${event.key.toLowerCase()}`)
      if (!action) return true
      event.preventDefault()
      action.run()
      return false
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    const doFit = (): void => {
      try {
        fit.fit()
        if (!wrapped.current) term.resize(1000, term.rows)
        pty.resize({ ptyId, cols: term.cols, rows: term.rows })
      } catch {
        /* контейнер ещё без размера */
      }
    }
    fitView.current = doFit
    doFit()
    const attach = (): void => pty.start({ agentId, ptyId, cols: term.cols, rows: term.rows, ...(cwd ? { cwd } : {}), ...(projectId ? { projectId } : {}) })
    const onData = term.onData((data) => pty.input({ ptyId, data }))
    // Навык из шапки чата: команду отправляем один раз, когда shell показал приглашение (первый вывод PTY).
    let pendingCommand = initialCommand
    const offOut = pty.onOutput((m) => {
      if (m.ptyId !== ptyId) return
      term.write(m.data)
      if (pendingCommand) {
        const command = pendingCommand
        pendingCommand = undefined
        setTimeout(() => pty.input({ ptyId, data: `${command}\r` }), 50)
      }
    })
    const offExit = pty.onExit((m) => {
      if (m.ptyId !== ptyId) return
      setStatus('exited')
      setStatusMsg(`Сеанс завершён${m.exitCode != null ? ` (код ${m.exitCode})` : ''}`)
    })
    const offErr = pty.onError((m) => {
      if (m.ptyId !== ptyId) return
      setStatus('error')
      setStatusMsg(m.message)
    })
    const ro = new ResizeObserver(() => {
      doFit()
      pty.resize({ ptyId, cols: term.cols, rows: term.rows })
    })
    ro.observe(host)
    const offConnected = pty.onConnected(attach)
    attach()
    // Не term.focus(): фокус textarea xterm заставляет браузер прокрутить предков с
    // overflow:hidden (в сплите Консоли колонка чата уезжала вверх на сотни px).
    term.textarea?.focus({ preventScroll: true })
    return () => {
      ro.disconnect()
      onData.dispose()
      offOut()
      offExit()
      offErr()
      offConnected()
      // PTY остаётся на сервере: при новом монтировании attach() вернёт его с буфером.
      terminal.current = null
      term.dispose()
    }
  }, [agentId, cwd, projectId, pty, ptyId])

  return (
    <div className="term-wrap">
      <div className="term-toolbar" role="group" aria-label="Управление терминалом">
        <Button size="sm" onClick={copy}>Копировать вывод</Button>
        <Button size="sm" onClick={() => terminal.current?.clear()}>Очистить экран</Button>
        <Button size="sm" onClick={() => setSearchOpen((value) => !value)}>Поиск</Button>
        <Button size="sm" aria-pressed={wrap} onClick={toggleWrap}>Перенос строк</Button>
        <IconButton size="sm" aria-label="Горячие клавиши терминала" title="Горячие клавиши терминала" onClick={() => setHelp((value) => !value)}>?</IconButton>
      </div>
      {help && <ul aria-label="Горячие клавиши терминала">{actions.map((action) => <li key={action.id}>{action.title}: {action.hotkey?.replace('mod', 'Ctrl/Cmd')}</li>)}</ul>}
      {searchOpen && <form onSubmit={(event) => { event.preventDefault(); find() }}><input aria-label="Поиск по буферу терминала" value={query} onChange={(event) => { setQuery(event.target.value); searchPosition.current = -1 }} /><Button type="submit" size="sm">Найти далее</Button><span role="status">{searchResult}</span></form>}
      {notice && <p role="status">{notice}</p>}
      <div style={{ overflowX: wrap ? 'hidden' : 'auto', display: 'flex', flex: 1, minHeight: 0 }}><div ref={hostRef} className="term-host" data-testid="terminal-host" /></div>
      {status !== 'live' && (
        <p className={status === 'error' ? 'term-status term-status--err' : 'term-status'}>{statusMsg}</p>
      )}
    </div>
  )
}

/** Настоящий терминал по машине (xterm + PTY). Реальный shell на машине агента. */
export function MachineTerminal({
  agents,
  initialAgentId,
  initialCwd,
  projectId,
  pty,
  variant = 'modal',
  onClose,
  onSwitchUtility,
  gitAvailable,
  onOpenMachines,
  sessions = ptySessionStore,
  initialCommand
}: MachineTerminalProps): JSX.Element {
  const { tabs, activeId } = useSyncExternalStore(sessions.subscribe, sessions.snapshot, sessions.snapshot)
  // Машина, которую просили открыть: её вкладка либо находится, либо заводится.
  const wantedAgentId = initialAgentId ?? agents.find((a) => a.online)?.id ?? agents[0]?.id ?? null
  useEffect(() => {
    if (!wantedAgentId) return
    const machine = agents.find((item) => item.id === wantedAgentId)
    if (!machine?.online || machine.access === 'read') { sessions.open(wantedAgentId, initialCwd); return }
    const snapshot = sessions.snapshot()
    const linked = snapshot.tabs.find((tab) => tab.ptyId === snapshot.activeId && tab.agentId === wantedAgentId)
    if (linked && initialCwd && linked.cwd !== initialCwd && sessions.setCwd && !/[\r\n\x00]/.test(initialCwd)) {
      const shell = machine.telemetry?.os.shell?.toLowerCase() ?? ''
      const cmdShell = shell.endsWith('cmd.exe')
      const powerShell = /(?:powershell|pwsh)(?:\.exe)?$/.test(shell)
      if (cmdShell && /["%!]/.test(initialCwd)) return
      const quoted = cmdShell ? `"${initialCwd}"` : "'" + initialCwd.replace(/'/g, powerShell ? "''" : "'\\''") + "'"
      const changeDirectory = cmdShell ? 'cd /d' : powerShell ? 'Set-Location -LiteralPath' : 'cd --'
      pty.input({ ptyId: linked.ptyId, data: `${changeDirectory} ${quoted}\r` })
      sessions.setCwd(linked.ptyId, initialCwd)
    } else sessions.open(wantedAgentId, initialCwd)
  }, [sessions, wantedAgentId, initialCwd])

  const active = tabs.find((t) => t.ptyId === activeId) ?? null
  const agentId = active?.agentId ?? null
  // Все вкладки закрыли — селектор и «Новый сеанс» продолжают показывать машину.
  const headerAgentId = agentId ?? wantedAgentId
  const selectedAgent = agents.find((agent) => agent.id === agentId)
  const agentOnline = Boolean(selectedAgent?.online && selectedAgent.access !== 'read')
  // Закрытие вкладки — единственное место, где PTY убивают: размонтирование
  // xterm (закрыли утилиту, переключили вкладку) сеанс не трогает.
  const closeTab = (ptyId: string): void => {
    pty.kill({ ptyId })
    sessions.close(ptyId)
  }

  return (
    <ToolFrame
      title="Терминал машины"
      variant={variant}
      onClose={onClose}
      testId={variant === 'modal' ? 'terminal-overlay' : 'terminal-embed'}
    >
      <MachineUtilityHeader
        agents={agents}
        agentId={headerAgentId}
        onAgentChange={(next) => sessions.open(next)}
        kind="terminal"
        dir={active?.cwd ?? initialCwd}
        gitAvailable={gitAvailable}
        onSwitch={onSwitchUtility && agentId ? (next) => onSwitchUtility(next, agentId, active?.cwd ?? initialCwd) : undefined}
        onOpenMachines={onOpenMachines}
      />
      {tabs.length > 0 && (
        <div className="term-tabs" role="group" aria-label="Сеансы терминала">
          {tabs.map((tab) => {
            const label = tabLabel(tab, tabs, agents)
            return (
              <span
                key={tab.ptyId}
                className={tab.ptyId === activeId ? 'term-tab term-tab--active' : 'term-tab'}
              >
                <button
                  type="button"
                  aria-pressed={tab.ptyId === activeId}
                  className="term-tab__name"
                  onClick={() => sessions.activate(tab.ptyId)}
                >
                  {label}
                </button>
                <button
                  type="button"
                  className="term-tab__close"
                  aria-label={`Закрыть сеанс: ${label}`}
                  title="Закрыть вкладку — сеанс на машине будет завершён"
                  onClick={() => closeTab(tab.ptyId)}
                >
                  ×
                </button>
              </span>
            )
          })}
        </div>
      )}
      {headerAgentId && (
        <div className="term-actions">
          <button type="button" onClick={() => sessions.create(headerAgentId, initialCwd)}>
            Новый сеанс
          </button>
          {active && (
            <button type="button" onClick={() => closeTab(active.ptyId)}>
              Завершить сеанс
            </button>
          )}
        </div>
      )}
      {agentId && !agentOnline ? (
        <EmptyState
          icon="⏳"
          title={selectedAgent?.access === 'read' ? 'Терминал недоступен: только чтение' : 'Машина «' + (selectedAgent?.name ?? agentId) + '» переподключается'}
          description={selectedAgent?.access === 'read' ? 'Доступ к этой машине не разрешает запуск shell.' : 'Терминал станет доступен после восстановления соединения. Попробуйте снова через несколько секунд.'}
        />
      ) : active && agentId ? (
        <TerminalView
          key={active.ptyId}
          agentId={agentId}
          {...(active.cwd ? { cwd: active.cwd } : {})}
          {...(projectId ? { projectId } : {})}
          pty={pty}
          ptyId={active.ptyId}
          initialCommand={active.agentId === wantedAgentId ? initialCommand : undefined}
        />
      ) : agents.length > 0 ? (
        <EmptyState
          icon="💻"
          title="Нет открытых сеансов"
          description="Нажмите «Новый сеанс», чтобы открыть shell на выбранной машине."
        />
      ) : (
        <EmptyState
          icon="💻"
          title="Нет машин — добавьте первую"
          description="Машина подключается в настройках: там выдаётся команда установки агента."
        />
      )}
    </ToolFrame>
  )
}
