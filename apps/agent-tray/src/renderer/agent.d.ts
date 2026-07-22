// Тип моста window.agent (preload) — общий для окон setup и log.

interface AgentStateR {
  status: 'connecting' | 'online' | 'offline' | 'stopped' | 'unconfigured'
  name: string | null
  log: string[]
}

interface AgentBridgeR {
  submitConnection(str: string): Promise<{ ok: boolean; error?: string }>
  getState(): Promise<AgentStateR>
  onLog(cb: (line: string) => void): void
  onStatus(cb: (s: AgentStateR) => void): void
}

interface Window {
  agent: AgentBridgeR
}
