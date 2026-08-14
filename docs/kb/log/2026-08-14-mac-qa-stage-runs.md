---
title: qa-stage-runs
date: 2026-08-14
machine: mac
author: alexeyrozhnov
---

# qa-stage-runs

## Что сделано

- Записал в базу знаний новую сущность ранов QA-этапов: таблица `qa_stage_runs`,
  типы `AnyQaStageRun` в `packages/shared/src/qa.ts`, REST `…/qa/runs/:stage` и
  `/api/qa/runs/:runId{,/retry,/answer}`, панель `QaStageRunPanel` и три
  динамические вкладки карточки задачи.

## Что выяснили (факты, которых не было в KB)

- Исполнителя у ранов нет: `startQaStageRun` вставляет строку сразу в `running`,
  а `updateQaStageRun`/`completeQaStageRun` вызываются только из тестов. Значит
  в рантайме ран не доходит до `success`/`gate_failed` и карточку по этой линии
  не двигает; `awaiting_input` тоже никто не выставляет.
- Граница «предыдущий этап пройден» выражена только проверкой semantic type
  текущей колонки задачи в `startQaStageRun` (и, через него, в retry).
- Ветка/SHA рана берутся из `task.mergeSourceBranch/mergeSourceSha`, а не из
  CI-workspace; права — только `isProjectMember`, без `canQa`.
- Вкладка «Component QA» монтирует старую `ComponentQaPanel` поверх
  `component_qa_runs`; `QaStageRunPanel` работает только на двух других
  вкладках. Две сущности сосуществуют.
- WS-событий нет, живость — опрос панели раз в 1,5 с; индикатора состояния на
  вкладках нет.

## Куда занесено

- docs/kb/features/qa-stage-runs.md (новая тема) + строка в таблице `AGENTS.md`
- docs/kb/features/ci-runner.md — раздел вкладок карточки и «Переход в
  QA-workflow» сжаты до фактов + ссылка
- docs/kb/features/manual-qa.md — абзац о разнице `component_qa_runs` и
  `qa_stage_runs`

## Открытые вопросы / что осталось

- Не покрыты тестами: видимость и автовыбор вкладок в `TaskModal`, REST-маршруты
  и partial unique index на вторую активную попытку.
- Не реализованы действия «Вернуть в Development», «Запросить решение»,
  «Повторить с упавшего шага» и доменное наполнение результата этапа.
