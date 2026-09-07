---
title: make-standalone-round3
date: 2026-09-07
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# Make как отдельное приложение — круг 3: образ, compose, Caddy, прокси в ядре

## Что сделано

- `Dockerfile`: стадия `make-runtime` (та же runtime-база, процесс `apps/make/src/standalone`).
- `docker-compose.yml`: сервис `make` (порт 8788, тот же том `vc-data`, healthcheck `/v1/health`,
  `mem_limit 512m`); ядро — `VC_MAKE_MODE=remote`, `VC_MAKE_URL`, `VC_MAKE_MCP_PUBLIC_BASE`; общие
  `VC_INTERNAL_TOKEN`/`VC_MCP_SECRET` с локальными дефолтами.
- `Caddyfile`: `@make path …` → `make:8788`, `/internal/*` → 404, остальное → ядро; на обоих
  виртуальных хостах. Тест `infra.caddy.test.ts` дополнен.
- **Прокси путей Make в ядре** (`makeBridge/proxy.ts`), не из плана: на прод ходят портом 8787
  мимо Caddy — без прокси Make там пропал бы. Сырое тело, заголовки как есть, `x-forwarded-*`,
  `set-cookie` через `getSetCookie()`, недоступный Make → 503 `make_unavailable`.
- Локальная проверка в `remote` на копии прод-БД: ядро (dev-web, 8799) + процесс Make (8798, `tsx`),
  панель Make открыта через прокси ядра — состояние, заметки, комментарии, presence, превью,
  запись файла и **живое обновление превью** (`rev=0 → rev=1`: событие Make → `/internal/make/events`
  → шина ядра → WS → панель), связи с карточкой (RPC к канбану), «машина offline» (RPC статуса),
  cookie-мутация без CSRF → 403 через `whoami`. Ошибок в логах обоих процессов нет.

## Что выяснили (факты, которых не было в KB)

- Стенд на проде открывают напрямую портом 8787 (HTTPS через Caddy не используется), поэтому
  path-routing только в Caddy не решает задачу — маршрутизацию Make обязан уметь и сам сервер.
- DELETE без тела браузер шлёт с `content-type: application/json` и `content-length: 0`; fetch в
  прокси длину не передаёт, и Fastify у Make отвечал 400 «пустой JSON». Прокси снимает
  `content-type`, если тела нет.
- `fetch` склеивает `set-cookie` в одну строку — в прокси заголовок переносится через
  `getSetCookie()`, иначе публикация с паролем получала бы битую cookie.
- Тело для `fetch` из `Buffer` в типах `@types/node` не проходит как `BodyInit` — нужен `Uint8Array`.

## Куда занесено

- docs/kb/deploy.md — абзац «Make отдельным сервисом» (compose, переменные, две дороги маршрутизации)
- docs/docker.md — таблица переменных
- docs/plans/make-standalone.md — статусы круга 3
- apps/make/AGENTS.md — упоминание прокси (см. раздел «Что важно помнить»)

## Открытые вопросы / что осталось

- Образ `make-runtime` и compose локально не собирались (сборка whisper/Playwright-образов слишком
  тяжёлая) — первая проверка образа будет на проде при релизе; откат — `VC_MAKE_MODE` не задавать.
- Круг 4: Release Center с перекатом одного сервиса, версия Make в админке, собственный SSE Make.
