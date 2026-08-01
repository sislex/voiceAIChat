---
title: Backend изнутри: сборка, маршруты, сессии и сервисы
updated: 2026-08-01
checked: dc73c33
areas:
  - apps/server/src
---

# Backend изнутри: сборка, маршруты, сессии и сервисы

Backend — Fastify 5 на TypeScript ESM. Он не выпускает JS-артефакт: production и development запускают `tsx src/index.ts`, поэтому относительные импорты в исходниках имеют расширение `.js`, несмотря на физические `.ts`.

## Запуск и dependency injection

`index.ts` загружает `ServerConfig`, создаёт каталоги/SQLite, CLI-клиенты, STT/TTS engines и вызывает `buildServer()`, затем `listen()`. `server.ts` не слушает порт и подходит для тестов.

`BuildOptions` позволяет внедрить `db`, `claude`, `codex`, `sttEngine`, `ttsEngine`, `createWsHandlers`, `sessionSecret` и конфигурацию. По умолчанию `server.ts` сам решает, чем будут `claude`/`codex`: локальным `spawn`-клиентом или `RemoteLlmClient` поверх HTTP. Новый внешний процесс/ресурс должен получить такую точку инъекции; иначе unit/integration-тест случайно запустит реальный CLI или затронет диск.

Порядок регистрации: auth/public guard, REST, admin/projects/agents/KB, gateway/MCP, websocket plugin и статические файлы. `/api/*` по умолчанию требует bearer token; исключения перечислены централизованно в `isPublic`. Нельзя делать новый публичный route побочным эффектом порядка plugins.

## HTTP-поверхность

Группы маршрутов:

| Группа | Назначение |
|---|---|
| health/session | Health, login, me, logout. |
| conversations/messages | CRUD, поиск, настройка проекта/status, редактирование сообщений, desktop migration. |
| settings/system | Пользовательские настройки, capabilities CPU/RAM. |
| STT/TTS | Статус, каталог, скачивание/удаление моделей и голосов. |
| uploads/files | Вложения и ограниченное чтение файлов, созданных CLI. |
| LLM tooling | MCP list, login status, Claude Code/Codex sessions и resume. |
| agents | CRUD машин, token/policy/update/install bundles, exec и файловые операции. |
| admin | Пользователи, блокировка, usage и просмотр данных. |
| projects | Проекты, участники, машины, default machine, канбан columns/tasks. |
| KB | Status, topics, lexical/semantic search, context и чтение документа. |

Канонические строки находятся в `packages/shared/src/protocol.ts`. Реализация разделена между `routes/rest.ts`, `routes/agents.ts`, `routes/admin.ts`, `routes/projects.ts`, `kb/routes.ts`, `users/auth.ts` и `anthropic/gateway.ts`.

Каждый запрос к пользовательским данным получает имя через `uid(req)`. Проверки членства/владения выполняются до чтения или мутации. Admin guard использует роль из разрешённой сессии, не имя из URL.

## WebSocket `/ws`

`ws.ts` отвечает только за framing и routing: JSON управляющие сообщения, binary PCM, lifecycle сокета. `createSession()` создаёт per-connection handlers и владеет STT/TTS session, подписками tail, PTY relay и cleanup.

При подключении сервер отправляет активные LLM turns. Обрыв сокета закрывает микрофон, TTS, observer-tail и PTY подписки, но не модельный turn. Все callback-и должны быть сняты в одном cleanup, иначе reconnect удвоит события.

STT session аккумулирует PCM, конвертирует в WAV и вызывает engine. TTS session сериализует запросы, возвращает аудио/ошибки и поддерживает cancel. Resource capabilities проверяются сервером до запуска тяжёлого процесса.

## Процесс-глобальные ходы

`turns.ts` хранит по одному активному ходу на conversation id. `start()` выбирает Claude/Codex client, строит запрос с cwd/profile/MCP и подписывается на token/activity/usage. Partial хранится в памяти и транслируется всем заинтересованным соединениям.

По завершении сервер сохраняет AI message и метаданные в SQLite, обновляет conversation и отправляет `done`. По cancel/error снимает handle и очищает map. Проверка identity текущего turn не позволяет позднему callback старого процесса удалить новый ход того же разговора.

Пользовательские CLI-профили изолированы в `dataDir/cli-users/<base64url(логин)>/...`; `cliProfiles.ts` (переехал в `apps/llm-runner/src/cli/`) создаёт HOME/config и environment. Это не контейнерный root profile. Login status читается отдельно для каждого профиля.

## SQLite и репозитории данных

`VoiceChatDb` — синхронный адаптер `better-sqlite3`. При создании выполняет идемпотентную DDL и миграции старых колонок. WAL разрешает читателям не блокировать обычную запись; foreign keys обеспечивают cascade для conversation/project children.

Таблицы: `users`, `settings`, `conversations`, `messages`, `speakers`, `agents`, `projects`, `project_members`, `project_machines`, `kanban_columns`, `tasks`. JSON-поля (`skills`, technologies, policy, message meta, settings) кодируются/декодируются на границе DB.

Составные операции проектов и reorder/move задач выполняются транзакциями. Позиции имеют REAL и могут вставляться между соседями; при исчерпании промежутков порядок нормализуется. `BoardHub` хранит только listeners и после мутации заставляет подписчиков перечитать board — сама доска остаётся в SQLite.

При первой новой БД сидируется `admin`; пароль берётся из `VC_ADMIN_PASSWORD`, пустой допустим только как явно выбранная конфигурация. Пароли хешируются `scrypt`, machine tokens — SHA-256; сырой token возвращается только при создании/регенерации.

## Uploads и файлы

`UploadStore` хранит загруженные файлы в области данных сервера и выдаёт непрозрачный id. В prompt передаётся серверный путь, не клиентское имя. Ограничения размера и нормализация пути должны применяться до записи.

`serverFiles.ts` разрешает чтение только внутри allowlisted roots пользовательского CLI-профиля/генерируемых данных, запрещает traversal/symlink escape, директории и файлы больше 32 MiB. Это граница безопасности для `MessageImage`.

Изображения, созданные моделью на машине, `imageRelocate.ts` переносит в `.generated_images` рабочей папки машины и публикует через временный image host агента. Серверные и machine-файлы имеют разные пути получения.

## LLM и MCP

`ClaudeCli` и `CodexCli` реализуют общий `LlmClient` (`@voicechat/shared`, `llm.ts`): spawn, поток событий, cancel. Сами классы лежат в `apps/llm-runner/src/cli/`; сервер либо импортирует их из `@voicechat/llm-runner/cli` и спавнит локально, либо использует третью реализацию того же интерфейса — `llm/remoteClient.ts` (`RemoteLlmClient`), который шлёт ход по HTTP в контейнер-исполнитель (`POST /v1/run`, NDJSON, отмена — `DELETE /v1/run/:id`). Разбор потока для удалённого транспорта живёт в `llm/sinks.ts`, выбор реализации идёт по `VC_LLM_RUNNER_URL` в `config.ts`; подробности — `docs/kb/llm.md`. MCP-конфигурация Claude может включать `remoteBashMcp`, который адресует команду выбранной машине через registry.

`/mcp/remote-bash` реализован SDK MCP и предоставляет bash в рамках выбранного agent id. Он не обходит policy/version/online checks registry. Входящий `/v1/messages` — отдельный Anthropic-compatible gateway для Claude Code: backend либо upstream HTTP, либо локальный Codex; LAN-only проверка защищает незапароленный endpoint.

Observer-модули читают JSONL-сессии из `~/.claude/projects` и `~/.codex/sessions`, строят список/транскрипт и tail через watcher. Resume создаёт/связывает разговор, а не запускает второй backend storage.

## STT, TTS и ресурсы

`system/resources.ts` читает cgroup v1/v2 лимиты CPU/RAM с fallback на host. `capabilities.ts` сравнивает их с default или `VC_MIN_MEM_STT/TTS`. Недоступность отражается в API и блокирует запуск.

Whisper engine пишет временный WAV и spawn-ит `whisper-cli`; модели перечисляются по ожидаемым GGML-файлам. Download manager не допускает конкурирующие загрузки и публикует progress.

Piper engine ищет `.onnx` и `.json`; catalog знает разрешённые URL. На macOS `say` служит fallback/альтернативой и фильтрует голоса по языкам. TTS engines возвращают унифицированный WAV/audio result.

## Конфигурация

Приоритет путей: env → найденный артефакт монорепо (кроме Vitest) → каталог данных/default executable. Основные переменные: `PORT`, `HOST`, `VC_DATA_DIR`, `VC_MODELS_DIR`, `VC_WHISPER_CLI`, `VC_PIPER_BIN`, `VC_PIPER_ARGS`, `VC_PIPER_VOICES_DIR`, `VC_WEB_DIR`, `VC_AGENT_APP`, `VC_DESKTOP_APP`, `VC_KB_ROOT`, `VC_KB_RERANK_PROVIDER`, `VC_ADMIN_PASSWORD`, `VC_MIN_MEM_STT`, `VC_MIN_MEM_TTS`, `VC_CLAUDE_GATEWAY_BACKEND`, `VC_CLAUDE_UPSTREAM_URL`, `VC_CLAUDE_UPSTREAM_API_KEY`, `VC_CLAUDE_UPSTREAM_AUTH`, `VC_CLAUDE_MODEL_MAP`, `VC_LLM_RUNNER_URL`, `VC_LLM_RUNNER_CLAUDE_URL`, `VC_LLM_RUNNER_CODEX_URL`, `VC_LLM_RUNNER_TOKEN`, `VC_LLM_RUNNER_TIMEOUT_MS`.

Под Vitest autodiscovery отключён, чтобы тест удаления модели/голоса не затронул реальные repo assets.

## Проверка

HTTP-тесты используют `app.inject()`, WS-тесты — временно слушающий Fastify и `ws` client, DB — `:memory:`. Spawn/fetch/fs/resources передаются как зависимости. Реальные Claude, Codex, Whisper и Piper в тестах не запускаются.

Гейт: `npm run -w @voicechat/server typecheck && npm run -w @voicechat/server test`.
