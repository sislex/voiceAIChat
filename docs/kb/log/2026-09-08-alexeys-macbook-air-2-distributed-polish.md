---
title: distributed-polish
date: 2026-09-08
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# Доводка распределённого режима: процессы на разных хостах

## Что сделано

- `KanbanUploads.read(id)` — байты вложения через порт ядра (RPC `uploads.read`, base64); `routes/qa.ts` не читает
  `upload.path`, общий том канбану не нужен.
- `KanbanService.previews.list()` для preview-MCP чата (в remote — RPC `previews`); `featurePreviewsRef` из
  `KanbanDeps` убран.
- `ptyBufferText` в порту машин допускает `Promise`; `HttpMachines` берёт полный буфер у процесса машин по RPC,
  свой частичный буфер убран; консольный MCP ждёт `await`.
- Runbook «Распределённый стенд» в `docs/kb/deploy.md`: таблица процессов, режимов, переменных и потребности в
  общем томе; сетевые требования; что остаётся у ядра принципиально.

## Что выяснили (факты, которых не было в KB)

- Единственная зависимость канбана от диска ядра была в вложениях QA (`readFileSync(upload.path)`); скриншоты
  QA и файл превью он держит у себя.
- Make при выносе на другой хост несёт мастерские из `/data/make` ядра — единственный процесс, которому
  переезд требует переноса данных.
- Процесс машин держит постоянный WebSocket к ядру и админке — ему нужен входящий доступ от них.

## Куда занесено

- docs/kb/deploy.md — «Распределённый стенд»; docs/kb/server-internals.md — вложения/превью канбана, буфер PTY
- docs/plans/machines-service.md — круг 4 ☑

## Открытые вопросы / что осталось

- Перекат отдельных сервисов в Release Center (сейчас `docker compose up -d --build <сервис>`).
- Включение Postgres и распределённых профилей в проде — решение и секреты пользователя.
