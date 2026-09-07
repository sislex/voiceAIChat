# @voicechat/make — Make (веб-проект с ассистентом) как отдельный пакет

Мастерские проектов Make, витрина компонентов, импорт zip/URL, публикация, REST `/api/make/**`,
превью `/api/preview/make*/*`, публичные `/p/*`, `/s/*` и MCP `/mcp/make` для ассистента.
План выделения в отдельный сервис — `docs/plans/make-standalone.md`.

## Что важно помнить

- **Своих таблиц у Make нет.** Состояние — файлы `<dataDir>/make/<conversationId>` (мастерская,
  снимки, заметки, гранты, комментарии, связи с задачами). Всё, что Make знает о чате, канбане,
  пользователях и машинах, приходит через порт **`MakeCore`** (`src/core.ts`, ≤ 15 методов).
  Реализации: в ядре — `apps/server/src/makeBridge/localCore.ts` над `db.*`; в отдельном процессе —
  `src/standalone/httpCore.ts` (RPC к `/internal/make/core` ядра).
- **Ядро знает Make только через `MakeService`** (`src/service.ts`): контекст промпта, снимок хода,
  список файлов, scope-источники рана, статистика, sweep, подписка на кадры. Сборка —
  `createMakeModule` (`src/module.ts`); режим `remote` у ядра — `makeBridge/remote.ts`.
- **Гейт границы** — `src/boundary.test.ts` (Make не импортирует ядро, слой данных, исполнителей)
  и `apps/server/src/makeBridge/boundary.test.ts` (ядро — только типы и `createMakeModule`).
  Понадобилось что-то от ядра — расширяй `MakeCore`, а не тяни `db`.
- **Авторизации у Make нет и не будет своей.** В standalone (`src/standalone/auth.ts`) cookie/Bearer
  запроса пересылаются ядру в `/internal/whoami`; чтения кэшируются 30 с. `req.user` читается
  структурно (`uid(req)` в `routes.ts`), без аугментации `FastifyRequest`.
- **Scope-токены рана** (`src/taskScope.ts`) — HMAC секретом MCP; их выдаёт ядро, проверяет Make.
  В `remote` секрет общий: `VC_MCP_SECRET` у обоих процессов.
- **События шины** (`MakeHub`, `src/hub.ts`): `changed`/`presence`/`turnSnapshot`. В standalone
  `setListener` шлёт их ядру пачками (`/internal/make/events`), ядро воспроизводит `apply` — сокеты
  пользователей живут у ядра, контракт WS не меняется.
- **Две дороги к Make в `remote`:** Caddy направляет пути Make в `make:8788` напрямую, а при заходе
  портом ядра (8787, так ходят на прод) их переправляет само ядро — `apps/server/src/makeBridge/proxy.ts`.
- Не компилируется в JS: `tsx`, относительные импорты с `.js`. `@voicechat/shared` — единственная
  внутренняя зависимость.

## Раскладка

`core.ts`, `service.ts`, `module.ts`, `internal.ts` (протокол RPC ядро ↔ Make и диспетчеры),
`taskScope.ts`, `hub.ts`, `workspace.ts` (мастерские), `library.ts`, `stories.ts`, `transpile.ts`,
`zip.ts`, `zipRead.ts`, `importUrl.ts`, `publicHost.ts` (SSRF-гард, копия ядра — намеренно),
`metrics.ts`, `routes.ts` (REST/превью/публикация), `mcp.ts` (инструменты `make_*`),
`standalone/` (`config.ts`, `auth.ts`, `httpCore.ts`, `server.ts` — `buildMakeServer`, `index.ts`).

## Запуск отдельным процессом

`VC_INTERNAL_TOKEN`, `VC_MCP_SECRET` (те же, что у ядра), `VC_CORE_URL` (адрес ядра),
`VC_DATA_DIR` (тот же том, что у ядра), `PORT` (8788). У ядра — `VC_MAKE_MODE=remote`,
`VC_MAKE_URL`, `VC_MAKE_MCP_PUBLIC_BASE` (адрес Make глазами исполнителя LLM).

## Тесты

`vitest run`, файлы рядом. Роуты и MCP — через `app.inject()` с фейковым `MakeCore`; контракт
`MakeCore` (local vs http) и интеграция «ядро + Make на двух портах» — в
`apps/server/src/makeBridge/*.test.ts`, потому что им нужна настоящая БД.

Гейт: `npm run -w @voicechat/make typecheck && npm run -w @voicechat/make test`.
