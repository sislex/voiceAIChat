// Тип моста window.agent (preload) — общий для окон setup и log.

interface AgentStateR {
  status: 'connecting' | 'online' | 'offline' | 'stopped' | 'unconfigured'
  name: string | null
  log: string[]
}

interface AgentSkillR {
  name: string
  command: string
  description?: string
}

interface AgentPolicyR {
  allowedDirs: string[]
  allowNetwork: boolean
  allowWrite: boolean
  denyPatterns: string[]
  allowPatterns: string[]
  skills: AgentSkillR[]
}

interface AgentBridgeR {
  submitConnection(str: string): Promise<{ ok: boolean; error?: string }>
  getState(): Promise<AgentStateR>
  onLog(cb: (line: string) => void): void
  onStatus(cb: (s: AgentStateR) => void): void
  getPolicy(): Promise<AgentPolicyR | null>
  setPolicy(policy: AgentPolicyR): Promise<void>
  onPolicy(cb: (policy: AgentPolicyR) => void): void
}

interface Window {
  agent: AgentBridgeR
}
