# Исполнители LLM: вынос claude/codex CLI в отдельные контейнеры

Статус: спроектировано, не реализовано (2026-08-01). Это план, а не описание
текущего кода — база знаний (`docs/kb/`) описывает то, что уже верно.
Feature-док `docs/kb/features/llm-runners.md` заводится по факту реализации.

## Цель

Контейнер `voicechat` перестаёт содержать `claude`/`codex` CLI и не делает
`spawn`. Появляются контейнеры-исполнители:

- `runner-work` — `claude` + `codex`, рабочие подписки;
- `runner-personal` — `claude`, личная подписка.

Бэкенд выбирает **исполнителя** (не просто провайдера) на уровне настроек
пользователя, разговора и CI-рана.

## Принятые решения

| Вопрос | Решение |
|---|---|
| Файлы (профили, транскрипты, вложения, картинки) | Общих томов нет. Свои тома у каждого исполнителя, сервер читает файлы по HTTP через его API |
| Размещение | Пока тот же хост и внутренняя docker-сеть, порты наружу не публикуются; API проектируется как удалённое (адрес + токен + таймауты) |
| Реестр исполнителей | Таблица в БД + управление в админке сразу |
| Доступ | Настраивается по ролям в реестре |
| Профили в `runner-personal` | Per-user, как сейчас: креды личной подписки копируются каждому разрешённому пользователю |
| Недоступный исполнитель | Фолбэк на дефолтный того же `kind` + явная пометка в ленте хода |
| Токены исполнителей | В БД открытым текстом, доступ только админу |
| Селектор | Настройки пользователя, переопределение в разговоре, выбор в карточке CI-рана |

## Архитектура

```
voicechat (Fastify)                     runner-work / runner-personal
  turns.ts / ci ──▶ RemoteLlmClient ──▶ POST /v1/run  (NDJSON: сырые строки stdout)
  парсеры stream-json ◀───────────────  DELETE /v1/run/:id, GET /v1/health
  rest.ts /api/cc,/api/cx ────────────▶ GET /v1/fs/...  (проводник CC/Codex, SSE-watch)
  imageRelocate, /api/auth/status ────▶ GET /v1/files/read, GET /v1/auth/status
       ▲                                      │
       └──── MCP (remote-bash, kb, ci) ◀──────┘   http://voicechat:8787...&k=
```

Разбор `stream-json`/JSONL, usage, `session_id` и запись в БД остаются на
сервере — исполнитель отдаёт сырые строки. Поэтому `turns.ts`, парсеры в
`packages/shared` и CI-раннер логически не меняются.

**Новый воркспейс `apps/llm-runner`.** Переезжают вместе со своими тестами:
`claude/claudeCli.ts`, `codex/codexCli.ts`, `claude/childKill.ts`,
`users/cliProfiles.ts`, `cc/ccSessions.ts`, `codex/codexSessions.ts`,
`auth/loginStatus.ts`, `claude/mcp.ts`. На сервере остаются `claude/types.ts`
(`LlmClient`) и новые `llm/remoteClient.ts`, `llm/engines.ts` плюс HTTP-клиенты
файловых читалок.

## Протокол исполнителя (v1)

| Метод | Назначение |
|---|---|
| `POST /v1/run` | тело — сериализованный `LlmRequest` (kind, prompt, model, sessionId, permissionMode, executionDisabled, remote{mcpUrl,agentName,policySummary}, kbMcpUrl/kbMode, cwd, userKey, attachments). Ответ — NDJSON: `{t:'out',s}` / `{t:'err',s}` / `{t:'exit',code}` |
| `DELETE /v1/run/:id` | отмена — `killCliChild` внутри исполнителя |
| `GET /v1/health` | бинари, версии, разобранный статус логина обоих CLI |
| `GET /v1/auth/status` | статус входа профиля конкретного пользователя |
| `GET /v1/fs/cc/*`, `/v1/fs/cx/*` | проводник сессий: projects / sessions / transcript / usage |
| `GET /v1/fs/cc/watch` (SSE) | live-tail транскрипта — замена `watchTranscript`/`watchCxTranscript` для `session.ts` |
| `GET /v1/files/read` | чтение файла в границах профиля — `imageRelocate` и fallback `MessageImage` |

Аутентификация — Bearer-токен исполнителя. Обязателен **таймаут-сирота**: если
поток `/v1/run` никто не читает N секунд (сервер перезапустился), исполнитель
убивает процесс сам.

Профили CLI (`cli-users/<base64url(логин)>`) целиком живут внутри исполнителя;
сервер передаёт только `userKey` и о путях не знает.

## Что сегодня привязано к «CLI рядом с сервером»

| Место | Почему ломается |
|---|---|
| `apps/server/src/claude/claudeCli.ts`, `codex/codexCli.ts` | единственные `spawn()` сервера (плюс `claude/mcp.ts`) |
| `server.ts:233,350,362,374` | MCP-URL захардкожены как `http://127.0.0.1:<port>/…` — из контейнера исполнителя это он сам |
| `users/cliProfiles.ts` | per-user HOME сидируется кредами из HOME контейнера сервера; у двух подписок профили обязаны быть раздельными |
| `routes/rest.ts:213-272`, `cc/`, `codex/codexSessions.ts` | проводник CC/Codex читает `projects/`+`sessions/` с диска сервера |
| `turns.ts:244` (`attachmentPaths`) | вложения уходят в промпт абсолютными путями `/data/uploads/…` |
| `imageRelocate.ts` | сервер читает сгенерированные CLI картинки из профиля на своём диске |
| `auth/loginStatus.ts` → `/api/auth/status` | читает `~/.claude/.credentials.json` в контейнере сервера |
| `claude/childKill.ts` | отмена — сигнал локальному процессу |
| `turns.ts:243` (`localCwd`) | `existsSync(settings.workdir)` проверяется на сервере, а chdir нужен исполнителю |
| `docker-compose.yml`, `docs/docker.md`, `docs/kb/deploy.md` | тома `vc-claude`/`vc-codex` и инструкция логина переезжают в сервисы-исполнители |

## Вложения и cwd

`buildPrompt` зашивает в текст абсолютные пути сервера. `RemoteLlmClient`
передаёт вложения байтами вместе с запросом; исполнитель кладёт их во временный
каталог рана и подменяет пути в промпте по карте `serverPath → runnerPath`.
`settings.workdir` проверяется на существование на стороне исполнителя.

## Реестр исполнителей

Таблица `llm_engines`: `id, name, kind(claude|codex), base_url, token, enabled,
allowed_roles, is_default, created_at`. Админка — CRUD плюс проверка health.

Выбор: `settings.llmEngineId`, `conversations.llm_engine_id`,
`ci_runs.llm_engine_id` — рядом с существующими `llm_provider`/`llm_model`, без
миграции данных. Резолв: `engineId ?? дефолтный исполнитель с kind = llmProvider`;
выключен или недоступен по роли → дефолт для роли, и в ленту хода пишется
пометка о подмене (молчаливый фолбэк запрещён: пользователь должен понимать,
под какой подпиской выполнен ход). Один исполнитель может обслуживать оба
`kind`, поэтому доступность считается парой (исполнитель, kind).

## Срезы

1. **Каркас исполнителя** — воркспейс `apps/llm-runner`, перенос CLI-классов и
   профилей, `POST /v1/run` + cancel + health + Bearer + таймаут-сирота.
2. **`RemoteLlmClient`** на сервере, инъекция через `BuildOptions`, один
   исполнитель из env; сквозной тест «ход → фейковый исполнитель». — СДЕЛАНО
   (`apps/server/src/llm/{remoteClient,sinks,protocol}.ts`, env
   `VC_LLM_RUNNER_*`, см. `docs/kb/llm.md`).
3. **MCP-адресация** — `VC_MCP_PUBLIC_BASE` вместо `127.0.0.1` в
   `server.ts:233,350,362,374`, проверка доступности из сети исполнителя.
4. **Вложения и cwd** — передача файлов, подмена путей, резолв cwd у исполнителя.
5. **Файловые API** — `/v1/fs/*` и `/v1/files/read`; сервер переводит
   `routes/rest.ts`, tail в `session.ts`, `imageRelocate.ts` и `/api/auth/status`
   на HTTP-клиент исполнителя.
6. **Реестр** — миграция `llm_engines`, admin CRUD, health, роли.
7. **Выбор исполнителя** — настройки / разговор / CI-ран, резолв, фолбэк с
   пометкой, селекторы в UI (`fakeApi` + мосты web/desktop).
8. **Docker и деплой** — два сервиса-исполнителя без публикации портов, перенос
   томов `vc-claude`/`vc-codex` в `runner-work` и `/data/cli-users`, обновление
   `docs/docker.md`, `docs/kb/{deploy,llm,server-internals}.md`,
   `apps/server/AGENTS.md`.

Гейт каждого среза — `typecheck` + `test` затронутых воркспейсов.

## Риски

- **Деплой атомарен**: пока исполнители не подняты и не залогинены, ходы не
  работают. Порядок — поднять `runner-work` на существующих томах (авторизация
  переезжает без перелогина), затем переключить сервер.
- **Обрыв потока** в середине хода: нужен человеческий текст ошибки, аналог
  `describeSpawnError`, а не сетевой стектрейс.
- **CI-раннер** пересобирает прод и рестартит контейнеры — шаг «Обновить
  прод-контейнер» теперь обязан поднимать и исполнителей.
- **Побочный выигрыш**: CLI уходят из-под `mem_limit: 1g` сервера —
  освобождается память под STT-модели (`docs/kb/stt-tts.md`).
