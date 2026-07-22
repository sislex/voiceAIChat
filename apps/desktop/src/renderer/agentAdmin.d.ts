// Тип моста window.agentAdmin (preload) — для окон режима агента.

interface AgentAdminStateR {
  status: 'connecting' | 'online' | 'offline' | 'stopped' | 'unconfigured'
  name: string | null
  log: string[]
}

interface AgentAdminBridge {
  submitConnection(str: string): Promise<{ ok: boolean; error?: string }>
  getState(): Promise<AgentAdminStateR>
  onLog(cb: (line: string) => void): () => void
  onStatus(cb: (s: AgentAdminStateR) => void): () => void
}

interface Window {
  agentAdmin: AgentAdminBridge
}
