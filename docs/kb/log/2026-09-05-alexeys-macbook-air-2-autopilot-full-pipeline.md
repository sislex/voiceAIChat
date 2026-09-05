---
title: autopilot-full-pipeline
date: 2026-09-05
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# autopilot-full-pipeline

## Что сделано

- Координатор автопрохода подписан на `boardHub.onChange` вместо обёртки `emitBoard`;
  изменение доски во время тика запоминается в `pendingTicks` и не теряется.
- Tick покрыл начало конвейера: `backlog`/`preparation` → запуск подготовки,
  `ready` → `startForDevelopmentTransition`. Повтор упавшей подготовки ограничен
  `autoPilotFixLimit`, после исчерпания — `autopilot.stopped` и `decision_required`.
- Синхронизация общей копии с origin вынесена в `apps/server/src/projectSync.ts`
  и повторяет таймаут/недоступную машину (3 попытки, пауза 2 с).
- Тесты: `apps/server/src/projectSync.test.ts`, `apps/server/src/autopilotPipeline.test.ts`.

## Что выяснили (факты, которых не было в KB)

- Автопроход стоял не из-за отсутствия стадий, а из-за пробуждения: `emitBoard`
  (обёртка с тиком) используется в 6 местах, а `boardHub.emit` напрямую — почти
  везде, включая завершение preparation-, CI-, QA- и merge-ранов. Поэтому
  окончание этапа не будило координатор.
- Старт подготовки (`backlog → preparation`) и переход `ready → development` были
  реализованы только в drag&drop-роуте `apps/server/src/routes/projects.ts`, то
  есть существовали лишь как реакция на действие человека.
- `POST /api/projects/:id/tasks/:taskId/preparation/runs` отдаёт голый массив
  `TaskPreparationRun[]`, не объект с полем `runs`.
- На проде подготовка CHAT-413 упала с «Синхронизация с origin завершилась по
  таймауту» за 19 с при серверном лимите 120 с — то есть таймаут пришёл со
  стороны машины/канала, а не от серверного бюджета.

## Куда занесено

- docs/kb/features/task-autopilot.md — раздел «Координатор» (пробуждение тика,
  начало конвейера, повторы подготовки).
- docs/kb/features/task-preparation.md — повтор preflight-синхронизации.

## Открытые вопросы / что осталось

- `waiting_for_answer` остаётся осознанной остановкой: вопрос модели ждёт человека.
- Автопроход по-прежнему включается флагом на карточке (`autoPilot`), дефолт — выкл.
