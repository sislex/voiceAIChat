---
title: make-standalone-round1
date: 2026-09-07
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# Make как отдельное приложение — круг 1: граница внутри монолита

## Что сделано

- План `docs/plans/make-standalone.md`: инвентарь серверного кода Make (4 417 строк), карта
  связей «Make ↔ ядро» в обе стороны (10 методов БД трёх доменов + 4 обратных зависимости),
  целевая форма (отдельный сервис за Caddy path-routing на одном origin, `/internal/*` с
  Bearer-токеном, тот же том данных) и четыре круга.
- Круг 1: порт `MakeCore` (`make/core.ts`) — всё, что Make знает о чате, канбане и машинах;
  реализация `makeBridge/localCore.ts` поверх `db.*`. Порт `MakeService` (`make/service.ts`) —
  всё, что ядро знает о Make; `turns.ts`, `ci/modelHooks.ts`, `routes/projects.ts`,
  `routes/admin.ts` получают `make?: Pick<MakeService, …>`. Сборка — `make/module.ts`.
- Scope-токены рана на дизайны — HMAC-SHA256 с TTL (`make/taskScope.ts`) вместо `Map` в памяти:
  их выдаёт ядро, проверяет Make, и завтра это разные процессы.
- Гейт `make/boundary.test.ts`: код Make не импортирует `db/`, `users/`, `agents/`; ядро зовёт Make
  только через `core/service/module/taskScope`; `MakeCore` ≤ 15 методов.
- Общие утилиты уехали из `make/`: `util/rateLimit.ts`, `util/publicHost.ts`, `util/storyParse.ts`.

## Что выяснили (факты, которых не было в KB)

- У Make нет своих таблиц: всё состояние — файлы `<dataDir>/make/<conv>`; связь с БД —
  ровно 10 методов (`chat` ×5, `tasks` ×5 с `getCiTask`, `projects.getProject`, `identity.getUser`).
- Обратных зависимостей ядра от Make четыре: контекст промпта, снимок хода, scope-токены рана,
  проверка путей `makeSources` в цикле доработки. Остальные импорты из `make/` были общими
  утилитами (`SlidingWindowLimiter` держит и вход по паролю, и приглашения).
- SSRF-гард `assertPublicHost` Make брал из `routes/previewProxy.ts` — единственная связь Make с
  роутами ядра, теперь в `util/publicHost.ts`.
- Make-разговоры живут в scope `make`: `GET /api/conversations/:id?scope=chat` для них 404, UI
  открывает их по `#/make/<id>`.

## Куда занесено

- docs/kb/server-internals.md — раздел «Make ↔ ядро: порты `MakeCore` и `MakeService`»
- apps/server/AGENTS.md — раскладка (`make/`, `makeBridge/`, `util/`)
- docs/plans/make-standalone.md — план и статусы круга 1

## Открытые вопросы / что осталось

- Круг 2: пакет `apps/make`, `/internal/*` в ядре, `HttpMakeCore`/`HttpMakeService`, whoami-кэш.
- `MakeService.turnSnapshot` пока синхронный — в remote-режиме станет `Promise`; `turns.ts`
  собирает `meta` синхронно, придётся перестроить точку слияния.
- `hub.changed` в remote-режиме приедет позже ответа REST — проверить монотонность `rev` в панели.
