// Контракт LLM: запрос хода, потоковые колбэки и протокол исполнителя.
//
// Живёт в shared, потому что у него два берега: сервер (`turns.ts`, CI, gateway)
// собирает `LlmRequest`, а исполнитель (`apps/llm-runner`) запускает по нему CLI.
// До выноса CLI в отдельный контейнер это был локальный интерфейс сервера
// (`apps/server/src/claude/types.ts` — теперь реэкспорт).

import type { ClaudeInitInfo, ClaudeLogEntry, TurnMeta, TurnUsage } from './types'
import type { LoginStatusMap } from './auth'

/** Одно вложение, которое сервер передаёт исполнителю байтами вместе с запросом. */
export interface LlmAttachment {
  /** Абсолютный путь, который уже зашит в prompt на стороне сервера. */
  serverPath: string
  /** Имя файла в каталоге рана исполнителя (без директорий). */
  runnerName: string
  /** Содержимое файла в base64. */
  dataBase64: string
  /**
   * Не подменять serverPath в prompt путём временной копии исполнителя.
   * Используется для файлов, чей авторитетный путь существует на выбранной машине:
   * модель должна передавать его remote-инструментам, а runner-копия остаётся
   * дополнительным визуальным входом CLI.
   */
  preserveServerPath?: boolean
}

export interface LlmRequest {
  /** Владелец CLI-профиля: история одного пользователя не смешивается с другими. */
  userId?: string
  /** Готовый текст промпта (сборка — на стороне вызывающего: см. session.ts). */
  prompt: string
  /** session-id Claude для продолжения разговора (null — новый/сброшенный). */
  sessionId: string | null
  /** Модель для CLI (алиас, напр. 'sonnet' | 'opus'). */
  model: string
  /** Режим прав агента (`--permission-mode`); undefined — не передавать флаг. */
  permissionMode?: string
  /** Желаемый рабочий каталог процесса CLI; исполнитель сам решает, применим ли он. */
  cwd?: string
  /**
   * Вложения для удалённого исполнителя: он кладёт их в temp-каталог рана и
   * подменяет пути `serverPath` → локальный путь из этого каталога прямо в prompt.
   */
  attachments?: LlmAttachment[]
  /** Удалённое выполнение Bash через MCP-мост; undefined — Bash на сервере. */
  /** true — shell-команды запрещены полностью, даже на сервере. */
  executionDisabled?: boolean
  /**
   * true — remote-инструменты доступны, но только для чтения (фаза плана CI):
   * модель исследует рабочую копию на машине, но ничего в ней не меняет.
   */
  readOnlyRemote?: boolean
  /**
   * URL MCP-эндпоинта базы знаний (инструменты mcp__kb__*) с секретом и токеном
   * хода. Передаётся и БЕЗ `remote`: БЗ read-only и от машины не зависит.
   */
  kbMcpUrl?: string
  /**
   * Режим БЗ разговора для системного хинта: 'manual' — авто-контекста нет,
   * инструменты единственный путь к базе (усиленная формулировка).
   */
  kbMode?: 'auto' | 'manual'
  /**
   * URL MCP-эндпоинта действий веб-превью (инструменты mcp__browser__*) с
   * секретом и токеном хода. Есть только у хода разговора: действия идут через
   * подключённый клиент этого пользователя и его активную панель превью.
   */
  previewMcpUrl?: string
  remote?: {
    /** URL MCP-эндпоинта с agent id и секретом в query. */
    mcpUrl: string
    /** Имя машины для системного промпта. */
    agentName: string
    /** Краткое описание политики машины для системного промпта (что разрешено). */
    policySummary?: string
    /** URL MCP-эндпоинта команд CI-справочника (инструмент модели), если доступен. */
    ciMcpUrl?: string
    /**
     * Имена ДРУГИХ доступных машин проекта — для системного промпта. Модель может
     * адресовать им операцию параметром `machine` remote-инструментов; сам список
     * с онлайн-статусом отдаёт инструмент `machines` MCP-моста. Отсутствие поля —
     * доступна только выбранная машина (ход вне проекта или машина одна).
     */
    projectMachines?: string[]
  }
}

/** Колбэки потокового ответа. Ровно один из onDone/onError вызывается в конце. */
export interface LlmStreamHandlers {
  /** Очередной фрагмент текста ответа. */
  onDelta(text: string): void
  /** session-id, полученный от CLI (сохранить в БД для --resume). */
  onSession(sessionId: string): void
  /** Окружение хода из system/init (инструменты/навыки/mcp) — необязательно. */
  onInit?(info: ClaudeInitInfo): void
  /** Успешное завершение с полным текстом ответа и метаданными хода. */
  onDone(fullText: string, meta?: TurnMeta): void
  /** Ошибка (CLI не найден / не залогинен / ненулевой код и т.п.). */
  onError(message: string): void
  /** Запись активности агента (режим консоли) — необязательно. */
  onActivity?(entry: ClaudeLogEntry): void
  /** Накопленные счётчики токенов хода (кумулятивные, растут по мере ответа). */
  onUsage?(usage: TurnUsage): void
}

export interface LlmHandle {
  /** Прервать текущий запрос (barge-in/смена разговора). */
  cancel(): void
}

/** Клиент к LLM. Потоковый: результаты приходят через handlers. */
export interface LlmClient {
  send(req: LlmRequest, handlers: LlmStreamHandlers): LlmHandle
}

// ---------------------------------------------------------------------------
// Протокол исполнителя (apps/llm-runner), версия v1
// ---------------------------------------------------------------------------

/** Какой CLI запускает исполнитель. */
export type LlmRunKind = 'claude' | 'codex'

/** Пути протокола исполнителя — один источник для клиента и самого исполнителя. */
export const LLM_RUNNER = {
  /** Запуск хода; отмена — DELETE на `${run}/<id>`. */
  run: '/v1/run',
  health: '/v1/health'
} as const

/** Заголовок ответа `/v1/run` с id рана — им же адресуется отмена. */
export const LLM_RUN_ID_HEADER = 'x-run-id'

/** Тело `POST /v1/run`: запрос хода плюс выбор CLI и (необязательно) id рана. */
export interface LlmRunBody extends LlmRequest {
  kind: LlmRunKind
  /**
   * id рана для `DELETE /v1/run/:id`. Клиент задаёт его сам, чтобы уметь отменить
   * ход, не дождавшись заголовков ответа; без него исполнитель сгенерирует свой.
   */
  runId?: string
}

/**
 * Кадр NDJSON-ответа `/v1/run`: сырая строка stdout/stderr CLI и код выхода.
 * Исполнитель ничего не разбирает — stream-json/JSONL парсит сервер, иначе
 * протокол пришлось бы менять при каждом изменении формата вывода CLI.
 */
export type LlmRunFrame =
  | { t: 'out'; s: string }
  | { t: 'err'; s: string }
  | { t: 'exit'; code: number | null }

/** Разбор строки NDJSON-потока исполнителя; null — мусор (кадр игнорируется). */
export function parseLlmRunFrame(line: string): LlmRunFrame | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return null
  }
  // `null`/число/строка — валидный JSON, но не конверт: без этой проверки обращение
  // к полю уронило бы весь ход на одной мусорной строке потока.
  if (!parsed || typeof parsed !== 'object') return null
  const frame = parsed as { t?: unknown; s?: unknown; code?: unknown }
  if (frame.t === 'out' || frame.t === 'err') {
    return typeof frame.s === 'string' ? { t: frame.t, s: frame.s } : null
  }
  if (frame.t === 'exit') {
    return { t: 'exit', code: typeof frame.code === 'number' ? frame.code : null }
  }
  return null
}

/** Состояние одного CLI в `GET /v1/health`. */
export interface LlmRunnerBinStatus {
  /** Бинарь найден и ответил на `--version`. */
  present: boolean
  /** Строка версии как её отдал CLI (null — получить не удалось). */
  version: string | null
}

/** Ответ `GET /v1/health` исполнителя. */
export interface LlmRunnerHealth {
  ok: boolean
  bins: Record<LlmRunKind, LlmRunnerBinStatus>
  /** Статус входа обоих CLI в общем профиле исполнителя. */
  login: LoginStatusMap
  /** Сколько ранов исполняется прямо сейчас. */
  runs: number
}
