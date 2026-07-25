---
title: LLM: claude/codex CLI, ходы, stream-json, gateway
updated: 2026-07-26
areas:
  - apps/server/src/claude
  - apps/server/src/codex
  - apps/server/src/turns.ts
  - apps/server/src/anthropic
  - apps/server/src/cc
  - packages/shared/src/streamJson.ts
  - packages/shared/src/codexStream.ts
  - packages/shared/src/prompt.ts
  - packages/shared/src/tools.ts
  - packages/shared/src/questions.ts
---

# LLM: claude/codex CLI, ходы, stream-json, gateway

## Модель вызывается как CLI, а не по API

`ClaudeCli` (`apps/server/src/claude/claudeCli.ts`) делает
`spawn('claude', ['-p', prompt, '--output-format', 'stream-json', '--verbose',
'--include-partial-messages', '--model', …])`, при необходимости
`--permission-mode` и `--resume <sessionId>`. `spawn` инжектируется — все тесты
работают на фейковом процессе, реальный CLI в тестах не запускается. Аналогично
`CodexCli` для `codex`; выбор движка — настройка `llmProvider`.

Отсюда два следствия: (1) аутентификация — это `claude login` / `codex login` на
хосте или в контейнере, ключей в конфиге нет; (2) ошибки CLI переводятся в
человеческие сообщения (`ENOENT` → «установите Claude Code», stderr про
авторизацию → «выполните `claude login`»), не выбрасывай их наружу как есть.

Статус входа обоих CLI сервер отдаёт на `/api/auth/status`
(`apps/server/src/auth/loginStatus.ts`), UI опрашивает его раз в 30 с.

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

Оба парсера — чистые функции без DOM и сети, тесты рядом.

## Наблюдатели сессий Claude Code и Codex

`apps/server/src/cc/ccSessions.ts` читает `~/.claude/projects/<слаг>/<session-id>.jsonl`
(по файлу на разговор) и отдаёт read-only историю + live-tail (`cc.tail`).
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
