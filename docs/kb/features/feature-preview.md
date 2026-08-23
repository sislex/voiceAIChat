---
title: Feature-preview окружения задач
updated: 2026-08-23
checked: a008ec0e
areas:
  - packages/shared/src/preview.ts
  - packages/shared/src/projects.ts
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

Feature-preview — отдельное управляемое окружение для workspace конкретной задачи. Оно не использует production deploy и не запускается при создании задачи, development-run, открытии карточки или завершении работы модели. Первый build начинается только после явной операции `start` из секции «Тестовое окружение» в карточке. Для нового preview пользователь выбирает машину проекта с настроенным MachineStorage; manager берёт зафиксированную и подтверждённую в origin feature-ветку/SHA из последнего CI-workspace и готовит отдельный checkout внутри managed-окружения, не переключая обычный checkout проекта.

Общий контракт состояний, операций и данных окружения находится в `packages/shared/src/preview.ts`. Там же сосредоточены правила доступных действий, признак занятого состояния и проверка готовности цели Playwright; сервер и UI не восстанавливают эти правила из Docker-лога.

Канонические абсолютные пути task preview для POSIX и Windows одним вызовом строит `managedPreviewEnvironmentPaths` из `packages/shared/src/projects.ts`. Корень имеет вид `<storageRoot>/projects/<projectId>/tasks/<taskId>/environments/preview/<previewId>`, а checkout всегда находится в `temporary/repository`; там же helper задаёт `app`, `config`, `logs`, `artifacts`, `temporary` и `environment.json`. Стабильным `previewId` служит `PreviewEnvironment.id`, поэтому повторные lifecycle-операции восстанавливают тот же путь.

## Серверное состояние и операции

`FeaturePreviewManager` в `apps/server/src/preview/manager.ts` хранит окружения, историю операций и idempotency keys в `feature-previews.json` каталога данных сервера. Запись выполняется атомарной заменой файла, на пару project/task остаётся не более одного окружения. Повтор с тем же ключом возвращает прежнюю запись; пока попытка активна, эквивалентный `start`/`rebuild` для той же машины возвращает её же и при другом ключе, поэтому второй контейнер не создаётся. Каждый run хранит владельца, машину, workspace, ключ конфигурации, серверные времена, версию, текущий этап, события, код выхода и результат. Потоковый лог ограничен 500 КБ, события — 2000 записями; token/password/secret/api-key, Bearer и приватные ключи редактируются до сохранения. Перед сборкой manager отдельно проверяет Docker CLI и Engine, сохраняя структурированные категории `docker_missing`, `docker_daemon_unavailable` и `docker_permission_denied`. UI предлагает `docker_start` и подтверждаемую `docker_install`: macOS использует Docker Desktop/Homebrew, Linux — systemd/service и apt с беспарольным sudo.

Для нового managed-preview менеджер проверяет доступ к проекту и task, online-статус выбранной машины, привязанный к ней storage, его root и marker, попадание preview root в `policy.allowedDirs`, отсутствие симлинков в компонентах пути и возможность контрольной записи. Затем создаёт стандартные каталоги и типизированный `environment.json`: format version, kind `preview`, project/task, storage/machine identity и время создания окружения. Общий publisher из `apps/server/src/manifests.ts` создаёт его через temp-файл и remote rename, подтверждает эквивалентный существующий manifest и не перезаписывает повреждённый, неподдерживаемой версии или конфликтующий файл. Checkout клонируется либо обновляется до зафиксированных ветки/SHA из origin и обязан оставаться чистым.

`PreviewEnvironment.managed` сохраняет format version, storage id, machine id и preview root, а `workspacePath` — канонический `temporary/repository`. Start, rebuild, stop, health-check, reconcile, Playwright-target и Docker-команды тем самым работают с одной persisted-записью и повторно проверяемым helper path. Записи без `managed` считаются legacy: их прежний `workspacePath` сохраняется, автоматической миграции и файлового удаления для них нет.

Одновременно для окружения разрешена одна изменяющая операция. Статусы попытки: `queued`, `running`, `cancelling`, `succeeded`, `failed`, `cancelled`; терминальная попытка больше не изменяется. Повторная отмена безопасна: активная попытка сначала сохраняется как `cancelling`, исполнителю передаётся `AbortSignal`, затем для start/rebuild выполняется `docker compose down --remove-orphans`, а итог очистки сохраняется в результате. Compose project включает очищенные project/task id и короткий фрагмент preview id, изолируя Docker-ресурсы отдельных incarnations preview.

После проверки зафиксированного source SHA и до Docker-команд managed-preview атомарно публикует `runs/<runId>/run.json` с identity запуска, инициатором, машиной, workspace, веткой и временами. При любом терминальном исходе рядом публикуется `report.json`: success сохраняет final commit, failed/cancelled — структурированные редактированные ошибки, cancelled — `cancelledAt`; восстановление активной попытки после рестарта публикует status `interrupted` и `interruptedAt`. Checks строятся из сохранённых шагов, artifacts пока пусты. Контракты и проверка allowlist находятся в `packages/shared/src/manifests.ts`; прочие development/QA/merge/release менеджеры этот writer пока не вызывают.

Операции выполняются через общий CI `CommandExecutor` с `compose.preview.yml`. Start/rebuild сохраняет этапы: машина, workspace, конфигурация и Docker, образ, сборка, создание/запуск контейнера, публикация порта, HTTP health check приложения, адрес подключения и готовность. У этапа стабильный id, `pending/running/succeeded/failed/skipped/cancelled`, времена, пояснение и техническая ошибка; неприменимый отдельный pull и повторная сборка получают `skipped` с причиной. Прогресс — доля `succeeded + skipped` от фиксированных этапов и не обещает точность времени. Готовность фиксируется только после успешного `curl` к настроенному health path на фактически опубликованном app-порту; Docker running и опубликованный порт отмечаются раньше отдельными этапами. Повторный start остановленного окружения с другим SHA требует rebuild. Stop сохраняет workspace/volume, а remove сначала выполняет `docker compose down --volumes --remove-orphans`, затем повторно вычисляет канонические пути, типизированно читает `environment.json`, сверяет его identity с persisted managed metadata и удаляет только root конкретного preview id. Любое расхождение или отсутствующий/повреждённый manifest отклоняет файловый cleanup. Seed/reset принимают только безопасный id сценария.

При старте сервера `reconcile()` атомарно закрывает сохранённую активную попытку как `failed/connection_lost`, завершает её текущий этап и пропускает хвост, после чего для managed-preview публикует терминальный report со статусом `interrupted`; недоступная машина отмечается отдельно. Он не удаляет неизвестные Docker-ресурсы и пока не сверяет контейнеры, порты и health в полном объёме.

## REST и Playwright

Маршруты `apps/server/src/routes/featurePreview.ts` зарегистрированы под `/api/projects/:projectId/tasks/:taskId/preview`: состояние, запуск операции, отмена, read-only лог run и получение Playwright target. Target возвращается только для `running` + healthy окружения, когда requested SHA совпадает с built и current SHA, данные подготовлены и существует app URL; иначе сервер отвечает конфликтом готовности.

В web-клиенте `packages/ui/src/remote/featurePreviewBridge.ts` устанавливает `window.featurePreview` поверх REST с пользовательским Bearer-токеном. Отсутствующее окружение при GET преобразуется в `null`.

## Доступ и companion-туннели

`POST …/preview/open` повторно проверяет членство пользователя, состояние `running + healthy`, online-статус preview-машины и HTTP-ответ выбранного app/Storybook host-порта. Локальность определяется только точным совпадением `env.agentId` с ID companion-агента текущего desktop-устройства, который desktop получает при регистрации агента и передаёт через `packages/ui/src/remote/featurePreviewBridge.ts`; IP браузера и отображаемое имя машины в решении не участвуют. Непетлевой URL возвращается как `direct`. Локальный loopback-preview тоже возвращается напрямую, но как `http://127.0.0.1:<hostPort>` выбранного сервиса, поэтому app и Storybook открываются на собственных опубликованных host-портах без SSH UI.

Для удалённого loopback-preview первой попыткой служит companion-туннель: сервер принимает только переданный ID принадлежащего пользователю online companion-агента, отличный от preview-агента, и создаёт сессию, привязанную к пользователю, environment id, built SHA и виду сервиса. Одинаковый повторный запрос возвращает тот же локальный порт и не создаёт второй listener. Companion слушает случайный порт только на `127.0.0.1`. TCP-кадры идут через два уже авторизованных agent WebSocket: локальный агент принимает браузерское соединение, preview-агент подключается строго к сохранённому `127.0.0.1:<hostPort>`; клиент не может подменить target host или порт. Формат кадров задан в `packages/shared/src/agentProtocol.ts`, а возможность требует агента версии `0.10.0` по `packages/shared/src/version.ts`. Сессия закрывается по `DELETE …/tunnels/:id`, через 30 минут бездействия, при отключении любого агента и перед stop/remove/rebuild preview. Открытие и любое закрытие пишутся в `qa_audit`.

Если локального companion нет или автоматический туннель завершается ошибкой, сервер может вернуть ручной SSH fallback. Адрес и пользователь берутся только из явно сохранённых `project_machines.ssh_host` и `project_machines.ssh_user`, редактируемых в настройках машины проекта; `agentId` не используется как SSH-hostname. Для команды сервер заранее подбирает свободный локальный порт, а remote port берёт из host-порта выбранного app или Storybook и формирует только `ssh -N -L <localPort>:127.0.0.1:<remotePort> <sshUser>@<sshHost>`. При отсутствующих или небезопасных настройках команда не создаётся, а UI просит заполнить SSH hostname/IP и SSH-пользователя. Пароли, токены и содержимое приватных ключей в этот сценарий не сохраняются и не передаются.

Ручная команда остаётся выделяемым текстом и копируется компонентом `packages/ui/src/components/preview/CopyCommand.tsx` через общий `copyText` из `packages/ui/src/lib/clipboard.ts`. Helper сначала вызывает Clipboard API, а при его отсутствии, отказе или ошибке использует временный textarea и `document.execCommand('copy')`, всегда удаляя поле. Пока попытка выполняется, кнопка заблокирована; успех на две секунды меняет подпись на «Скопировано» и объявляется через `aria-live`, полный отказ показывается рядом и допускает повторную попытку. Изменение или исчезновение команды и размонтирование сбрасывают состояние и очищают таймер; завершение устаревшего async-вызова не обновляет компонент.

## Карточка задачи

`FeaturePreviewSection` встроена в `TaskModal` только для task и первой показана во вкладке «Ручное QA». При mount она только читает серверный снимок. После клика start/rebuild ещё до ответа POST кнопка меняется на «Запускаем тестовый контейнер…», блокируется, появляется loader, неопределённая полоса и локальный таймер; отказ POST прекращает loader и показывает ошибку. После получения попытки таймер считается от серверного `startedAt`, полоса — по этапам. Во время операции снимок опрашивается каждые 1,5 секунды, поэтому состояние, журнал и таймер восстанавливаются после remount/перезагрузки; version/event данные устраняют смысловой откат этапов на стороне сервера. Раскрытие «Подробнее» принадлежит только локальному состоянию пользователя и входящие снимки его не меняют. Idempotency key создаётся через randomUUID, getRandomValues или fallback.

Секция показывает этап и пояснение, прошедшее время, доступный progressbar, подробный список этапов и безопасный журнал, а также branch/workspace/SHA, машину, health, seed и ошибку. Определённая полоса получает aria-valuenow; до серверного снимка она неопределённая и без процента. `aria-live` объявляет компактный статус, журнал не озвучивается. На reduced motion loader и неопределённая полоса статичны; на мобильной ширине сетка и действия складываются без горизонтального скролла. Для `running + healthy` доступны «Открыть проект» и отдельно Storybook. Внешний URL открывается напрямую, loopback — через companion-туннель; внутренние URL/порты остаются в техническом блоке. Reset/remove/установка Docker требуют подтверждения. После подтверждённого health manager сохраняет `tasks.preview_ready`; stop/remove/failure/reconcile снимают признак.

## Docker, Storybook и изоляция

`compose.preview.yml` содержит app и статический Storybook, публикует оба сервиса только на loopback и использует отдельный named volume для preview-данных. Сервисы имеют CPU/memory limits, собственные healthchecks, не получают production data, LLM CLI-профили или credentials. Порты берутся из диапазона 18000–19999: allocator проверяет bind на машине и исключает порты сохранённых окружений.

В `Dockerfile` Storybook собирается отдельной веткой `storybook-build` командой `npm run build:storybook` и отдаётся target `storybook-runtime` через nginx. Production target эту сборку не выполняет. App и Storybook собираются из одного workspace и после успешного запуска получают один commit SHA.

## Фактические границы реализации

Проектная форма для изменения `PreviewConfig`, автоматический cleanup workspace после Done, idle auto-stop самого Docker-preview и лимиты одновременных preview/build ещё не подключены. Seed/reset вызывают проектные npm-команды, но готовые сценарии и сами команды в этом срезе не добавлены. Stale автоматически определяется при смене машины workspace и при явной health/reconcile-проверке SHA; простое появление нового коммита без такой проверки сервер пока не отслеживает.
