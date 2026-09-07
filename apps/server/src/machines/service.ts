// Порт `MachinesService` — поверхность реестра машин, которой пользуются потребители в ядре, канбане,
// Make и админке (docs/plans/machines-service.md, круг 1). Это ровно публичные методы `AgentRegistry`
// без `register`/`unregister`/`setImageHost` (их зовёт только WS агента внутри модуля машин).
// `AgentRegistry` удовлетворяет порту структурно (проверка типом в `machines/boundary.test.ts`);
// в режиме отдельного процесса машин тот же контракт реализует HTTP-клиент с зеркалом состояния.
//
// Синхронные чтения (`isOnline`, `nameOf`, `versionOf`, `telemetryOf`, `imageHostOf`, `onlineIds`,
// `ptyLive`, `ptyBufferText`, `ptyContextOf`) нарочно остаются синхронными: их десятки в горячих путях, и
// удалённая реализация отвечает из зеркала, которое процесс машин обновляет пушем.
import type {
  AgentHttpRequest, AgentHttpResponse, AgentImageHost, AgentPolicy, AgentTelemetry, FsResult, GitAccessRequest, GitAccessResult,
  MachineCommandRecord, PtyContext
} from '@voicechat/shared'
import type { ExecMeta, ExecResult, PtyEvent } from '../agents/registry.js'

export type { ExecMeta, ExecResult, PtyEvent }

/** Запись журнала команд, как её отдаёт реестр подписчикам `onCommand`. */
export type MachineCommandReport = Omit<MachineCommandRecord, 'id'> & { output: string }

export interface MachinesService {
  // --- состояние ---
  isOnline(agentId: string): boolean
  onlineIds(): Set<string>
  nameOf(agentId: string): string | undefined
  versionOf(agentId: string): string | undefined
  platformOf(agentId: string): string | undefined
  policyOf(agentId: string): AgentPolicy | undefined
  telemetryOf(agentId: string): AgentTelemetry | undefined
  imageHostOf(agentId: string): AgentImageHost | undefined
  waitForOnline(agentId: string, timeoutMs?: number): Promise<boolean>
  updatePolicy(agentId: string, policy: AgentPolicy): void
  disconnect(agentId: string): void
  // --- события ---
  onChange(cb: () => void): () => void
  onAgentReady(cb: (agentId: string) => Promise<void>): () => void
  onCommand(cb: (rec: MachineCommandReport) => Promise<void>): () => void
  // --- команды и файлы ---
  exec(agentId: string, command: string, timeoutMs: number, signal?: AbortSignal, meta?: ExecMeta): Promise<ExecResult>
  execStream(agentId: string, command: string, timeoutMs: number, onChunk: (data: string) => void, signal?: AbortSignal): Promise<ExecResult>
  cancelAll(agentId: string): void
  gitAccess(agentId: string, request: GitAccessRequest): Promise<GitAccessResult>
  fsList(agentId: string, path: string): Promise<FsResult>
  fsRead(agentId: string, path: string): Promise<FsResult>
  fsWrite(agentId: string, path: string, dataBase64: string): Promise<FsResult>
  fsMkdir(agentId: string, path: string): Promise<FsResult>
  fsDelete(agentId: string, path: string): Promise<FsResult>
  fsDeleteFileSafe(agentId: string, path: string): Promise<FsResult>
  fsTrash(agentId: string, path: string): Promise<FsResult>
  fsRename(agentId: string, from: string, to: string): Promise<FsResult>
  http(agentId: string, request: AgentHttpRequest): Promise<AgentHttpResponse>
  // --- PTY ---
  ptyStart(agentId: string, ptyId: string, cols: number, rows: number, cwd: string | undefined, emit: (e: PtyEvent) => void): void
  ptyInput(ptyId: string, data: string): void
  ptyResize(ptyId: string, cols: number, rows: number): void
  ptyDetach(ptyId: string): void
  ptyKill(ptyId: string): void
  ptyLive(ptyId: string): boolean
  ptyBufferText(ptyId: string): string | null
  ptyContextOf(ptyId: string): PtyContext | null
  // --- тоннели ---
  createTunnel(id: string, sourceAgentId: string, targetAgentId: string, targetPort: number, authorize?: () => Promise<boolean>, onClose?: () => Promise<void>): Promise<number>
  tunnelPort(id: string): number | null
  closeTunnel(id: string): boolean | Promise<boolean>
  closeTunnelsForTarget(agentId: string): void
}
