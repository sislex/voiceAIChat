// Конфигурация исполнителя LLM из окружения. Отдельный процесс/контейнер, поэтому
// и env свой: с конфигом сервера пересекается только `VC_DATA_DIR` (профили CLI).

import { homedir } from 'node:os'
import { join } from 'node:path'

export interface RunnerConfig {
  host: string
  port: number
  /**
   * Bearer-токен исполнителя. Пустой означает «не настроен» — `index.ts` тогда не
   * стартует: открытый /v1/run отдал бы shell на машине любому, кто дотянулся до порта.
   */
  token: string
  /** Каталог данных: внутри — профили CLI `cli-users/<base64url(логин)>`. */
  dataDir: string
  /** Общий HOME исполнителя: из него сидируются профили и читается статус логина. */
  home: string
  /** Имя/путь бинаря Claude Code CLI. */
  claudeBin: string
  /** Имя/путь бинаря Codex CLI. */
  codexBin: string
  /**
   * Сколько ждать, пока клиент вычитает поток `/v1/run`, прежде чем убить CLI.
   * Защита от сироты: сервер перезапустился, ход читать некому, а токены горят.
   */
  orphanMs: number
}

const DEFAULT_DATA_DIR = join(homedir(), '.voicechat-runner')

export function loadRunnerConfig(env: NodeJS.ProcessEnv = process.env): RunnerConfig {
  return {
    host: env.HOST ?? '0.0.0.0',
    port: Number(env.PORT ?? 8790),
    token: env.VC_RUNNER_TOKEN ?? '',
    dataDir: env.VC_DATA_DIR ?? DEFAULT_DATA_DIR,
    home: env.HOME ?? homedir(),
    claudeBin: env.VC_CLAUDE_BIN ?? 'claude',
    codexBin: env.VC_CODEX_BIN ?? 'codex',
    orphanMs: Number(env.VC_RUNNER_ORPHAN_MS ?? 30_000)
  }
}
