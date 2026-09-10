// Порт «что ядру нужно от Make». Обратная сторона `core.ts`: ход модели берёт контекст
// проекта в промпт и id снимка «до правок», CI и подготовка задачи — scope-токены на дизайны,
// роуты канбана — список файлов для проверки путей, админка — расход диска. Ядро знает Make
// только через этот интерфейс; сборка реализации — `make/module.ts`.

import type { AdminMakeStats, LlmMakeSource, MakeFileInfo, ServerMessage } from '@voicechat/shared'
import type { TaskMakeSourcesArgs } from './taskScope.js'

export interface MakeService {
  /** Дизайн-токены и открытые комментарии проекта — блок промпта Make-чата; пустая строка, если нечего сказать. */
  promptContext(conversationId: string): Promise<string>
  /** Снимок «До правок ассистента», сделанный в этом ходе, — для `meta.makeSnapshotId`. */
  turnSnapshot(turn: string): string | undefined
  listFiles(conversationId: string): Promise<MakeFileInfo[]>
  /** Make-источники рана задачи: URL MCP с scope-токеном на каждый дизайн; пусто, если MCP Make не настроен. */
  taskSources(args: TaskMakeSourcesArgs): LlmMakeSource[]
  adminStats(): Promise<AdminMakeStats>
  /** Те же цифры в формате Prometheus. */
  metrics(): Promise<string>
  sweep(): Promise<{ projects: number; snapshots: number; shots: number }>
  /** Кадры `make.changed` / `make.presence` пользователя — подписка WS-сессии. */
  subscribe(userId: string, sink: (m: ServerMessage) => void): () => void
}
