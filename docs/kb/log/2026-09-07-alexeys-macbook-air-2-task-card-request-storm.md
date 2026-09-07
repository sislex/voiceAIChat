---
title: task-card-request-storm
date: 2026-09-07
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# task-card-request-storm

## Что сделано

- `TaskCardContainer`: загрузчик истории доработок перенесён в `useRef`, эффект
  зависит от `task.id` и `task.updatedAt`; в `App.tsx` проп обёрнут в
  `useCallback`.
- `CiTaskSettings`: эффект грузит только данные своей секции
  (`commands` → `listCommands` + `getTaskCi`, `model` → `getTaskCiLlm`,
  `machine` → `getTaskMachines`).
- `TaskModal`: панель «Настройки выполнения» монтируется лениво при первом
  заходе на вкладку и дальше не размонтируется.
- `App.tsx`: `refreshClarificationNotifications` больше не зависит от
  `clarificationErrors` (они читаются через ref) — эффект realtime-подписки не
  пересоздаётся и не дёргает список уведомлений заново.
- Тесты: секционная загрузка `CiTaskSettings`, ленивый монтаж настроек в
  `TaskModal`, стабильность истории доработок в `NewTaskCardView.dom.test.tsx`.

## Что выяснили (факты, которых не было в KB)

- Замер на проде (Chrome, network) для `#/projects/:id/task/:taskId/preparation`:
  `rework-cycles` уходил ~1 раз в секунду непрерывно; `ci/commands`,
  `tasks/:id/ci`, `ci/llm`, `ci/machines` — ровно по 3 раза (три экземпляра
  `CiTaskSettings`), плюс четвёртый `ci/machines` от `TaskPreparationTab`.
- `/api/task-preparation/notifications` за загрузку уходил один раз и в
  наблюдении не повторялся: серверный `notificationHub.emit` зовётся только из
  dismiss-роута, приглашений и смены членства — комментарий в `session.ts` про
  «приходит на каждое событие рана» описывает не этот кадр.
- Тест «размонтирует скрытую Merge-панель» ходил на вкладку «Настройки» как на
  нейтральную; с ленивым монтажом она сама просит машины задачи, поэтому в тесте
  промежуточная вкладка теперь «Общее».

## Куда занесено

- docs/kb/projects.md — раздел «Новая и legacy-версия карточки».

## Открытые вопросы / что осталось

- `ci/machines` после первой загрузки по вебсокету не обновляется: события
  «состав машин задачи изменился» в протоколе нет. Появится — подписать
  `CiTaskSettings`/`TaskPreparationTab`.
- На загрузке страницы дублируются `session/me`, `/api/projects` и `/api/health`
  (по два запроса) — отдельный, ещё не разобранный случай.
