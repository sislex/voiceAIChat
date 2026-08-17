---
title: Feature-preview окружения задач
updated: 2026-08-17
checked: 4cd802b
areas:
  - packages/shared/src/preview.ts
  - packages/shared/src/agentProtocol.ts
  - packages/shared/src/version.ts
  - apps/agent/src/connection.ts
  - apps/server/src/agents/registry.ts
  - apps/server/src/db/database.ts
  - apps/server/src/preview
  - apps/server/src/routes/featurePreview.ts
  - packages/ui/src/components/preview
  - packages/ui/src/remote/featurePreviewBridge.ts
  - packages/ui/src/lib/clipboard.ts
  - apps/desktop/src/renderer/src/main.tsx
  - packages/ui/src/components/ProjectSettings.tsx
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

`POST …/preview/open` повторно проверяет членство пользователя, состояние `running + healthy`, online-статус preview-машины и HTTP-ответ выбранного app/Storybook host-порта. Локальность определяется только точным совпадением `env.agentId` с ID companion-агента текущего desktop-устройства, который desktop получает при регистрации агента и передаёт через `packages/ui/src/remote/featurePreviewBridge.ts`; IP браузера и отображаемое имя машины в решении не участвуют. Непетлевой URL возвращается как `direct`. Локальный loopback-preview тоже возвращается напрямую, но как `http://127.0.0.1:<hostPort>` выбранного сервиса, поэтому app и Storybook открываются на собственных опубликованных host-портах без SSH UI.

Для удалённого loopback-preview первой попыткой служит companion-туннель: сервер принимает только переданный ID принадлежащего пользователю online companion-агента, отличный от preview-агента, и создаёт сессию, привязанную к пользователю, environment id, built SHA и виду сервиса. Одинаковый повторный запрос возвращает тот же локальный порт и не создаёт второй listener. Companion слушает случайный порт только на `127.0.0.1`. TCP-кадры идут через два уже авторизованных agent WebSocket: локальный агент принимает браузерское соединение, preview-агент подключается строго к сохранённому `127.0.0.1:<hostPort>`; клиент не может подменить target host или порт. Формат кадров задан в `packages/shared/src/agentProtocol.ts`, а возможность требует агента версии `0.10.0` по `packages/shared/src/version.ts`. Сессия закрывается по `DELETE …/tunnels/:id`, через 30 минут бездействия, при отключении любого агента и перед stop/remove/rebuild preview. Открытие и любое закрытие пишутся в `qa_audit`.

Если локального companion нет или автоматический туннель завершается ошибкой, сервер может вернуть ручной SSH fallback. Адрес и пользователь берутся только из явно сохранённых `project_machines.ssh_host` и `project_machines.ssh_user`, редактируемых в настройках машины проекта; `agentId` не используется как SSH-hostname. Для команды сервер заранее подбирает свободный локальный порт, а remote port берёт из host-порта выбранного app или Storybook и формирует только `ssh -N -L <localPort>:127.0.0.1:<remotePort> <sshUser>@<sshHost>`. При отсутствующих или небезопасных настройках команда не создаётся, а UI просит заполнить SSH hostname/IP и SSH-пользователя. Пароли, токены и содержимое приватных ключей в этот сценарий не сохраняются и не передаются.

Ручная команда остаётся выделяемым текстом и копируется компонентом `packages/ui/src/components/preview/CopyCommand.tsx` через общий `copyText` из `packages/ui/src/lib/clipboard.ts`. Helper сначала вызывает Clipboard API, а при его отсутствии, отказе или ошибке использует временный textarea и `document.execCommand('copy')`, всегда удаляя поле. Пока попытка выполняется, кнопка заблокирована; успех на две секунды меняет подпись на «Скопировано» и объявляется через `aria-live`, полный отказ показывается рядом и допускает повторную попытку. Изменение или исчезновение команды и размонтирование сбрасывают состояние и очищают таймер; завершение устаревшего async-вызова не обновляет компонент.

## Карточка задачи

`FeaturePreviewSection` в `packages/ui/src/components/preview/FeaturePreviewSection.tsx` встроена в `TaskModal` только для task и показана первой во вкладке «Ручное QA», перед `ManualQaPanel` с тест-кейсами и QA-сессией; в «Настройках» этой секции нет. При mount компонент только читает серверное состояние и не запускает окружение. Во время изменяющей операции он опрашивает сервер каждые 1,5 секунды. Idempotency key кнопки генерируется совместимо: используется `crypto.randomUUID`, затем Web Crypto `getRandomValues`, а для старых webview предусмотрен последний локальный fallback.

Секция показывает branch, workspace, expected/current/built SHA, статус Git-проверки, выбранную машину, health, seed-сценарий, ошибку и последнее сохранённое лог-сообщение. Для `running + healthy` выводится основная кнопка «Открыть проект», а для готового Storybook — отдельная кнопка. Внешний URL открывается напрямую; loopback URL открывается через персональный туннель companion-агента. Внутренние URL и host-порты оставлены в раскрываемом техническом блоке. Действия вычисляются из shared-контракта; reset, remove и установка Docker требуют подтверждения. При несовпадении SHA старое окружение остаётся доступным, но UI показывает stale-предупреждение и предлагает пересборку. После подтверждённого `running + healthy` manager сохраняет `tasks.preview_ready`; карточка доски получает зелёную пульсацию, а stop/remove/failure/reconcile снимают признак. При `prefers-reduced-motion` остаётся статичная зелёная рамка.

## Docker, Storybook и изоляция

`compose.preview.yml` содержит app и статический Storybook, публикует оба сервиса только на loopback и использует отдельный named volume для preview-данных. Сервисы имеют CPU/memory limits, собственные healthchecks, не получают production data, LLM CLI-профили или credentials. Порты берутся из диапазона 18000–19999: allocator проверяет bind на машине и исключает порты сохранённых окружений.

В `Dockerfile` Storybook собирается отдельной веткой `storybook-build` командой `npm run build:storybook` и отдаётся target `storybook-runtime` через nginx. Production target эту сборку не выполняет. App и Storybook собираются из одного workspace и после успешного запуска получают один commit SHA.

## Фактические границы реализации

Проектная форма для изменения `PreviewConfig`, автоматический cleanup workspace после Done, idle auto-stop самого Docker-preview и лимиты одновременных preview/build ещё не подключены. Seed/reset вызывают проектные npm-команды, но готовые сценарии и сами команды в этом срезе не добавлены. Stale автоматически определяется при смене машины workspace и при явной health/reconcile-проверке SHA; простое появление нового коммита без такой проверки сервер пока не отслеживает.
