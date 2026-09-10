// `MakeService` для ядра в режиме `remote`: Make живёт отдельным процессом. Контекст промпта,
// список файлов и статистика — RPC к Make (`/internal/service`); scope-токены рана считаются здесь
// (нужны только секрет и адрес MCP); снимки хода и кадры `make.changed` приходят от Make событиями
// в локальную шину — сокеты пользователей живут у ядра, и `subscribe`/`turnSnapshot` остаются
// синхронными, как во встроенном режиме.

import {
  INTERNAL_MAKE_SERVICE_PATH, MakeHub, buildTaskMakeSources, createRpcClient,
  type MakeService
} from '@voicechat/make-contracts'
import type { AdminMakeStats, MakeFileInfo } from '@voicechat/shared'

export interface RemoteMakeOptions {
  makeUrl: string
  token: string
  mcpSecret: string
  mcpBaseUrl?: string
  fetchImpl?: typeof fetch
}

export interface RemoteMake { service: MakeService; hub: MakeHub }

export function createRemoteMake(opts: RemoteMakeOptions): RemoteMake {
  const rpc = createRpcClient({ baseUrl: opts.makeUrl, token: opts.token, path: INTERNAL_MAKE_SERVICE_PATH, fetchImpl: opts.fetchImpl })
  const hub = new MakeHub()
  const service: MakeService = {
    promptContext: (conversationId) => rpc<string>('promptContext', conversationId),
    turnSnapshot: (turn) => hub.turnSnapshot(turn),
    listFiles: (conversationId) => rpc<MakeFileInfo[]>('listFiles', conversationId),
    taskSources: (args) => buildTaskMakeSources({ ...args, baseUrl: opts.mcpBaseUrl, secret: opts.mcpSecret }),
    adminStats: () => rpc<AdminMakeStats>('adminStats'),
    metrics: () => rpc<string>('metrics'),
    sweep: () => rpc<{ projects: number; snapshots: number; shots: number }>('sweep'),
    subscribe: (userId, sink) => hub.subscribe(userId, sink)
  }
  return { service, hub }
}
