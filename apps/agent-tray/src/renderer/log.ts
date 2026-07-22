// Окно журнала: статус подключения + поток выполненных команд.

const statusEl = document.getElementById('status') as HTMLSpanElement
const logEl = document.getElementById('log') as HTMLDivElement

const STATUS_TEXT: Record<AgentStateR['status'], string> = {
  connecting: '○ Подключение…',
  online: '● В сети',
  offline: '○ Офлайн',
  stopped: '⏸ Остановлено',
  unconfigured: '○ Не настроено'
}

function renderStatus(s: AgentStateR): void {
  statusEl.textContent = s.status === 'online' && s.name ? `● В сети — ${s.name}` : STATUS_TEXT[s.status]
}

function appendLine(line: string): void {
  const div = document.createElement('div')
  div.className = 'line'
  div.textContent = line
  logEl.appendChild(div)
  logEl.scrollTop = logEl.scrollHeight
}

void window.agent.getState().then((s) => {
  renderStatus(s)
  for (const line of s.log) appendLine(line)
})
window.agent.onLog(appendLine)
window.agent.onStatus(renderStatus)

export {}
