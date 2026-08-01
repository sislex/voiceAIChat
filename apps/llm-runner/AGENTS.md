# @voicechat/llm-runner — исполнитель LLM (Fastify)

Отдельный процесс/контейнер, который единственный в системе делает `spawn`
`claude`/`codex`. Сервер (`apps/server`) обращается к нему по HTTP: даёт
`LlmRequest`, получает сырые строки stdout. План выноса — `docs/plans/llm-runners.md`
(этот пакет — срез 1).

## Особенности, которые надо помнить

- **Не компилируется в JS.** Запуск — `tsx src/index.ts`, ESM. Поэтому **все
  относительные импорты пишутся с `.js`** (`./config.js`), хотя файлы `.ts`.
- **`buildRunner()` отделён от `listen()`** (`server.ts` / `index.ts`), внешние
  ресурсы инъектируются через `BuildRunnerOptions`: `runs` (`RunManager` с
  фейковым `spawn`), `health`. Реальные CLI в тестах не запускаются.
- **Исполнитель ничего не разбирает.** `stream-json` Claude и JSONL Codex парсит
  сервер (`packages/shared`). Здесь строки stdout/stderr идут кадрами NDJSON
  (`{t:'out'|'err',s}` / `{t:'exit',code}`) — иначе протокол пришлось бы менять
  при каждом изменении формата вывода CLI.
- **Ран не переживает своего клиента.** Обрыв соединения гасит CLI сразу; «клиент
  жив, но поток не читает» — по таймауту сироты (`VC_RUNNER_ORPHAN_MS`, 30 с).
  Без этого перезапуск сервера оставлял бы ход жечь токены подписки до конца.
- **Весь `/v1/*` закрыт одним Bearer-токеном** (`auth.ts`). Пользователей у
  исполнителя нет: клиент один — сервер, токен лежит в его реестре исполнителей.
  Без `VC_RUNNER_TOKEN` процесс не стартует: открытый `/v1/run` — это shell.
- **Профили CLI живут здесь.** `cli-users/<base64url(логин)>` внутри
  `VC_DATA_DIR`; сервер передаёт только `userId` и о путях не знает.

## Протокол (v1)

| Метод | Что делает |
|---|---|
| `POST /v1/run` | тело — `LlmRunBody` (`LlmRequest` + `kind` + необязательный `runId`). Ответ — NDJSON-поток кадров; id рана ещё и в заголовке `x-run-id`. Живой `runId` повторно → 409 |
| `DELETE /v1/run/:id` | отмена: SIGTERM → SIGKILL (`killCliChild`). `{stopped:false}` — рана уже нет, это не ошибка |
| `GET /v1/health` | бинари, версии, статус входа обоих CLI, число живых ранов |

Формы и константы — в `@voicechat/shared` (`llm.ts`): контракт общий с сервером.

## Раскладка

`config.ts` (env), `server.ts`, `index.ts`, `auth.ts`, `health.ts`,
`run/rawRun.ts` (`RunManager`: spawn, кадры, отмена, сирота),
`cli/` — перенесённое из сервера: `claudeCli.ts` (+ `claudeArgs`),
`codexCli.ts` (+ `codexInvocation`), `childKill.ts`, `mcp.ts`, `cliProfiles.ts`,
`cli/index.ts` — экспорт для сервера (`@voicechat/llm-runner/cli`).

**Временно:** `apps/server` импортирует `@voicechat/llm-runner/cli` напрямую
(классы CLI, профили, `claude mcp list`). Срез 2 переводит сервер на
`RemoteLlmClient` по HTTP, и эта зависимость уходит.

## Переменные окружения

`PORT` (8790), `HOST` (0.0.0.0), `VC_RUNNER_TOKEN` (обязателен),
`VC_DATA_DIR` (профили CLI), `HOME` (общий профиль: сид и статус логина),
`VC_CLAUDE_BIN` / `VC_CODEX_BIN`, `VC_RUNNER_ORPHAN_MS`.

## Тесты

`vitest run`, файлы рядом. HTTP — `app.inject()`; поток `/v1/run` — реальный
`listen` + `fetch` с построчным чтением (только так видно, что строки не
буферизуются). `spawn` — фейковый процесс на `PassThrough`.

Гейт: `npm run -w @voicechat/llm-runner typecheck && npm run -w @voicechat/llm-runner test`.
