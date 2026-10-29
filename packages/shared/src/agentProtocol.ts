// Compatibility for released UI Foundation consumers; implementation belongs to Agent.
export * from '@sislexa/agent-contracts/agentProtocol'
export * from './devProcess'

type OwnerAgentToServer = import('@sislexa/agent-contracts/agentProtocol').AgentToServer
type OwnerAgentRegister = Extract<OwnerAgentToServer, { t: 'agent.register' }>

/** Android is supported by the Agent owner; the pinned archive predates that extension. */
export type AgentRegister = Omit<OwnerAgentRegister, 'supervisor'> & {
  supervisor?: OwnerAgentRegister['supervisor'] | 'android'
}

/** Additive wire extensions until adopted by the pinned Agent owner archive. */
export type AgentToServer = Exclude<OwnerAgentToServer, { t: 'agent.register' }>
  | AgentRegister
  | import('./devProcess').DevProcessResponseMessage
export type ServerToAgent = import('@sislexa/agent-contracts/agentProtocol').ServerToAgent
  | import('./devProcess').DevProcessRequestMessage
