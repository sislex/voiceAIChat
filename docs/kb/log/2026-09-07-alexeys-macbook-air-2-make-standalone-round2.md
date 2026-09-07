---
title: make-standalone-round2
date: 2026-09-07
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# Make как отдельное приложение — круг 2: пакет `apps/make` и внутренний API

## Что сделано

- Код Make (мастерские, витрина, импорт, роуты, MCP — 4,4 тыс. строк с тестами) физически переехал
  в пакет `apps/make` (`@voicechat/make`); ядро зависит от него как от `@voicechat/llm-runner`.
  Чистые утилиты `SlidingWindowLimiter` и `parseStoryFile` — в `@voicechat/shared`.
- Отдельный процесс Make: `apps/make/src/standalone` — `buildMakeServer`, `HttpMakeCore` (RPC к
  ядру), пересылка авторизации в `/internal/whoami` с кэшем чтений 30 с, отправка событий шины
  ядру пачками, `/internal/service` для ядра, `/v1/health`.
- Внутренний API ядра `routes/internal.ts` (`/internal/make/core`, `/internal/make/events`,
  `/internal/whoami`) под `VC_INTERNAL_TOKEN`; `authenticate` вынесен из preHandler `users/auth.ts`.
- Ядро: `VC_MAKE_MODE=embedded|remote`, `makeBridge/remote.ts` (`MakeService` по RPC + локальная
  `MakeHub`), общий `VC_MCP_SECRET`, `VC_MAKE_MCP_PUBLIC_BASE` для исполнителя.
- Тесты: контракт `MakeCore` local vs http, интеграция «ядро + Make на двух портах» (Bearer,
  cookie + CSRF, превью, MCP, 404 роутов Make у ядра), гейты границы с обеих сторон, тесты
  `HttpMakeCore` и пересылки авторизации; карта пакетов гейта (`scripts/affected-check.mjs`).

## Что выяснили (факты, которых не было в KB)

- `listConversations` без `scope` отдаёт только `chat`; Make-разговоры в scope `make` — квота Make
  на пользователя считалась по пустому списку. Исправлено в `LocalMakeCore.makeConversationIdsOf`.
- Аугментация `FastifyRequest.user` из `users/auth.ts` не видна пакету Make, а второе объявление с
  другим типом сломало бы typecheck ядра (оба попадают в одну компиляцию) — `uid(req)` в Make
  читает поле структурно через cast.
- Регулярка гейта по импортам без ограничения `[^}]` тянулась через соседние строки импорта —
  ложные срабатывания на файлах, где типовой импорт стоит после обычного.
- `Headers.entries()` и `HeadersInit` отсутствуют в типах при `lib: ES2022` + `@types/node`:
  заголовки читаем через `forEach`, тип — `RequestInit['headers']`.

## Куда занесено

- docs/kb/server-internals.md — раздел «Make ↔ ядро: порты `MakeCore` и `MakeService`» (пакет, режимы, внутренний API, авторизация)
- docs/kb/deploy.md — переменные режима `remote` и правила проксирования
- apps/make/AGENTS.md (новый), apps/server/AGENTS.md (раскладка), AGENTS.md (карта монорепо)
- docs/plans/make-standalone.md — статусы круга 2

## Открытые вопросы / что осталось

- Круг 3: стадия `make-runtime` в Dockerfile, сервис `make` в compose, path-routing в Caddyfile,
  прогон на копии прод-БД в обоих режимах, e2e в `remote`.
- `MakeMachineFs.isOnline` стал асинхронным ради RPC (реестр ядра отвечает синхронно, порт оборачивает).
