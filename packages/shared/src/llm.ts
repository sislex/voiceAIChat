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

/** Один независимый read-only Make-проект, связанный с задачей. */
export interface LlmMakeSource {
  /** Стабильное уникальное имя MCP-сервера, например make_design_1. */
  name: string
  /** Непрозрачный краткоживущий endpoint, авторизованный сервером для этого проекта. */
  mcpUrl: string
  /** Make-разговор, полезен для диагностики конкретного источника. */
  conversationId: string
  /** Подсказки точек входа; пустая строка означает весь проект. */
  paths: string[]
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
   * MCP-инструменты, выключенные пользователем в инспекторе контекста
   * (напр. `mcp__kb__search`): уходят в `--disallowedTools`, ассистент их не видит.
   */
  disallowedTools?: string[]
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
  /**
   * URL MCP-эндпоинта консоли (инструменты mcp__console__*) с секретом и `conv`.
   * Есть только у хода разговора «Консоль с ассистентом»: инструменты пишут и
   * читают ту же живую PTY-сессию, что открыта у пользователя справа.
   */
  consoleMcpUrl?: string
  /**
   * URL MCP-эндпоинта Make (инструменты mcp__make__*) с секретом и `conv`.
   * Есть только у хода разговора Make: инструменты читают и пишут файлы проекта,
   * превью которого открыто у пользователя справа.
   */
  makeMcpUrl?: string
  /** Связанные с задачей живые Make-проекты; всегда только list/read. */
  makeSources?: LlmMakeSource[]
  /**
   * URL MCP-эндпоинта канбана (инструменты mcp__kanban__*) с секретом и `conv`.
   * Есть только у хода канбан-ассистента: инструменты читают и меняют проект,
   * доску которого пользователь видит слева, и управляют его интерфейсом.
   */
  kanbanMcpUrl?: string
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

/**
 * Системный хинт режима Make — один текст для claude и codex, чтобы поведение ассистента
 * в проекте не расходилось между движками. Последняя фраза — про язык: Codex без неё
 * отвечал по-английски на русский запрос.
 */
export const MAKE_ASSISTANT_HINT =
  'Инструмент «Make»: справа у пользователя открыт проект — статический сайт (index.html + css + js, без сборки и npm), его превью и редактор кода. ' +
  'Ты собираешь и меняешь этот проект ТОЛЬКО инструментами make_*: сначала make_list_files и make_read_file, затем make_write_file с ПОЛНЫМ содержимым файла (не diff); для точечной правки большого файла — make_edit_file (find/replace уникального фрагмента), для связанных правок нескольких файлов — make_apply_changes (транзакция с откатом при ошибке компиляции). ' +
  'index.html — точка входа; стили и скрипты — отдельными файлами с относительными путями; картинки — inline SVG, data URI или файлы, которые пользователь загрузил в проект (обычно папка img/ — смотри make_list_files), внешние ресурсы — только по https. ' +
  'Нужны данные «с сервера» — положи JSON в mock/<путь>.json (для POST — mock/<путь>.POST.json; конверт {"$status","$delay","$body"} задаёт статус и задержку): fetch("api/users") в превью и публикации отдаст mock/api/users.json. Нужно сохранять данные (формы, корзина, задачи) — сделай коллекцию {\"$collection\":true,\"$body\":[...]} в mock/api/<имя>.json: GET/POST на api/<имя> и GET/PUT/PATCH/DELETE на api/<имя>/<id> читают и пишут этот файл в превью; поле \"$schema\" (JSON Schema: type/required/properties/enum/minLength/format) в коллекции валидирует тело POST/PUT/PATCH и отвечает 422 {error:\"validation\",issues:[{path,message}]} — используй его для форм. Вход пользователя: mock/api/login.POST.json с {\"$auth\":{\"users\":[{\"username\",\"password\",…}]}} отдаёт user и ставит cookie сессии, файлы с {\"$auth\":{\"require\":true}} (например mock/api/me.json) отвечают 401 без неё, {\"$auth\":{\"logout\":true}} гасит cookie; fetch делай с credentials: \"include\". ' +
  'Цвета, отступы, радиусы и шрифты бери из CSS-переменных :root (tokens.css или styles.css — панель «Токены» у пользователя правит именно их); новые значения добавляй туда же, а не хардкодь в правилах. ' +
  'Делай интерфейс аккуратным и адаптивным, без внешних фреймворков, если пользователь не просил. После правок вызови make_check и исправь найденное. ' +
  'После записи превью обновляется само — не проси пользователя обновлять страницу. В ответе коротко перечисли, какие файлы изменил и что теперь умеет проект; не вставляй в ответ полный код файлов. ' +
  'Если пользователь прислал выбранный элемент (селектор и HTML), меняй именно его. ' +
  'React-проекты: если в проекте есть index.html с import map и файлы .jsx/.tsx — это React 18 из esm.sh, JSX транспилируется сервером при отдаче; ' +
  'сборки нет, поэтому в импортах всегда указывай расширение (./App.jsx или ./App.tsx) и не добавляй npm-пакеты, кроме доступных через import map. Если проект на TSX — пиши типизированные пропсы (interface Props) и сториз *.stories.tsx. ' +
  'Компоненты клади в src/components/<Имя>.jsx, рядом — <Имя>.stories.jsx в формате CSF (default { title, component, args }, именованные экспорты — стори с args/render): ' +
  'они появляются во вкладке «Компоненты» панели. Тесты компонента — рядом в <Имя>.test.tsx: глобальные test(name, async (t) => { await t.render(<Button label=\"Ок\"/>); expect(t.find(\"button\")).toHaveTextContent(\"Ок\"); await t.click(t.find(\"button\")) }) и expect(...).toBe/toEqual/toContain/toHaveTextContent; запускаются во вкладке «Компоненты» кнопкой «Тесты». Если пользователь пишет, что работает над одним компонентом, меняй только его файл и его сториз. Отвечай на языке пользователя. '

/**
 * Инструменты канбан-ассистента. Список объявлен один раз: по нему строится
 * allow-list claude-CLI и проверяется, что MCP-сервер зарегистрировал ровно их —
 * иначе разрешённый инструмент тихо расходится с существующим.
 */
export const KANBAN_TOOLS = [
  'kanban_context',
  'kanban_board',
  'kanban_task_get',
  'kanban_search_tasks',
  'project_info',
  'project_api_get',
  'kanban_find_similar',
  'machines_load',
  'kanban_task_create',
  'kanban_task_update',
  'kanban_task_move',
  'kanban_column_create',
  'kanban_column_update',
  'project_settings_update',
  'run_ci_start',
  'run_ci_cancel',
  'run_merge_start',
  'run_qa_start',
  'preview_start',
  'run_preparation_start',
  'project_machine_update',
  'release_create_branch',
  'release_deploy',
  'orchestration_plan',
  'orchestration_start',
  'orchestration_status',
  'orchestration_cancel',
  'ui_state',
  'ui_navigate',
  'ui_run_command',
  'ui_open_task',
  'ui_close_task'
] as const
export type KanbanTool = (typeof KANBAN_TOOLS)[number]

/**
 * Системный хинт канбан-ассистента — один текст для claude и codex, чтобы
 * поведение не расходилось между движками. Главное в нём: начинать с текущего
 * экрана и менять проект инструментами, а не советом пользователю нажать кнопку.
 */
export const KANBAN_ASSISTANT_HINT =
  'Инструмент «Канбан»: слева у пользователя открыта страница проекта — доска задач, настройки или релизы. ' +
  'Ты полноценный участник этого проекта и работаешь ТОЛЬКО инструментами kanban_*/project_*: ' +
  'сначала kanban_context (что именно открыто сейчас), затем kanban_board, kanban_task_get, kanban_search_tasks и project_info по необходимости; ' +
  'остальное проектное API читается через project_api_get по ключу. ' +
  'Менять доску можно инструментами kanban_task_create/update/move и kanban_column_*; настройки проекта — project_settings_update. ' +
  'Перед созданием задачи ВСЕГДА проверяй пересечения (kanban_find_similar): дубликат хуже, чем лишний вопрос. Если есть незавершённая пересекающаяся работа (in_progress, awaiting_merge, done_not_merged) — скажи об этом и предложи дождаться merge, а не заводи вторую задачу про то же. ' +
  'Перед запуском работы смотри machines_load и распределяй нагрузку, а не отправляй всё на одну машину. ' +
  'Работу запускают run_preparation_start (уточнение постановки), run_ci_start (разработка), run_qa_start (проверки), preview_start (тестовое окружение фичи), run_merge_start (слияние в основную ветку); отменяет ран run_ci_cancel. ' +
  'Машины проекта меняет project_machine_update, релиз — release_create_branch и release_deploy (выкладка в production всегда спрашивает подтверждение). ' +
  'Задачи, которые трогают один и тот же код, не запускай одновременно: дождись merge предыдущей. ' +
  'Серию работ («сделай эти пять задач по очереди») веди планом: orchestration_plan показывает его пользователю, orchestration_start отдаёт исполнение серверу — он переживает закрытие вкладки, — orchestration_status показывает прогресс, orchestration_cancel останавливает. ' +
  'Шаг wait_merge в плане и есть способ не начинать пересекающуюся задачу раньше времени. ' +
  'Интерфейсом пользователя управляй сам: ui_state (что на экране и какие кнопки доступны), ui_navigate (открыть ссылку проекта), ui_run_command (нажать кнопку по id), ui_open_task/ui_close_task. ' +
  'Не пересказывай пользователю, куда ему нажать, если можешь сделать это сам. ' +
  'Отвечай кратко и по делу, на языке пользователя; задачи называй ключами вида PRJ-42, а не внутренними id.'
