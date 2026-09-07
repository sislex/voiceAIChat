---
title: machines-service-round3
date: 2026-09-07
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# Машины и админка отдельными сервисами — круг 3: админка отдельным процессом

## Что сделано

- Внутренний API машин вынесен в `machines/internalApi.ts` и поднимается и в процессе машин, и в ядре во
  встроенном режиме (при `VC_INTERNAL_TOKEN`); пути — `/internal/machines/{rpc,exec-stream,events}`. Так
  админка берёт машины у того процесса, где живёт реестр, одним клиентом `HttpMachines`.
- `admin/standalone/` (`buildAdminServer`, порт 8794): `routes/admin.ts` + пересылка авторизации, `HttpMachines`,
  Make по RPC, деплой и `sessionHub.emit` — RPC к ядру `/internal/admin/rpc` (`admin/internal.ts`).
- Ядро: `VC_ADMIN_MODE=remote`/`VC_ADMIN_URL` → прокси `/api/admin/*` (типы проектов остаются у канбана);
  `routes/internal.ts` получил RPC админки. `HttpMachines` отвечает на авторизацию тоннеля только за свои тоннели.
- Compose: сервис `admin` (профиль), образ `admin-runtime`, у ядра `VC_ADMIN_MODE` по умолчанию `embedded`.
- Тест `admin/standalone/adminRemote.integration.test.ts`.

## Что выяснили (факты, которых не было в KB)

- К шине событий машин могут быть подключены несколько процессов (ядро и админка): отвечать на запрос
  авторизации тоннеля должен только тот, кто тоннель создал, иначе чужой отказ опережает ответ.
- Ответ `POST /api/admin/deploy` — 202 (`accepted`), статистика машин `/api/admin/machines/stats` — объект с
  `generatedAt`.
- Fastify отдаёт роут с более длинным статическим префиксом раньше wildcard: `/api/admin/project-types*`
  (канбан) и `/api/admin/*` (прокси админки) сосуществуют без исключений в списке.

## Куда занесено

- docs/kb/server-internals.md — «Админка отдельным процессом», внутренний API машин у ядра
- docs/kb/deploy.md, docs/docker.md — переменные `VC_ADMIN_*`; apps/server/AGENTS.md — `admin/`
- docs/plans/machines-service.md — круг 3 ☑

## Открытые вопросы / что осталось

- Прогон на копии прод-БД со всеми четырьмя процессами (ядро, машины, канбан, админка) и browser-smoke; PR этапа 3.
