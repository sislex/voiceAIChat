---
title: Версионные release-ветки и публикация в production
updated: 2026-09-12
checked: bfd81c90
areas:
  - packages/shared/src/applicationCatalog.ts
  - packages/shared/src/applicationRelease.ts
  - packages/shared/src/applicationDeployment.ts
  - scripts/application-build.mjs
  - scripts/application-deploy.mjs
  - scripts/application-gate.mjs
  - scripts/application-compatibility.mjs
  - apps/server/src/routes/applicationReleases.ts
  - packages/shared/src/release.ts
  - packages/shared/src/protocol.ts
  - packages/shared/src/ipc.ts
  - packages/shared/src/projects.ts
  - apps/server/src/releases
  - scripts/affected-check.mjs
  - scripts/prod/deploy.sh
  - Dockerfile
  - docker-compose.yml
  - apps/server/src/makeBridge/remote.ts
  - apps/server/src/routes/releases.ts
  - apps/server/src/routes/projects.ts
  - apps/server/src/db/schema.ts
  - apps/server/src/db/database.ts
  - apps/server/src/server.ts
  - packages/ui/src/components/releases
  - packages/ui/src/components/ProjectSettings.tsx
  - packages/ui/src/components/ProjectPage.tsx
  - packages/ui/src/App.tsx
  - packages/ui/src/remote/httpApi.ts
  - packages/ui/src/styles/app.css
---

# Версионные release-ветки и публикация в production

## Release-ветки

Legacy-вкладка центра релизов работает с удалёнными ветками строгого вида `release/x.y.z` без ведущих нулей. Общая валидация находится в `packages/shared/src/release.ts`. Создать ветку может только владелец. Машина подготовки больше не связана с default-машиной задач и чатов: Release Center загружает отдельный отфильтрованный сервером каталог через `GET /api/projects/:id/releases/machines` (`apps/server/src/releases/targets.ts`, `apps/server/src/routes/releases.ts`). Каталог строится из `listUsableAgents(userId, projectId)`, поэтому содержит только личные и предоставленные проекту машины, доступные текущему участнику, без клиентского объединения списков; для каждой записи сервер возвращает владение, уровень доступа, online, настроенные `path`/`reposRoot`, признак пригодности и точную причину отказа. Для сборки пригодна только online-машина с доступом `owner` или `full` и хотя бы одним из `project_machines.path` или `reposRoot`; read-only, offline и машина без обоих путей остаются видимыми, но недоступны для выбора.

При загрузке формы выбирается последняя пригодная release-машина этой пары пользователь–проект, иначе первая пригодная; если вариантов нет, запуск заблокирован. Пользовательский выбор уходит как `agentId` в `POST /api/projects/:id/releases/branches`. Backend независимо заново проверяет членство и наличие машины в том же каталоге, её пригодность и `canWriteAgent`, поэтому подмена id или устаревшее состояние UI не обходят доступ. При пустом `path` и заполненном `reposRoot` checkout остаётся `<reposRoot>/.release_repo`. `ReleaseManager.createBranch` сначала принимает запуск и создаёт запись с фактически разрешёнными `agentId` и `checkoutPath`; только после этого роут сохраняет agent id в `user_project_release_machines` через `setUserProjectReleaseMachine`. Таблица имеет ключ `(username, project_id)`, поэтому предпочтение изолировано по пользователю и проекту и не меняет `user_project_machine_defaults`, `execTarget` или выбор машины чатов/задач. Ошибка разрешения target либо отказ менеджера предпочтение не меняет. Production-машина настраивается и используется отдельно.

Создание ветки сразу запускает самостоятельную подготовку. Первый шаг `checkout` («Подготовка checkout») выполняется под общим замком подготовки проекта: для настроенного `path` он `skipped` с логом «Используется существующий checkout», а для release checkout идемпотентно клонирует `project.gitUrl` в `<repos_root>/.release_repo`. Существующий каталог переиспользуется только при точном совпадении `remote.origin.url`; каталог с чужим origin не удаляется и завершает шаг ошибкой. Список веток использует `git ls-remote`, поэтому доступен до первого клона. Создание/удаление веток и проверки deploy используют один и тот же разрешённый target.

После подготовки checkout `ReleaseManager` переводит запись через `preparing` и `checking`, запускает release-preflight базы знаний, повторно читает origin и сохраняет получившийся точный SHA. Preflight fetch-ит ветку в собственный ref `refs/voicechat/preflight/<release-branch>` и выполняет `kb:index` в отдельном временном Git worktree на его SHA, поэтому параллельный fetch, подготовка или production checkout не могут изменить исходную ревизию либо переключить рабочее дерево. Если изменился только `docs/kb/README.md`, индекс коммитится и отправляется в release-ветку с `--force-with-lease` на исходный SHA: конкурентное изменение remote останавливает шаг, но не перезаписывается. Лимит шага берётся из `releaseTimeouts.knowledgeBaseMs` проекта (`knowledgeBaseTimeoutMs`), а не из константы: жёсткие 120 с убивали шаг с объявленным лимитом 10 минут ровно на 121-й секунде, посреди `git push`, и в логе оставался обрыв без причины. Identity коммита задаётся флагами `-c user.name`/`-c user.email`: на машине агента глобальный `user.email` может быть не настроен, и git отказывался угадывать его по хосту («unable to auto-detect email address»), роняя сборку релиза на шаге БЗ. Временные worktree и ref удаляются при выходе; глобальный `FETCH_HEAD` preflight не читает. Затем на зафиксированном SHA целиком выполняется настроенный `project.testCommand` (fallback — `npm run gate:all`). Regression создаёт отдельный временный detached worktree рядом с checkout, устанавливает в нём зависимости воспроизводимой командой `npm ci` по lock-файлу, затем использует его для всех настроенных стадий и удаляет в `finally` после успеха, ошибки или таймаута; общий checkout, его `node_modules`, текущая ветка и локальные изменения не затрагиваются. Установка выполняется через тот же потоковый executor до первой стадии: её вывод попадает в лог Regression, а ошибка или таймаут останавливают подготовку со статусом `failed`, после чего временный worktree всё равно удаляется. Обычная строка — одна команда; JSON-массив непустых строк — последовательные стадии с отдельным 600-секундным лимитом и общим fail-fast результатом. Каждая стадия целиком группируется после `cd` во временный worktree: фоновые операторы `&` и последующие `wait` не могут вернуть часть составной команды в исходный каталог агента. Команды regression выполняются через потоковый exec; heartbeat и диагностические строки сразу обновляют лог running-шага, а при завершении сохраняется полный накопленный вывод. Это позволяет крупным полным наборам не упираться в лимит одной агентской команды и оставаться видимыми в ленте. `affected-check` для release-gate не используется: даже docs-only индекс обязан пройти фактические проектные проверки. Только успешные результаты обоих шагов дают статус `ready`; ошибки БЗ и regression дают `failed`.

## Защищённая публикация

Deploy доступен только владельцу и только для записи `ready`. Проект хранит явный `productionEnvironmentMode`: существующие записи и миграция получают `legacy`, а `managed` нельзя включить обычным обновлением проекта. В legacy-режиме backend продолжает использовать сохранённый `productionCheckoutPath` и не переносит, не создаёт и не изменяет этот checkout. В managed-режиме путь checkout клиент и настройки не определяют: `ManagedEnvironmentResolver` получает выбранную production-машину и её MachineStorage, а `managedEnvironmentPaths` строит из storage root физически раздельные корни `projects/<projectId>/environments/production` и `.../staging` с каталогами `app`, `config`, `logs`, `artifacts`, `temporary`, репозиторием только в `temporary/repository` и manifest `environment.json` (`packages/shared/src/projects.ts`, `apps/server/src/releases/managedEnvironmentResolver.ts`). Resolver требует online-машину, storage identity, разрешённый политикой и совпадающий с каноническим без override каталог окружения, `gitUrl`, deploy- и health-check-команды; типизированный manifest связывает окружение с project, kind, machine и storage и получает `createdAt` из канонического времени создания проекта.

Первое включение managed выполняется только владельцем в два запроса. `POST /api/projects/:id/releases/managed/preflight` проверяет выбранное production или staging окружение и выдаёт привязанный к проекту одноразовый confirmation token на пять минут. `POST .../managed/confirm` принимает token, заново выполняет production preflight и только после успеха сохраняет режим `managed`; прямой PATCH в этот режим отклоняется. В настройках проекта владелец сначала запускает preflight, видит канонический путь и обязательные проверки, затем отдельной кнопкой подтверждает необратимый переход; участнику контролы не показываются, а deploy автоматически не запускается. Preflight не запускает файловые команды на offline-машине. На машине он отвергает symlink storage/environment root, сверяет marker MachineStorage и существующий manifest, принимает отсутствующий либо заранее созданный пустой `temporary/repository`, а для готового репозитория требует Git-каталог, точный origin и чистое дерево; непустой чужой каталог отклоняется без удаления. Старый generic `environment.json` с `taskId:null`, без `machineId`/`storageId` и с неканоническим `createdAt` не совместим с managed production: preflight намеренно отклоняет его как чужую identity; при разовой bootstrap-миграции подтверждённый оператор сохраняет исходный файл и атомарно заменяет его manifest с identity проекта, production-машины и выбранного MachineStorage. **Инцидент 2026-08-25:** этот generic-файл повторно создавал chat-storage bootstrap (`ensureManagedChat` в `routes/agents.ts`, триггер `PUT /api/conversations/:id/storage`) — он стамповал `environment.json` во всех managed-каталогах (`production`/`staging`/`test`) в generic-форме уже ПОСЛЕ managed-миграции, а релиз-менеджер существующий файл не перезаписывает (`if [ ! -e ]`), поэтому deploy снова падал preflight-ом (`POST .../releases/deploy → 400`). Исправлено: bootstrap создаёт каталоги окружений, но `environment.json` не пишет — манифест managed-окружений принадлежит релиз- и preview-менеджерам, которые знают identity и canonical `createdAt` и стамповывают его лениво. Разово отравленный файл на проде чинится восстановлением manifest в форму resolver-а (identity + `createdAt` = `project.createdAt`). Также проверяются запись в storage и минимум 512 MiB свободного места. Ответ содержит обязательные пункты marker, manifest, origin, branch, write, freeSpace, deployCommand и healthCheckCommand с общим результатом запуска. POSIX-команда preflight использует обычные shell-кавычки вокруг command substitution, write-probe и значения свободного места: переданные как `\"` кавычки становятся символами имени файла и сами ломают проверку записи. Присваивание пути probe и его создание соединены через `&&`: иначе более ранний отказ (например, несовпадающий manifest) пропускает присваивание, а команда после `;` маскирует исходную причину общей ошибкой `cannot create`. Исполняемый тест `managedEnvironmentResolver.test.ts` запускает сформированную команду через `/bin/sh` во временном MachineStorage и проверяет удаление probe-файла. Обычный deploy и deploy из merge-рана повторяют managed preflight перед созданием попытки.

При managed deploy этап `switching` идемпотентно создаёт канонические подкаталоги, публикует отсутствующий manifest через временный файл и атомарный `mv` и подготавливает checkout в `temporary/repository`; после этого применяется общий защищённый release-switch. Тот же resolver заново строит target при восстановлении release после рестарта, поэтому сохранённый произвольный checkout не становится обходом MachineStorage. Production и staging не пересекаются, а релизный manager публикует только в production target. Shared-контракт допускает run/report типа `release`, но `ReleaseManager` пока не создаёт `runs/<runId>/run.json` и `report.json`. Ошибка подготовки, переключения, deploy-команды или health-check помечает текущий шаг и попытку `failed`, не меняя ранее подтверждённый релиз; повторный deploy или откат на ранее подготовленный release снова использует сохранённый SHA и тот же защищённый pipeline.

Перед созданием попытки сервер обновляет origin на CI/Git-машине и требует, чтобы текущий SHA ветки совпадал с SHA подготовки. Попытка хранит этот SHA неизменно. На production-машине этап `switching` проверяет чистое рабочее дерево и точное совпадение URL origin, fetch-ит выбранную ветку в уникальный ref `refs/voicechat/releases/<attempt-id>`, сверяет этот стабильный ref и доступность commit object, затем переключает checkout на `release/x.y.z`, приводит его к сохранённому SHA через `reset --hard` и удаляет временный ref. Глобальный `FETCH_HEAD` намеренно не читается: его может перезаписать параллельное обновление списка release-веток.

Перед созданием deploy-попытки сервер повторно вычисляет версию из строгого имени `release/x.y.z` и требует её точного совпадения с `version` подготовленной записи; противоречивые метаданные останавливают публикацию до Git-операций на production. Этап `building` запускает сохранённую production-команду проекта, предварительно экспортируя в её окружение эту проверенную версию как `VC_RELEASE_VERSION` вместе с источником `release-manager`. Если команда использует `/usr/local/bin/voicechat-deploy`, ReleaseManager сначала обновляет его из `scripts/prod/deploy.sh` уже проверенного checkout: так первая публикация исправляет и старую установленную копию с fallback `0.1.0`. Актуальный production launcher и `deploy.sh` явно переносят metadata через detached-запуск, поэтому версия в production health и футере не зависит от старого launcher, наследования окружения или наличия Git-тега на сохранённом SHA. До запуска production-команды шаг пишет ожидаемые version, commit и source, а health-check повторяет version/commit в своём логе. Для ChatAI это фоновый host-side deploy, который возвращает управление до пересоздания контейнеров. Затем `health_check` повторяет сохранённую команду проверки и принимает публикацию только когда JSON health одновременно содержит ожидаемые commit SHA и версию. Поскольку для фоновой команды этот шаг включает фактическую Docker-сборку, его дефолтный лимит — 30 минут; сохранённая настройка проекта по-прежнему имеет приоритет и должна покрывать полную длительность production-сборки.

## Reconcile после рестарта

Состояние `building`/`health_check` хранится в БД. При старте `ReleaseManager.reconcile()` выбирает активные попытки через `listActiveProjectReleases`: прерванный `building` отмечает продолженным, обе стадии переводит в `health_check` и запускает `monitorHealth` с сохранённым лимитом шага. Попытка, остановленная во время `switching`, не продолжается, потому что безопасный результат переключения checkout неизвестен, и закрывается как `failed`; так же завершается попытка, для которой больше нельзя восстановить production target. Поэтому пересоздание `runner-work` или server во время уже применённого deploy не даёт ложный `failed`, но потенциально незавершённое переключение не принимается за успешное. Источник поведения — `apps/server/src/releases/releaseManager.ts`, проводка восстановления target — `apps/server/src/server.ts`.

**Инцидент 2026-08-25:** для managed это правило нарушалось — `reconcile()` на старте пересобирал production target через `ManagedEnvironmentResolver.resolve`, а тот бросал «Managed-машина offline», потому что companion-агент прод-машины ещё не переподключился после ребилда; reconcile ловил это и помечал релиз `failed` «Production-конфигурация недоступна после рестарта», хотя деплой уже применён. Исправлено: `resolve(...,{requireOnline:false})` в reconcile — identity target-а берётся из БД и стабильна, а `monitorHealth` сам ждёт онлайна и нужной версии в пределах health-check бюджета (`server.ts` reconcile-замыкание, `managedEnvironmentResolver.ts`). Начальный deploy и preflight по-прежнему требуют онлайн (`requireOnline` по умолчанию true). Deploy не повторяет regression/`kb:index`, не делает merge или push основной ветки, не создаёт теги и не очищает CI/preview workspace.

Host-side установка сохраняет физический production checkout в `/etc/voicechat/production.env` как `VC_REPO_DIR`: путь вычисляется через `readlink -f` из явно переданного значения либо каталога самого `scripts/prod/install.sh`. Launcher, deploy API, watchdog и `rebuild-when-idle.sh` читают эту настройку и fail-closed останавливаются без неё; fallback на `$PROD (target.path)` удалён. Поэтому managed production не требует legacy-каталога или символической ссылки: фактический `.git` и Compose label `com.docker.compose.project.working_dir` указывают прямо на канонический `temporary/repository`. Две физические production-копии недопустимы, иначе ручной deploy и release-manager обновляют разные checkout.

## Bootstrap прод-машины (авто-подготовка при смене машины)

Чтобы после выбора другой production-машины прод/merge/таски/чаты работали сразу, есть `POST /api/projects/:id/production/bootstrap` (`REST.projectProductionBootstrap`, мост `projects:bootstrapProduction`, owner-only через `deployGuard`). Одним запросом оркеструет то, что раньше было ~9 ручными шагами (`apps/server/src/routes/releases.ts`): (1) берёт указанный `storageId` или первый MachineStorage машины (создание storage требует root-путь и остаётся разовым при добавлении машины); (2) `db.linkMachine` + `materializeProjectMachine` (вынесен в `apps/server/src/projects/materialize.ts`, общий с `POST /api/projects/:id/machines`) — привязка и канонические каталоги окружений; (3) `updateProject` проставляет `productionAgentId` и дефолтные `productionDeployCommand` (`/usr/local/bin/voicechat-deploy`) / `productionHealthCheckCommand` (curl health), не затирая заданные; (4) если валидной default-машины нет — назначает эту (`setUserProjectDefaultMachine`), чтобы CI/merge/таски заработали на ней; (5) `managed.preflight` → при успехе включает `productionEnvironmentMode:'managed'` (как confirm). Результат — `ProductionBootstrapResult` (`ok`, `mode`, `defaultMachineSet`, `preflight` чек-лист, `cliLoginHint`). UI: кнопка «Подготовить прод-машину» под селектором production-машины в `ProjectSettings.tsx` (виден owner-у, когда машина выбрана). Осознанно НЕ автоматизируется: хостовая `scripts/prod/install.sh` (нужен root/systemd на самой машине) и вход в CLI — единственный неизбежный ручной шаг: `claude login`/`codex login` в HOME runner новой машины (OAuth интерактивен; альтернатива — `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` в окружении runner). Тесты — контрактные ветки в `projects.test.ts` (owner-guard, требование машины и gitUrl), materialize — в `rest.test.ts`, preflight — в `managedEnvironmentResolver.test.ts`.

Статусы подготовки — `preparing`, `checking`, `ready`, `failed`; статусы deploy — `queued`, `switching`, `building`, `health_check`, `released`, `failed`. История в `project_releases`, шагах и событиях сохраняет каждую попытку и её связь с подготовленной записью. Повторный deploy старой подготовленной ветки использует тот же механизм и тот же сохранённый SHA, без merge, тегов или git revert.

## REST, мост и интерфейс

Маршруты находятся в `apps/server/src/routes/releases.ts`, bridge-контракт — в `packages/shared/src/ipc.ts`, UI релизов — в `packages/ui/src/components/releases/ReleaseCenter.tsx`, а подтверждение managed production — в `packages/ui/src/components/ProjectSettings.tsx`. Экран разделён на табы «Релизы» и «Деплой». «Релизы» показывает таблицу подготовок (ветка, дата, длительность, статус), создание сразу открывает detail-view, а detail опрашивает `GET /api/projects/:id/releases/:releaseId` каждые 2 секунды до терминального статуса и отображает таймлайн шагов с живой длительностью. «Деплой» показывает последнюю публикацию, её длительность, селектор `ready`-релизов и историю deploy-попыток; в detail deploy скрыты подготовительные skipped-шаги и остаются только switching/building/health-check. Список загружается в два этапа. `GET /api/projects/:id/releases` выполняется один раз для обеих вкладок и возвращает `ProjectReleaseSummary[]` только с `id`, `branch`, `sha`, `status`, `previousReleaseId`, `createdAt` и агрегированной `durationMs`; шаги, логи, модели и снимки окружения в список не входят. Полный `ProjectRelease` запрашивается через `GET /api/projects/:id/releases/:releaseId` только после выбора строки. До ответа прежний detail очищается и показывается индикатор загрузки; ошибка detail имеет повтор, а счётчик запроса не позволяет позднему ответу ранее выбранного релиза заменить текущий. Активный открытый detail по-прежнему опрашивается каждые 2 секунды. При первом list-запросе показывается `Skeleton`, при обновлении уже видимых данных — `RefreshIndicator`, для пустого результата — `EmptyState`, а для ошибки — `ErrorState` с повтором; ошибка обновления не скрывает ранее загруженный список. Ветки для deploy загружаются отдельно и не дублируют запрос списка релизов. Компоновка занимает оставшуюся после естественной шапки проекта высоту без прокрутки всей страницы; прокрутка по обеим осям находится в `release-table-wrap`, а заголовки колонок закреплены через sticky-позиционирование (`packages/ui/src/styles/app.css`). Обе ленты скачиваются из браузера как `.txt` с MIME `text/plain;charset=utf-8`; накопленный лог доступен и во время активного рана и включает метаданные рана, снимок машины/checkout, timestamps, длительности, лимиты и полный вывод шагов. Лимиты шести типов шагов хранятся в настройках проекта, валидируются сервером в диапазоне 1 секунда — 24 часа и копируются в `project_release_steps.limit_ms` при создании рана, поэтому смена настройки и рестарт не меняют активный ран. У многостадийной Regression сохранённый лимит применяется отдельно к каждой команде. Подготовка сохраняет `agent_id`/`checkout_path`, полученные из машины проекта по умолчанию. Backend не выбирает запасную машину: список, создание и удаление веток, обычный deploy и deploy из merge-рана проходят через один резолв target, который отдельно проверяет default-машину, доступ/привязку, online, `gitUrl` и директорию. Поэтому ошибки конфигурации возвращаются как диагностический `400`, а не маскируются под отсутствие маршрута.

**Цикл улучшений Release Center 1 (2026-09-12).** Оболочка `ReleaseCenter` — `.release-shell` с сегментным переключателем «Весь проект / Приложения» (`aria-pressed`) в общей центрированной колонке; селектор высоты страницы `.toolpage.projpage > .release-shell` (раньше `.release-center` перестал быть прямым потомком, и панель не растягивалась). «Настройки» — кнопка в шапке панели с `aria-expanded`, форма лимитов `#release-settings` (`role=form`, сетка `auto-fit`, «Отмена»/«Сохранить», статус «Лимиты сохранены.»). Поле версии подсказывает следующую версию (`suggestNextReleaseVersion` в `packages/shared/src/release.ts`: старшая `release/x.y.z` + patch) как placeholder и кнопкой-подстановкой; ошибки формата и существующей ветки показываются под полем (`role=alert`) и блокируют сборку. Релиз, который сейчас в production, помечен в таблице релизов, в списке деплоя («сейчас в production») и в истории деплоев; его ветку нельзя удалить из UI (кнопка отключена — сервер это и так запрещает), а повторный деплой той же версии подписан «Задеплоить повторно» с пояснением. Статусы шагов ленты — свой словарь (`Пройден`/`Ошибка`/`Пропущен`/`Выполняется`/`В очереди`), раньше печатался сырой `passed`. Детальная карточка живого рана тикает раз в секунду (`useLiveNow`) вместе с общей длительностью и показывает машину/production; список релизов сам опрашивается каждые 5 с, пока в нём есть незавершённые записи. Мобильная раскладка (≤720px): таблицы становятся карточками через `td[data-label]` и `::before{content:attr(data-label)}`, `thead` скрыт; поля формы сборки не выходят за карточку (`flex:1 1 240px; min-width:0`). Сториз — `ReleaseCenter.stories.tsx` (список с идущей сборкой, деплой, живая и упавшая детальные карточки, настройки, пусто, ошибка, наблюдатель), тесты — `ReleaseCenter.dom.test.tsx`.

**Цикл улучшений Release Center 2 (2026-09-12).** Сервер: `ProjectReleaseSummary` несёт `attempt` и `failure` (краткая причина упавшего шага через `releaseFailureSummary`, считается подзапросом в `listProjectReleaseSummaries`) — список и карточка «Последний деплой» объясняют красную строку без запроса деталей. Health-check пишет живой лог каждые 30 с (`HEALTH_LOG_INTERVAL_MS`, для тестов — опция конструктора `ReleaseManager(db, runtime, { healthLogIntervalMs })`): «Прошло N с из M с. Production отвечает SHA …; ожидаются …»; финальная ошибка подсказывает смотреть `/var/log/voicechat-deploy.log`, потому что сборка контейнеров идёт в фоне после шага «Сборка» и её падение сюда не возвращается. Порог диска `RELEASE_MIN_FREE_KB` поднят до 10 ГБ: деплой 0.1.301 упал на распаковке слоя browser-runner при 5,7 ГБ свободных. UI: «Собрать новый релиз» и «Задеплоить» отключены, пока идёт другая сборка/деплой (сервер отвечал бы 409-подобной ошибкой уже после запроса), с пояснением в подсказке; списки показываются страницами по 20 с «Показать ещё (N)»; в деталях — ссылки на GitHub (коммит, ветка, сравнение с текущим production через `compare/<prod>...<sha>`), если `gitUrl` проекта — GitHub (`githubWebUrl`); проп `gitUrl` приходит из `App`; последняя вкладка помнится в `localStorage` (`RELEASES_TAB_KEY = 'vc.releases.tab'`); на вкладке «Деплой» отдельная карточка «Сейчас в production», когда последний деплой не тот, что стоит на проде; строки таблиц открываются с клавиатуры Enter и пробелом.

**Цикл улучшений Release Center 3 (2026-09-12) — режим «Приложения».** `ApplicationReleaseCenter` переведён на общий язык центра релизов: тот же `.release-pane` с шапкой и действиями («Обновить», «Сверить с окружением»), контролы приложения и окружения в карточке `release-create`, установленная версия — плитки `release-metrics` (версия · API · health-check · ревизия окружения, «обновляется» при активной установке), загрузка — `Skeleton`, ошибка — `ErrorState` с повтором, пустые списки — `EmptyState`. Выпуски и история deploy — карточки `.application-release-item` с цветной левой кромкой по статусу и пилюлей `.release-status`; вместо сырых id печатаются имена приложений из каталога (`nameOf`), выпуски отсортированы по порядку каталога и версии по убыванию (`sortApplicationReleases`). Под кнопкой «Установить выбранные версии» — причина недоступности («Выберите хотя бы один готовый выпуск», «Идёт установка», «Состав несовместим»). **Установка и откат в production подтверждаются** через `useConfirm` (перечисляется состав); staging — без подтверждения, поэтому e2e-фикстура `e2e/fixtures/application-releases/main.tsx` обёрнута в `UiProviders`. Таблица зависимостей на телефоне — карточные строки с подписями (`th/td[data-label]`), обязательные поля версий с `inputMode="decimal"`. Сториз `Applications`/`ApplicationsMobile` в `ReleaseCenter.stories.tsx`.

**Цикл улучшений Release Center 4 (2026-09-12).** Подробности релиза стали рабочим местом: у упавшего деплоя — «Повторить деплой» той же веткой, у упавшей сборки — «Удалить и собрать заново» (подтверждение `useConfirm`, затем `releases:delete` + `releases:createBranch` той же версии на выбранной машине), у деплоя — «Сборка релиза» (переход к подготовке по `previousReleaseId`) и номер попытки; SHA копируется кнопкой с тостом. Лог выполняющегося шага прилипает к концу (`StepLog`), пока читатель не прокрутит вверх. В таблицах — относительное время (`formatRelativeTime` в `@shared/dateFormat`: «5 мин назад», «вчера», старше месяца — дата) с полной датой в `title`; у выбора релиза — счётчик готовых; вкладки переключаются стрелками (roving tabindex). Сервер: `releaseSwitchCommand` объясняет каждое предусловие (незакоммиченные изменения в production checkout, чужой `remote.origin.url`, сдвинувшийся SHA ветки) вместо молчаливого `test -z … && …`; ошибка «ветка уже существует» называет следующую свободную версию.

Владелец может удалить завершённую подготовку `ready`/`failed`: backend заново сверяет id и строгую ветку, запрещает активный deploy и текущий production-релиз, точечно удаляет только `refs/heads/release/x.y.z` через `git push origin --delete`, затем ставит `deleted_at`. Deploy-попытки остаются в БД для аудита. Кнопка deploy доступна только для `ready`. Переход между строгими `release/x.y.z` сравнивается по числовым компонентам SemVer: меньшая версия показывается как откат, большая — как обновление production. Production-машина, checkout и разрешённые команды редактируются владельцем в настройках проекта. История релизов обратно совместима с сохранёнными шагами прежних версий: неизвестный текущему контракту `kind` отображается как есть, а краткая ошибка берётся из диагностического лога (или заменяется нейтральным fallback), поэтому старые `cleanup`/`push_main` не роняют центр релизов.

## Место на диске перед сборкой (roadmap-3 п.1)

Перед шагом «Сборка и обновление контейнеров» `ReleaseManager.deploy` спрашивает у production `df -Pk /` (`diskFreeCommand`). Если свободно меньше `RELEASE_MIN_FREE_KB` (5 ГБ), выполняется `dockerPruneCommand` — `docker builder prune -af --filter until=24h` и `docker image prune -f` — и место меряется снова; если его всё ещё мало, шаг падает сразу с текстом «свободно X ГБ, нужно не меньше 5.0 ГБ», а не висит 20 минут на health-check (так 27.08.2026 упал деплой 0.1.164: docker не смог распаковать слои `tts-runner`, `no space left on device`, при 1,8 ГБ свободных). Результат проверки пишется в лог шага («Свободно на диске: …»).

## Независимые выпуски приложений

Каталог `packages/shared/src/applicationCatalog.ts` разделяет владение исходниками,
сборочные зависимости, runtime-требования и адресные контрактные проверки.
Независимые единицы: Make, Image Studio, Web Reader API с iframe-рекордером, Playwright Reader API, browser-runner,
LLM/STT/TTS runners и четыре UI-панели (`make-ui`, `image-studio-ui`,
`playwright-reader-ui`, `web-reader-ui`). `llm-runner` владеет сразу двумя сервисами
`runner-work`/`runner-personal`: они обновляются согласованно одним артефактом.

Готовность тестов, сборки и deploy — разные флаги каталога. Ядро, общий web,
desktop/agent/tray и ещё встроенные проекты/машины/админка остаются
в общем потоке. Automation Runner имеет отдельную сборку и durable queue, но его
`src/index.ts` всё ещё использует `executor_adapter_not_configured`; компонентный
deploy поэтому закрыт. Разделение этих модулей не имитируется отдельным тегом.

Web Reader выпускается как `web-reader`: образ включает только `apps/web-reader`,
`apps/web-recorder`, контракты и UI kit. Зависимость от ядра требует API >=1.1.0
(новые методы контекста и машин); каталог запрещает занизить этот минимум в
манифесте. Пример диапазонов — `docs/examples/application-releases/web-reader.requires.json`.
`web-reader-ui` требует `core` и `web-reader`. Playwright API использует
`browser-contracts` и `playwright-reader-contracts`, поэтому его образ не содержит
Chromium. `application-links.mjs` проверяет связи Web Reader→core/Playwright и
обратный remote-маршрут ядра через `VC_READER_URL`. Оператор обновляет ядро до
поддерживаемого API один раз перед первым отдельным Web Reader.

### Проверки и артефакты

`gate:app -- make` проверяет Make и его адресные контракты; `gate:changed` выбирает
область от merge-base `origin/main`, `gate:fast` — изменения рабочего дерева от HEAD.
Изменение внутреннего файла приложения не втягивает полные тесты его хоста.
Изменение публичного контракта добавляет typecheck и контрактные тесты потребителей;
общие библиотеки, неизвестные пути и неразрешимый lock diff расширяют проверку.
Браузерные пути добавляют каталоговый E2E; общий fallback сохраняет эти E2E после
`gate:all`. `gate:all` сам выполняет все typecheck/тесты и сборки панелей/web/Storybook.
Адреса браузерных наборов находятся в каталоге, а не в правилах префикса `apps/`.

`npm run build:app -- make --version X.Y.Z --image REGISTRY/MAKE --requires FILE --push --output FILE`
работает из чистого checkout: отдельный временный контекст содержит npm-замыкание
приложения и очищенный lock, без исходников других продуктов, локальных `.env`,
node_modules и сборочных артефактов. Make не собирает web, Storybook или Whisper.
`release.json` приложения задаёт собственные API/data версии и capabilities;
`container.json` — native-зависимости только этого приложения. Docker label
`com.voicechat.release`, health metadata и выходной manifest описывают один выпуск.
После push фиксируется `repository@sha256:…`, а не тег. `--allow-dirty` разрешён
только для локальной проверки: OCI label содержит `development:true`, release
manifest не выпускается, обычный deploy такой образ отвергает.

Runtime-требование содержит минимальную и исключительную верхнюю версию реализации,
отдельный диапазон API и необходимые capabilities. Обязательную зависимость из
каталога нельзя объявить optional или убрать. Неизвестная установленная версия,
нездоровая зависимость, неподдерживаемый API и ограничения уже установленных
потребителей блокируют весь будущий состав. Для взаимозависимых обновлений можно
выбрать согласованный набор выпусков. Изменение `dataVersion` блокирует автоматическую
замену: отдельную миграцию данных этот исполнитель не выполняет.

### Подготовка и матрица совместимости

В Release Center вкладка «Приложения» добавляет выбор приложения/окружения,
собственную версию, образ registry и диапазоны зависимостей. Owner готовит выпуск;
участник видит версии и историю. Подготовка создаёт отдельный worktree точного SHA,
выполняет `gate:app`, собирает/push-ит образ, проверяет именно полученный digest и
только затем создаёт `release/<applicationId>/<x.y.z>`. Занятую ветку не перезаписывает.

Для приложения с зависимостями нужен `<путь приложения>/release-matrix.json` в
исходниках этого SHA. Формат `schemaVersion:1`, `current` (applicationId → версия)
и `environments` (имя → массив полных manifest зависимостей). Например, Make имеет
сценарии `minimum` и `current`, каждый с manifest соответствующего ядра; версии и
digest берутся из настоящих baseline, не из npm `0.1.0`. Каждая обязательная нижняя
граница должна присутствовать в матрице точно, как и объявленная текущая версия.
Остальные обязательные зависимости baseline тоже включаются в состав сценария.
Без матрицы, минимального артефакта или `compatibility.mjs` подготовка падает.
Приложения без runtime-зависимостей получают standalone-сценарий автоматически.

`application-compatibility.mjs --manifest FILE [--matrix FILE]` поднимает отдельный
Compose-проект, сверяет label/digest/health, выполняет контрактный driver и удаляет
свой стенд. Make/Image Studio проверяют авторизацию и настоящий RPC к ядру;
Playwright — создание/действия/завершение браузерной сессии; Chromium — запуск,
evaluate и screenshot; LLM — CLI и HTTP-контракт; STT — Whisper/модели/WS-контракт;
TTS — настоящий WAV Piper. Внешняя авторизация LLM и скачивание STT-модели для
распознавания в эти smoke-контракты не входят. UI driver проверяет SRI и реальные baseline health, затем запускает IIFE
кандидата через собранный web-host именно baseline-образа в Chromium. Gateway
обязан отдавать manifest кандидата, а страница — загрузить его script; локальная
фикстура текущего загрузчика не заменяет проверку старого host. UI-выпуск
фиксирует диапазоны как собственного backend, так и ядра с оболочкой.

### Первичный переход и конфигурация площадки

Старый общий образ не получает выдуманную версию при observe. Сначала подготовь
baseline ядра из чистого SHA через общий гейт и
`npm run build:app -- core --baseline --version X.Y.Z --image REGISTRY/CORE --requires core-requires.json --push --output core.json`.
Этот специальный путь использует прежний `server-runtime` со сборкой web/recorder,
сохраняет embedded-возможности и добавляет собственные metadata ядра.
`core-requires.json` обязательно фиксирует диапазоны всех опциональных потребителей
из каталога (обычно `optional:true`): отсутствие сервиса допустимо, но установленный
новый API за пределами диапазона ядра — нет. Это обеспечивает обратную проверку
при обновлении Make/runner/UI, даже если собственный API ядра не изменился. Он не открывает
обычный независимый deploy ядра. Первичная установка этого baseline и перевод
нужных связей в remote — отдельная настройка окружения; последующие компонентные
обновления ядро не пересобирают и не перезапускают. `VC_APPLICATION_COMMIT` имеет
приоритет над legacy `VC_RELEASE_COMMIT`, чтобы короткий SHA общего deploy не
затирал полный SHA артефакта. У обычной локальной Docker-сборки без Git UI manifest
помечен `development:true`, `commit:null`; самостоятельный релиз этого не допускает.

Пример состава и имён переменных: `docs/examples/application-releases/`.
`compose.json` содержит отдельные образы и тома, только HTTP ядра опубликован на
loopback :8799; `release.env.example` нужно заполнить своими секретами и digest.
Это новый изолированный стенд, не инструкция заменять существующие production-тома.
При переносе существующего состава сохраняют привязки данных Make, галерей,
профилей Chromium/CLI, STT-моделей и Piper-голосов; пустой новый том не заменяет
перенос или прежний mount. Все запущенные управляемые версии должны пройти observe.

Исполнитель читает конфигурацию площадки с `projectId`, `environment`, Compose
project name/files, `stateDir`, `health` и необязательным `envFile`. Для managed-цели
это `<managedRoot>/config/applications.json`; для существующей production-цели —
`applications.production.json` рядом с checkout. Staging не подменяется production.
`stateDir` постоянный и отдельный у каждого окружения. UI не редактирует пути и
секреты площадки. Release machine должна иметь Docker/registry credentials и
Chromium для каталоговых E2E. Старые `deployCommand`/`healthCheckCommand` относятся
только к legacy-потоку; компонентный исполнитель ими не пользуется.

### Deploy, повтор запросов и восстановление

Таблицы `application_releases`, `application_environments`, `application_deployments`
добавляются к существующей БД; `project_releases` и старая история остаются отдельными.
Регистрация версии идемпотентна; изменение уже зарезервированного входа запрещено.
Состав имеет CAS-ревизию. Deploy захватывает durable lock окружения и снимок цели
(agent/path/repository/config), повтор того же requestId возвращает ту же попытку.
Нельзя одновременно выполнить два плана из одной старой ревизии окружения.
Активный legacy deploy блокирует observe/компонентный deploy production. После
появления подтверждённого компонентного состава общий legacy deploy закрыт: он
перезаписал бы образы и обошёл ограничения зависимостей. Старые подготовки/история
остаются доступны; изменение пока не отделённого ядра требует отдельного
контролируемого перехода baseline с проверкой всего состава. Staging независим.

Deploy скачивает заданные digest, сверяет OCI metadata, пишет собственный images
Compose override и вызывает только `up -d --no-deps --no-build --pull never <services>`.
Проверяется фактическая версия/health, ссылки сервисов (в том числе авторизованный
RPC и remote-режим ядра) и неизменность container ID остальных сервисов. Для UI
проверяется также manifest через gateway ядра. Файловая блокировка с PID защищает
машину от второго исполнителя; сохранённый images override переживает рестарт.

Health failure возвращает точный предыдущий артефакт. Статус `failed` возможен
только после доказанного восстановления прежнего состава; иначе `uncertain` и
lock сохраняются. После рестарта менеджер не повторяет `up`: reconcile проверяет
фактический состав. Живой PID, offline-машина, смена цели или неопределённый откат
не снимают блокировку. Явный rollback разрешён для последнего успешного deploy,
снова проверяет совместимость и не меняет формат данных.

Реализация и границы внедрения: [план](../../plans/application-independent-releases.md).
