---
title: machines-service-round2
date: 2026-09-07
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# Машины отдельным сервисом — круг 2: отдельный процесс машин

## Что сделано

- Контракт `machines/internal.ts`: RPC, потоковый exec (общий `internal/execStream.ts`, канбан переведён на него),
  шина событий одним WebSocket «ядро → процесс машин» (снимки машин и PTY, события PTY, кадры владельцам,
  agentReady, журнал команд, авторизация тоннелей). В `AgentRegistry` — `onPtyChange`/`ptySnapshot`.
- `machinesBridge/httpMachines.ts` — `HttpMachines implements MachinesService`: зеркало для синхронных чтений,
  буфер PTY у ядра, RPC с восстановлением `AgentFsError` по коду, переподключение шины.
- `machinesBridge/proxy.ts` — прокси REST машин (`MACHINES_PROXY_PREFIXES`) и WebSocket-прокси `/agent`.
- `machines/standalone/` — `buildMachinesServer` (тот же модуль машин, пересылка авторизации, шина, RPC,
  exec-stream, health), `index.ts` (порт 8793). Пересылка авторизации обобщена в `internal/forwardedAuth.ts`
  (публичные пути — `isPublic` ядра); хранилище разговора — `chatStorage.ts`.
- Конфиг `VC_MACHINES_MODE`/`VC_MACHINES_URL`; compose-сервис `machines` (профиль), образ `machines-runtime`.
- Тесты: юнит `HttpMachines`, интеграция «ядро remote + процесс машин + фейковый агент через прокси ядра»
  (регистрация, список, exec с кадром `machine.command`, PTY туда и обратно), полнота прокси по исходникам.

## Что выяснили (факты, которых не было в KB)

- Через WebSocket-прокси не проходят ping-кадры: `ws` отвечает pong сам, поэтому `last_seen` агента обновлял бы
  только прокси — он пингует агента, когда получает ping от процесса машин.
- Синхронные чтения PTY у ядра (`ptyLive`, `ptyContextOf`) требуют зеркала PTY-сессий; сразу после `ptyStart`
  сессия считается живой оптимистично, до снимка процесса машин.
- Гейт команд построен только на данных базы — ядро в remote строит его само, без реестра.
- Порядок ответов на параллельные авторизации тоннелей по шине не детерминирован — тесты сравнивают сортированно.

## Куда занесено

- docs/kb/server-internals.md — «Режим VC_MACHINES_MODE=remote», docs/kb/deploy.md — «Машины отдельным сервисом»,
  docs/docker.md — таблица переменных, apps/server/AGENTS.md — `machines/standalone/`, `machinesBridge/`, `internal/`
- docs/plans/machines-service.md — круг 2 ☑

## Открытые вопросы / что осталось

- Круг 3: админка отдельным процессом (`routes/admin.ts` + пересылка авторизации; deployTrigger и sessionHub —
  RPC к ядру), прогон на копии прод-БД со всеми процессами, PR.
- Долг: `ptyBufferText` у ядра в remote — вывод с момента подписки; полный буфер остаётся у процесса машин.
