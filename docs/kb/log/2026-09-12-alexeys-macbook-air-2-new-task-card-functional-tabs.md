---
title: new-task-card-functional-tabs
date: 2026-09-12
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# new-task-card-functional-tabs

## Что сделано

- Создана задача CHAT-445 «Функциональные вкладки новой карточки задачи по Make
  «Проект 19»» (проект ChatAI, To Do) и связана с Make-проектом
  `e7b501e7-a0b5-4c00-bb20-e8743e25011f` целиком.
- Все вкладки новой карточки (`TaskCardContainer.renderPanel`) переведены на панели
  макета: `NewTaskPreparationPanel`, `NewTaskProgressPanel`, `NewTaskQaStagesPanel`,
  `NewTaskManualQaPanel`, `NewTaskMergePanel`, `NewTaskSettingsPanel`, `NewTaskFeedPanel`
  поверх общих блоков `NewTaskStages.tsx` и чистых помощников `taskCycles.ts`.
  Функциональность — из legacy-панелей, встроенных в выбранный этап рейки; у них
  появились пропсы `runId`/`selectedRunId`, `onStateChange`/`onRunsChange`, `hideHistory`.
- «Общее»: редактор связи с Make (связать / заменить / удалить, весь проект или
  файлы), время этапов workflow из таймлайна и живой счётчик текущего этапа.
- «Доработки»: очередь черновиков с множественным выбором и отправкой выбранных
  одним циклом (`mergeDraftInputs`), история циклов со ссылками на подготовку и
  ход выполнения, «Добавить» доступна всегда.
- Версия карточки запоминается в `localStorage` (`vc.taskCard.version`).
- Починена полоса вкладок новой карточки: на высоте окна ~800px тело требовало
  580px и flex-колонка ужимала tablist до 1px.
- Тесты: `taskCycles.test.ts`, `NewTaskStages.dom.test.tsx`, dom-тесты всех новых
  панелей, дополнены тесты `NewTaskCardView` и `TaskCardContainer`; сториз
  `NewTaskStages.stories.tsx`; гейт `npm run gate:fast` зелёный.

## Что выяснили (факты, которых не было в KB)

- Задача из board-payload не содержит `designs`; связи с Make новая карточка грузит
  сама через `tasks:designs`, а `tasks:linkDesign`/`unlinkDesign` возвращают свежий список.
- `submitReworkDraft` после первой отправки переводит задачу в `preparation`, и второй
  submit получает 409 — поэтому «Отправить выбранные» сливает черновики в один.
- `uploadIds` черновика резолвятся через `uploads.get`; id вложения цикла совпадает
  с id загрузки, так что вложения соседних черновиков переносятся при слиянии.
- Типы этапов таймлайна: `task_preparation`, `development`, `component_qa`,
  `integration_tests`, `automated_qa`, `manual_qa_preparation`, `manual_qa`.
- Локальный шлюз `/private/tmp/voicechat-local-production/gateway.mts` (порт 8802)
  регистрирует статику `apps/web/dist` при старте (`wildcard: false`): после
  `npm run -w @voicechat/web build` новые хэшированные ассеты отдаются как
  `index.html`, и приложение не монтируется — шлюз нужно перезапустить
  (`launch.py`), после чего старые вкладки браузера подвисают на реконнекте.

## Куда занесено

- docs/kb/projects.md — раздел «Новая и legacy-версия карточки», абзац
  «Функциональные вкладки по макету (2026-09-12, CHAT-445)».

## Открытые вопросы / что осталось

- Изменения не закоммичены: коммит и PR — по запросу пользователя.
- В сториз новой карточки нет контейнерных историй с фейковыми мостами для рейки
  QA/merge — только презентационные `NewTaskStages`.
- Переключение выбранного этапа ремонтирует legacy-панель (повторная загрузка её
  состояния); пока панель грузится, рейка держит прежние статусы.
