---
title: Feature-preview окружения задач
updated: 2026-08-10
checked: 3899375
areas:
  - packages/shared/src/preview.ts
  - apps/server/src/preview
  - apps/server/src/routes/featurePreview.ts
  - packages/ui/src/components/preview
  - packages/ui/src/remote/featurePreviewBridge.ts
  - compose.preview.yml
  - Dockerfile
---

# Feature-preview окружения задач

## Назначение и запуск

Feature-preview — отдельное управляемое окружение для workspace конкретной задачи. Оно не использует production deploy и не запускается при создании задачи, development-run, открытии карточки или завершении работы модели. Первый build начинается только после явной операции `start` из секции «Тестовое окружение» в карточке.

Общий контракт состояний, операций и данных окружения находится в `packages/shared/src/preview.ts`. Там же сосредоточены правила доступных действий, признак занятого состояния и проверка готовности цели Playwright; сервер и UI не восстанавливают эти правила из Docker-лога.

## Серверное состояние и операции

`FeaturePreviewManager` в `apps/server/src/preview/manager.ts` хранит окружения, историю операций и idempotency keys в `feature-previews.json` каталога данных сервера. Запись выполняется атомарной заменой файла, на пару project/task остаётся не более одного окружения, а повтор операции с тем же ключом возвращает прежнюю запись. Потоковый лог каждого run ограничен 500 КБ.

Перед изменяющей операцией менеджер проверяет доступ к проекту, существование task, активный CI-workspace, привязку машины, online-статус и нахождение workspace внутри разрешённого `repos_root`. Одновременно для окружения разрешена одна изменяющая операция; отмена передаётся исполнителю через `AbortSignal`. Compose project формируется функцией `safePreviewResourceName` только из очищенных server id, без заголовка задачи.

Операции выполняются на машине workspace через общий CI `CommandExecutor` с фиксированным `compose.preview.yml`. `start` и `rebuild` определяют текущие branch/SHA, выделяют проверенные bind-порты, собирают образы, запускают Compose с ожиданием healthcheck и сохраняют built SHA. Повторный `start` остановленного окружения с другим SHA завершается ошибкой и требует `rebuild`. `stop` сохраняет workspace и volume, `remove` удаляет только Compose-ресурсы этого preview с volumes, а `seed` и `reset` принимают сценарий только в безопасном формате идентификатора.

При старте сервера `reconcile()` переводит сохранённые промежуточные состояния в `failed` как прерванные рестартом и отдельно отмечает недоступную машину. Он не удаляет неизвестные Docker-ресурсы и пока не сверяет контейнеры, порты и health в полном объёме.

## REST и Playwright

Маршруты `apps/server/src/routes/featurePreview.ts` зарегистрированы под `/api/projects/:projectId/tasks/:taskId/preview`: состояние, запуск операции, отмена, read-only лог run и получение Playwright target. Target возвращается только для `running` + healthy окружения, когда requested SHA совпадает с built и current SHA, данные подготовлены и существует app URL; иначе сервер отвечает конфликтом готовности.

В web-клиенте `packages/ui/src/remote/featurePreviewBridge.ts` устанавливает `window.featurePreview` поверх REST с пользовательским Bearer-токеном. Отсутствующее окружение при GET преобразуется в `null`.

## Карточка задачи

`FeaturePreviewSection` в `packages/ui/src/components/preview/FeaturePreviewSection.tsx` встроена в `TaskModal` только для task. При mount компонент только читает серверное состояние и не запускает окружение. Во время изменяющей операции он опрашивает сервер каждые 1,5 секунды.

Секция показывает branch, built/current SHA, машину, health, seed-сценарий, ошибку и последнее сохранённое лог-сообщение. Действия вычисляются из shared-контракта; reset и remove требуют подтверждения. При несовпадении SHA старое окружение остаётся доступным, но UI показывает stale-предупреждение и предлагает пересборку.

## Docker, Storybook и изоляция

`compose.preview.yml` содержит app и статический Storybook, публикует оба сервиса только на loopback и использует отдельный named volume для preview-данных. Сервисы имеют CPU/memory limits, собственные healthchecks, не получают production data, LLM CLI-профили или credentials. Порты берутся из диапазона 18000–19999: allocator проверяет bind на машине и исключает порты сохранённых окружений.

В `Dockerfile` Storybook собирается отдельной веткой `storybook-build` командой `npm run build:storybook` и отдаётся target `storybook-runtime` через nginx. Production target эту сборку не выполняет. App и Storybook собираются из одного workspace и после успешного запуска получают один commit SHA.

## Фактические границы реализации

Проектная форма для изменения `PreviewConfig`, reverse proxy с ACL для удалённого доступа к loopback URL, аудит и WS-события, автоматический cleanup workspace после Done, idle auto-stop и лимиты одновременных preview/build ещё не подключены. Seed/reset вызывают проектные npm-команды, но готовые сценарии и сами команды в этом срезе не добавлены. Stale автоматически определяется при смене машины workspace и при явной health/reconcile-проверке SHA; простое появление нового коммита без такой проверки сервер пока не отслеживает.
