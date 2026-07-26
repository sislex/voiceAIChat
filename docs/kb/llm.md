---
title: LLM: claude/codex CLI, ходы, stream-json, gateway
updated: 2026-07-26
checked: 967d619
areas:
  - apps/server/src/claude
  - apps/server/src/codex
  - apps/server/src/turns.ts
  - apps/server/src/anthropic
  - apps/server/src/cc
  - apps/server/src/users/cliProfiles.ts
  - packages/shared/src/streamJson.ts
  - packages/shared/src/codexStream.ts
  - packages/shared/src/prompt.ts
  - packages/shared/src/tools.ts
  - packages/shared/src/questions.ts
  - packages/shared/src/images.ts
---

# LLM: claude/codex CLI, ходы, stream-json, gateway

## Модель вызывается как CLI, а не по API

`ClaudeCli` (`apps/server/src/claude/claudeCli.ts`) делает
`spawn('claude', ['-p', prompt, '--output-format', 'stream-json', '--verbose',
'--include-partial-messages', '--model', …])`, при необходимости
`--permission-mode` и `--resume <sessionId>`. `spawn` инжектируется — все тесты
работают на фейковом процессе, реальный CLI в тестах не запускается. Аналогично
`CodexCli` для `codex`; выбор движка — настройка `llmProvider`, а разговор может
переопределить движок и модель через `conversations.llm_provider`/`llm_model`
(`null` — наследовать настройки; при выборе codex без клиента codex ход
откатывается на claude, и модель разговора тогда игнорируется). Модель Claude
хода всегда клампится по роли пользователя.

Отсюда два следствия: (1) аутентификация — это `claude login` / `codex login` на
хосте или в контейнере, ключей в конфиге нет; (2) ошибки CLI переводятся в
человеческие сообщения (`ENOENT` → «установите Claude Code», stderr про
авторизацию → «выполните `claude login`»), не выбрасывай их наружу как есть.

Статус входа обоих CLI сервер отдаёт на `/api/auth/status`
(`apps/server/src/auth/loginStatus.ts`), UI опрашивает его раз в 30 с.

**У каждого пользователя свой HOME для CLI** (`apps/server/src/users/cliProfiles.ts`):
`<dataDir>/cli-users/<base64url(логин)>/` с `.claude` и `.codex` внутри. Из общего
HOME контейнера копируются только файлы авторизации и конфигурации — история,
`projects/` и `sessions/` не копируются, чтобы пользователи не видели чужие
сессии. `buildServer` передаёт движкам `profileHome(userId)`, поэтому наблюдатели
`/api/cc/*` и `/api/cx/*` читают транскрипты из профиля пользователя, а не из
`~/.claude`.

## Разбор потока

`packages/shared/src/streamJson.ts` — построчный парсер stream-json:
`session` (session_id + окружение хода), `delta` (текстовый дельта-токен),
`result` (итог + метаданные хода), `ignore`. Рядом —
`parseStreamJsonActivity`: **параллельный** разбор той же строки в
`ClaudeLogEntry` (Bash/Read/Edit, thinking, модель, режим, сырой JSON) для режима
консоли. Два парсера намеренно независимы: поток токенов не должен ломаться из-за
изменений в активности. Для codex — `codexStream.ts`.

`session_id` сохраняется в `conversations.claude_session_id`: следующий ход идёт
с `--resume`, поэтому в промпт кладётся только новая реплика (`buildPrompt`), а
не вся история. Полная история собирается `buildConversationPrompt` — когда
сессии CLI нет (новый разговор, потерянная сессия).

## Ход модели (`turns.ts`)

`TurnManager` процесс-глобальный: ход привязан к разговору, живёт сквозь reconnect,
рассылает события всем подключённым клиентам этого пользователя и сам пишет
результат в БД. Клиент при подключении получает `claude.active` со списком
незакрытых ходов и накопленным частичным текстом — так восстанавливается стрим
после F5. Модель хода зажимается по роли пользователя (`clampModelForRole`).

## Договорённости в тексте ответа (fenced-блоки)

Модель может завершить ответ fenced-блоком, который клиент вырезает и рендерит
виджетом:

- ` ```tool ` + JSON `{kind: 'console'|'explorer', agentId?}` → встроенная утилита
  по машине (`packages/shared/src/tools.ts`, подсказка модели — `TOOL_HINT`).
  Блок может добавить и само приложение, распознав команду пользователя
  (`detectOpenUtility`).
- ` ```questions ` + JSON-массив `{q, options, multi?}` → форма уточняющих
  вопросов; выбранные ответы уходят обычным сообщением пользователя
  (`packages/shared/src/questions.ts`).
- ` ```image ` + JSON `{path, agentId?, caption?}` → созданная моделью картинка
  прямо в сообщении (`packages/shared/src/images.ts`, подсказка — `IMAGE_HINT`).
  `path` — **абсолютный путь**, но лежать файл может в двух местах, и это
  главная грабля. Встроенные генераторы картинок самих CLI пишут **на сервер**, в
  профиль пользователя (Codex — `<профиль>/.codex/generated_images/<сессия>/<call-id>.png`),
  даже когда команды хода уходили на машину: CLI-то запущен в контейнере. Модель,
  создавшая файл своими руками на машине, наоборот, даёт путь её хоста. Поэтому
  Поэтому после хода сервер **перекладывает такие картинки на машину разговора**
  (`apps/server/src/imageRelocate.ts`): читает файл из своей области, пишет его
  через `fs.write` в `<корень машины>/.generated_images` и переписывает блок на
  путь машины + `agentId`. Дальше браузер берёт картинку прямо с машины по HTTP
  (см. `machines.md`), а сервер из цепочки уходит. Осечка на любом шаге (машина
  офлайн, запись запрещена) оставляет картинку серверной — тогда работает прежний
  путь: `MessageImage` без явного `agentId` спрашивает сервер
  (`GET /api/files/read`, мост `window.files`), при 404 читает с машины через
  `fs.read`, и показывает base64 как data-URL.
  Здесь же fallback по формату: обычная markdown-картинка с локальным путём
  распознаётся так же — модели пишут так по привычке, а браузер такой `src` не откроет.

  **Частичных кадров нет.** Codex шлёт единственное событие `image_generation_end`
  — уже с готовым файлом; ни старта, ни промежуточных версий картинки в потоке не
  бывает, так что «прогрессивный рендер» как в ChatGPT воспроизвести нечем. Вместо
  него `MessageImage` в живом ходе (`live`) показывает плитку-заглушку с бликом и
  **перечитывает файл раз в 700 мс**, пока ход не завершится: путь в тексте иногда
  появляется раньше, чем файл дописан, и без опроса это была бы вечная ошибка.
  Ошибку показываем, только когда ход закончился, а файла всё нет.

Все три парсера — чистые функции без DOM и сети, тесты рядом. Подсказки
навешиваются в `turns.ts` цепочкой `appendImageHint(appendToolHint(appendQuestionsHint(…)))`.

Служебные блоки **не озвучиваются**: `SERVICE_FENCES` в
`packages/shared/src/sentences.ts` (`tool`/`questions`/`image`) заставляет
`splitSpeakable` и `prepareTtsText` пропускать их молча, а не подставлять
заглушку «Далее пример кода». Заводишь новый служебный блок — добавь его туда,
иначе TTS начнёт его проговаривать.

## Наблюдатели сессий Claude Code и Codex

`apps/server/src/cc/ccSessions.ts` читает `<HOME профиля>/.claude/projects/<слаг>/<session-id>.jsonl`
(по файлу на разговор; HOME — профиль пользователя, см. выше) и отдаёт read-only
историю + live-tail (`cc.tail`).
Важные детали формата и грабли — в `docs/plans/CC_OBSERVER.md`: файлы бывают до
~10 МБ, поэтому для списка читается только «голова» файла (cwd + первый промпт),
полный разбор — при открытии транскрипта; реальный путь проекта берётся из `cwd`
события, а не из слага каталога. Codex-аналог — `apps/server/src/codex/codexSessions.ts`
(`cx.tail`).

## Anthropic-совместимый gateway (входящий)

`apps/server/src/anthropic/gateway.ts` поднимает `/v1/messages` и
`/v1/messages/count_tokens`, чтобы **внешний** Claude Code мог использовать этот
сервер как endpoint. Прокси прозрачный: тело не преобразуется (кроме
опционального маппинга имён моделей `VC_CLAUDE_MODEL_MAP`), поэтому сохраняются
tools, thinking, prompt caching, SSE и beta-заголовки. Backend — либо `upstream`
(проброс на реальный Anthropic-совместимый URL), либо `codex` (локальный CLI).
Без `VC_CLAUDE_UPSTREAM_URL` отвечает 503. Входящий gateway **не авторизуется** —
не открывай его наружу без прокси.

## Проброс Bash на машину пользователя

Когда ход идёт с выбранной машиной, встроенный Bash у claude выключается, а
вместо него подключается MCP-сервер `remote` (`apps/server/src/mcp/remoteBashMcp.ts`,
путь `/mcp/remote-bash`) с инструментом `bash`, выполняющим команду на агенте.
Эндпоинт stateless (свежий сервер и транспорт на каждый POST) и защищён секретом
процесса в query-параметре `k`. Детали политики — `machines.md`.
