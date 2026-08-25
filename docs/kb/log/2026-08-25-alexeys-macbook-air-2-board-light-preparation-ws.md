---
title: board-light-preparation-ws
date: 2026-08-25
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# board-light-preparation-ws

## Что сделано

- Задача A (preparation/runs дёргался по кругу): список ранов грузится один раз,
  обновления по WS точечно. Клиент (TaskPreparationTab) на событие
  preparation.run.updated догружает только изменившийся ран через новый мост
  tasks:getPreparationRun (GET /api/task-preparation/runs/:runId) и патчит локально;
  коалесинг по runId + троттл 500 мс; reconnect — полная сверка. Сервер коалесит
  дельты стрим-лога до ~1/с на ран (preparationRunDelta в server.ts), переход рана
  сбрасывает окно троттла.
- Задача B (board очень большой): getBoard отдаёт лёгкую карточку — description и
  acceptanceCriteria пустые, taskPreparationLog=null, подзапрос лога убран из
  board-SQL. Полная задача — новый GET /api/projects/:id/tasks/:taskId
  (db.getTaskDetail, мост tasks:get); KanbanBoard грузит её при открытии карточки
  и накладывает тяжёлые тексты поверх живой карточки (состояние fullTask).
- Гейты: shared 553, server 1299, ui 1778, typecheck всего, web build.

## Что выяснили (факты, которых не было в KB)

- В db уже есть приватный getTask(projectId, taskId) (plain SELECT, без board-полей)
  — новый публичный метод назван getTaskDetail во избежание коллизии.
- UI нигде не читает task.taskPreparationLog (только карточка/модалка) — поэтому
  в оверлей полной задачи он не нужен, достаточно description + acceptanceCriteria.
- Тест taskPreparation фиксировал событие на каждую дельту (>=5) — после коалесинга
  ассерт ослаблен до «есть адресные события + board не рассылается на дельтах».

## Куда занесено

- docs/kb/projects.md — раздел «Лёгкая доска и точечные обновления».

## Открытые вопросы / что осталось

- Часть B «WS только при изменении» пока = board.changed (инвалидация) + рефетч
  лёгкого board; настоящий per-card diff по WS (board.task.updated с TaskSummary)
  — дальнейшая оптимизация, сейчас не требуется (payload уже маленький).
- board.ciRuns тоже растёт — кандидат на вынос при необходимости.
