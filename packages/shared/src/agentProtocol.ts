// Compatibility for released UI Foundation consumers; implementation belongs to Agent.
export * from '@sislexa/agent-contracts/agentProtocol'
export * from './devProcess'

/** Additive dev-lane wire extension until adopted by the Agent owner archive. */
export type AgentToServer = import('@sislexa/agent-contracts/agentProtocol').AgentToServer
  | import('./devProcess').DevProcessResponseMessage
export type ServerToAgent = import('@sislexa/agent-contracts/agentProtocol').ServerToAgent
  | import('./devProcess').DevProcessRequestMessage
