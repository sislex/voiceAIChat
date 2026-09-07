// Внутренний протокол «ядро ↔ процесс машин» для режима `VC_MACHINES_MODE=remote`
// (docs/plans/machines-service.md, круг 2). Направление обратное канбану: процесс машин — провайдер, ядро
// (а через его порты — канбан и Make) — потребитель. Вызовы идут RPC и потоковым exec к процессу машин;
// обратно к ядру — одна шина событий на постоянном WebSocket: снимки машин и PTY-сессий для синхронных
// чтений из зеркала, события PTY, кадры владельцам (журнал команд, watchdog), запросы авторизации тоннелей.
import type { AgentImageHost, AgentPolicy, AgentTelemetry, PtyContext, ServerMessage } from '@voicechat/shared'
import type { MachineCommandReport, MachinesService, PtyEvent } from './service.js'

/** У процесса машин. */
export const MACHINES_INTERNAL_RPC_PATH = '/internal/rpc'
export const MACHINES_INTERNAL_EXEC_STREAM_PATH = '/internal/exec-stream'
export const MACHINES_INTERNAL_EVENTS_PATH = '/internal/events'
export const MACHINES_HEALTH_PATH = '/v1/health'

/** Онлайн-машина глазами зеркала: всё, что потребители читают синхронно. */
export interface MachineState {
  id: string
  name: string
  version: string
  platform?: string
  policy: AgentPolicy
  telemetry?: AgentTelemetry
  imageHost?: AgentImageHost
}
/** Живая PTY-сессия глазами зеркала. */
export interface PtyState { ptyId: string; agentId: string; context: PtyContext | null }
export interface MachinesSnapshot { machines: MachineState[]; ptys: PtyState[] }

/** Процесс машин → ядро. */
export type MachinesEvent =
  | { kind: 'machines'; machines: MachineState[] }
  | { kind: 'ptys'; ptys: PtyState[] }
  | { kind: 'pty'; event: PtyEvent }
  | { kind: 'frame'; message: ServerMessage; userId: string }
  | { kind: 'agentReady'; agentId: string }
  | { kind: 'command'; report: MachineCommandReport }
  | { kind: 'tunnelAuthorize'; requestId: string; id: string }
  | { kind: 'tunnelClosed'; id: string }
/** Ядро → процесс машин (по той же шине). */
export type MachinesClientMessage = { kind: 'tunnelAuthorizeResult'; requestId: string; ok: boolean }

/** Методы порта по RPC; `exec`/`execStream` — потоковым эндпоинтом, синхронные чтения — из зеркала. */
export const MACHINES_RPC_METHODS = [
  'waitForOnline', 'updatePolicy', 'disconnect', 'cancelAll', 'gitAccess',
  'fsList', 'fsRead', 'fsWrite', 'fsMkdir', 'fsDelete', 'fsDeleteFileSafe', 'fsTrash', 'fsRename', 'http',
  'ptyStart', 'ptyInput', 'ptyResize', 'ptyDetach', 'ptyKill',
  'createTunnel', 'closeTunnel', 'closeTunnelsForTarget', 'snapshot'
] as const
export type MachinesRpcMethod = (typeof MACHINES_RPC_METHODS)[number]

/** Ошибка RPC несёт код файловой операции, чтобы потребитель восстановил `AgentFsError` (`ENOENT` и т. п.). */
export interface MachinesRpcErrorBody { error: string; code?: string }

/** Снимок машин из порта (у процесса машин — из реестра). */
export function machineStates(machines: Pick<MachinesService, 'onlineIds' | 'nameOf' | 'versionOf' | 'platformOf' | 'policyOf' | 'telemetryOf' | 'imageHostOf'>): MachineState[] {
  return [...machines.onlineIds()].map((id) => {
    const state: MachineState = { id, name: machines.nameOf(id) ?? id, version: machines.versionOf(id) ?? '0.1.0', policy: machines.policyOf(id) ?? ({} as AgentPolicy) }
    const platform = machines.platformOf(id); if (platform !== undefined) state.platform = platform
    const telemetry = machines.telemetryOf(id); if (telemetry !== undefined) state.telemetry = telemetry
    const imageHost = machines.imageHostOf(id); if (imageHost !== undefined) state.imageHost = imageHost
    return state
  })
}
