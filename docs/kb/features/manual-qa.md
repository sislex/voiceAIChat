---
title: Структурированное ручное QA
updated: 2026-08-10
checked: 183a5f6
areas:
  - packages/shared/src/qa.ts
  - packages/shared/src/protocol.ts
  - apps/server/src/db/schema.ts
  - apps/server/src/db/database.ts
  - apps/server/src/routes/qa.ts
  - apps/server/src/ci/runManager.ts
  - packages/ui/src/components/qa
  - packages/ui/src/remote/qaBridge.ts
---

# Структурированное ручное QA

## Место в workflow

Успешный development CI без выполненного legacy-шага мержа переводит карточку в
системную колонку `manual_qa`, а не сразу в `awaiting_merge`. Ручная приёмка
завершается отдельной серверной операцией: только успешный
`completeQaSession` переносит карточку в ожидание мержа. Если проект не имеет
колонки `manual_qa`, успешный ран завершается без автоматического переноса.
Точка интеграции с CI находится в `apps/server/src/ci/runManager.ts`.

## Домен и критерий допуска

Общий контракт и чистые правила находятся в `packages/shared/src/qa.ts`.
Acceptance criterion — отдельная сущность; смысловая правка создаёт новую
версию-снимок, связывает её с предыдущей и помечает активную QA session как
устаревшую. Редакционная правка с `semanticChange: false` обновляет текущую
запись без новой версии. Результат старой версии остаётся в истории и не
наследуется новой session.

QA session привязана к задаче, ветке, commit SHA, test run, снимку актуальных
критериев и, если задан, feature-preview. При старте создаётся отдельный
`not_tested`-результат на каждый активный критерий. Одновременно у задачи может
быть только одна активная session. Результаты используют `revision` для
optimistic concurrency; закрытая или stale session не принимает новые правки.

`canCompleteQa` допускает завершение, только когда session активна и не stale,
preview SHA совпадает с commit SHA, а каждый обязательный критерий из snapshot
имеет актуальный результат `passed` либо `not_applicable` с непустым
обоснованием. Missing, failed, blocked, not_tested, in_progress и stale
блокируют переход. Необязательные критерии в текущем gate не обязательны для
завершения.

## Хранение, аудит и маршрутизация

SQLite-схема в `apps/server/src/db/schema.ts` разделяет текущие критерии,
неизменяемые версии, sessions, результаты, issues, attachments и аудит.
`VoiceChatDb` в `apps/server/src/db/database.ts` проверяет принадлежность
task/project/result, QA-разрешение и ревизию результата. QA-действия доступны
владельцу либо участнику с `project_members.qa_permission`; обычного членства
проекта недостаточно для аттестации.

Для финального `failed` обязательны expected/actual, выполненные шаги и
структурированный issue с classification, severity, frequency и reproduction.
`implementation_defect` завершает session неуспешно и возвращает карточку в
`development`; `requirement_change` — в `ready`;
`needs_decision` — в `decision_required`. Проблемы окружения и тестовых
данных оставляют маршрут `manual_qa`. Для `blocked` обязательны причина, тип
и ответственный, для `not_applicable` — причина.

Аудит записывает создание/правку/версионирование критерия, старт и завершение
session, сохранение результата или черновика и добавление вложения. Текущая
реализация не предоставляет отдельный API чтения аудита и не транслирует
изменения QA через WebSocket.

## REST и скриншоты

Маршруты определены в `apps/server/src/routes/qa.ts`, а URL-контракт — в
`packages/shared/src/protocol.ts`. Под
`/api/projects/:projectId/tasks/:taskId/qa` доступны чтение состояния,
создание и пересмотр критерия, старт/завершение session, patch результата и
привязка скриншота.

Изображение сначала загружается в существующий постоянный `UploadStore`, затем
к результату сохраняется непрозрачный upload id и метаданные. Допускается до
десяти PNG, JPEG или WebP по 10 MiB на результат; route сверяет заявленный MIME,
расширение и magic bytes, отбрасывает части пути из имени. Публичный API не
раскрывает filesystem path. Скачать attachment может только участник проекта
через `/api/qa/attachments/:attachmentId`.

Текущая реализация не сохраняет размеры изображения, не удаляет EXIF и не имеет
QA-specific удаления вложений; безопасность и жизненный цикл самих байтов
наследуются от существующего `UploadStore`.

## Интерфейс

`ManualQaPanel` из `packages/ui/src/components/qa/ManualQaPanel.tsx`
встроен в модальное окно обычной задачи. Он показывает состояние session,
прогресс, commit/preview SHA, ссылки на приложение и Storybook, раскрываемые
критерии, формы фактических шагов/результата/комментария, черновик,
Pass/Fail/Blocked/N/A и загрузку нескольких скриншотов. Stale session видна, а
действия результата отключены.

Web-клиент получает `window.qa` через REST-мост
`packages/ui/src/remote/qaBridge.ts`. В панели пока нет UI создания и
версионирования критериев или старта session, назначения тестировщика,
полноценной отдельной формы классификации failed, просмотра версий/аудита,
удаления вложений, realtime-конфликтов и уведомлений связанного чата: серверные
операции для части этих действий существуют, но пользовательский workflow ещё
не закрыт целиком.
