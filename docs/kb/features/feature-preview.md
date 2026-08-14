---
title: Feature-preview окружения задач
updated: 2026-08-14
checked: 6f55583
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

Feature-preview — отдельное управляемое окружение для workspace конкретной задачи. Оно не использует production deploy и не запускается при создании задачи, development-run, открытии карточки или завершении работы модели. Первый build начинается только после явной операции `start` из секции «Тестовое окружение» в карточке. Пользователь может выбрать любую машину проекта: на машине последнего CI используется её активный workspace, а на другой машине manager клонирует зафиксированную feature-ветку в стабильный каталог `<repos_root>/<project-key>/<issue_key>`, не переключая обычный checkout проекта.

Общий контракт состояний, операций и данных окружения находится в `packages/shared/src/preview.ts`. Там же сосредоточены правила доступных действий, признак занятого состояния и проверка готовности цели Playwright; сервер и UI не восстанавливают эти правила из Docker-лога.

## Серверное состояние и операции

`FeaturePreviewManager` в `apps/server/src/preview/manager.ts` хранит окружения, историю операций и idempotency keys в `feature-previews.json` каталога данных сервера. Запись выполняется атомарной заменой файла, на пару project/task остаётся не более одного окружения, а повтор операции с тем же ключом возвращает прежнюю запись. Потоковый лог каждого run ограничен 500 КБ. Перед сборкой и запуском manager отдельно проверяет наличие Docker CLI и доступность Docker Engine: ошибки сохраняются как «Docker не установлен» или «Docker установлен, но не запущен», а не теряются за одним exit code. UI предлагает отдельные операции `docker_start` и подтверждаемую `docker_install`: macOS использует Docker Desktop/Homebrew, Linux — systemd/service и apt с уже настроенным беспарольным sudo; неподдерживаемая платформа или отсутствие необходимых прав возвращают явную инструкцию.

Перед изменяющей операцией менеджер проверяет доступ к проекту, существование task, снимок последнего CI-workspace, привязку машины, online-статус и нахождение workspace внутри разрешённого `repos_root`. Перед start/rebuild активная копия обязана быть чистой, находиться на зафиксированной ветке/SHA и иметь тот же SHA в origin; на другой машине branch и SHA берутся только из сохранённого результата разработки, remote проверяется до clone/fetch и HEAD сверяется до сборки. Одновременно для окружения разрешена одна изменяющая операция; отмена передаётся исполнителю через `AbortSignal`. Compose project формируется функцией `safePreviewResourceName` только из очищенных server id, без заголовка задачи.

Операции выполняются на машине workspace через общий CI `CommandExecutor` с фиксированным `compose.preview.yml`. `start` и `rebuild` определяют текущие branch/SHA, выделяют проверенные bind-порты, собирают образы, запускают Compose с ожиданием healthcheck и сохраняют built SHA. Повторный `start` остановленного окружения с другим SHA завершается ошибкой и требует `rebuild`. `stop` сохраняет workspace и volume, `remove` удаляет только Compose-ресурсы этого preview с volumes, а `seed` и `reset` принимают сценарий только в безопасном формате идентификатора.

При старте сервера `reconcile()` переводит сохранённые промежуточные состояния в `failed` как прерванные рестартом и отдельно отмечает недоступную машину. Он не удаляет неизвестные Docker-ресурсы и пока не сверяет контейнеры, порты и health в полном объёме.

## REST и Playwright

Маршруты `apps/server/src/routes/featurePreview.ts` зарегистрированы под `/api/projects/:projectId/tasks/:taskId/preview`: состояние, запуск операции, отмена, read-only лог run и получение Playwright target. Target возвращается только для `running` + healthy окружения, когда requested SHA совпадает с built и current SHA, данные подготовлены и существует app URL; иначе сервер отвечает конфликтом готовности.

В web-клиенте `packages/ui/src/remote/featurePreviewBridge.ts` устанавливает `window.featurePreview` поверх REST с пользовательским Bearer-токеном. Отсутствующее окружение при GET преобразуется в `null`.

## Доступ и companion-туннели

`POST …/preview/open` повторно проверяет членство пользователя, состояние `running + healthy`, online-статус preview-машины и HTTP-ответ выбранного app/Storybook host-порта. Непетлевой URL возвращается как `direct`. Для loopback-сервиса сервер выбирает отдельный online companion-агент текущего пользователя и создаёт сессию, привязанную к пользователю, environment id, built SHA и виду сервиса. Одинаковый повторный запрос возвращает тот же локальный порт и не создаёт второй listener.

Companion слушает случайный порт только на `127.0.0.1`. TCP-кадры идут через два уже авторизованных agent WebSocket: локальный агент принимает браузерское соединение, preview-агент подключается строго к сохранённому `127.0.0.1:<hostPort>`; клиент не может подменить target host или порт. Пароли и SSH-ключи в протокол не входят. Сессия закрывается по `DELETE …/tunnels/:id`, через 30 минут бездействия, при отключении любого агента и перед stop/remove/rebuild preview. Открытие и явное закрытие пишутся в `qa_audit`.

Если подходящего личного агента нет или соединение не поднялось, ответ содержит внутренний URL, порт и готовую команду `ssh -N -L`; UI показывает её с копированием и поясняет, что SSH credentials остаются на рабочей машине.

## Карточка задачи

`FeaturePreviewSection` в `packages/ui/src/components/preview/FeaturePreviewSection.tsx` встроена в `TaskModal` только для task. При mount компонент только читает серверное состояние и не запускает окружение. Во время изменяющей операции он опрашивает сервер каждые 1,5 секунды. Idempotency key кнопки генерируется совместимо: используется `crypto.randomUUID`, затем Web Crypto `getRandomValues`, а для старых webview предусмотрен последний локальный fallback.

Секция показывает branch, workspace, expected/current/built SHA, статус Git-проверки, выбранную машину, health, seed-сценарий, ошибку и последнее сохранённое лог-сообщение. Для `running + healthy` выводится основная кнопка «Открыть проект», а для готового Storybook — отдельная кнопка. Внешний URL открывается напрямую; loopback URL открывается через персональный туннель companion-агента. Внутренние URL и host-порты оставлены в раскрываемом техническом блоке. Действия вычисляются из shared-контракта; reset, remove и установка Docker требуют подтверждения. При несовпадении SHA старое окружение остаётся доступным, но UI показывает stale-предупреждение и предлагает пересборку. После подтверждённого `running + healthy` manager сохраняет `tasks.preview_ready`; карточка доски получает зелёную пульсацию, а stop/remove/failure/reconcile снимают признак. При `prefers-reduced-motion` остаётся статичная зелёная рамка.

## Docker, Storybook и изоляция

`compose.preview.yml` содержит app и статический Storybook, публикует оба сервиса только на loopback и использует отдельный named volume для preview-данных. Сервисы имеют CPU/memory limits, собственные healthchecks, не получают production data, LLM CLI-профили или credentials. Порты берутся из диапазона 18000–19999: allocator проверяет bind на машине и исключает порты сохранённых окружений.

В `Dockerfile` Storybook собирается отдельной веткой `storybook-build` командой `npm run build:storybook` и отдаётся target `storybook-runtime` через nginx. Production target эту сборку не выполняет. App и Storybook собираются из одного workspace и после успешного запуска получают один commit SHA.

## Фактические границы реализации

Проектная форма для изменения `PreviewConfig`, автоматический cleanup workspace после Done, idle auto-stop самого Docker-preview и лимиты одновременных preview/build ещё не подключены. Seed/reset вызывают проектные npm-команды, но готовые сценарии и сами команды в этом срезе не добавлены. Stale автоматически определяется при смене машины workspace и при явной health/reconcile-проверке SHA; простое появление нового коммита без такой проверки сервер пока не отслеживает.
