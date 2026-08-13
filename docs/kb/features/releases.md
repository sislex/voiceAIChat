---
title: Версионные release-ветки и публикация в production
updated: 2026-08-13
checked: a69c7a4
areas:
  - packages/shared/src/release.ts
  - packages/shared/src/protocol.ts
  - packages/shared/src/ipc.ts
  - packages/shared/src/projects.ts
  - apps/server/src/releases
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

Центр релизов работает только с удалёнными ветками строгого вида `release/x.y.z` без ведущих нулей. Общая валидация находится в `packages/shared/src/release.ts`. Создать ветку может только владелец. Машина подготовки не выбирается в Release Center: источник истины — `projects.default_agent_id`, а checkout берётся из `project_machines.path` для этой машины. Backend не принимает `agentId` от клиента и не делает fallback на другую подключённую машину. Если машина по умолчанию не задана, отвязана, offline или не имеет checkout, подготовка блокируется с точной причиной. Снимок фактически использованных машины и checkout сохраняется в записи рана; production-машина настраивается и используется отдельно.

Создание ветки сразу запускает самостоятельную подготовку. `ReleaseManager` переводит запись через `preparing` и `checking`, запускает release-preflight базы знаний, повторно читает origin и сохраняет получившийся точный SHA. Preflight fetch-ит ветку в собственный ref `refs/voicechat/preflight/<release-branch>` и выполняет `kb:index` в отдельном временном Git worktree на его SHA, поэтому параллельный fetch, подготовка или production checkout не могут изменить исходную ревизию либо переключить рабочее дерево. Если изменился только `docs/kb/README.md`, индекс коммитится и отправляется в release-ветку с `--force-with-lease` на исходный SHA: конкурентное изменение remote останавливает шаг, но не перезаписывается. Временные worktree и ref удаляются при выходе; глобальный `FETCH_HEAD` preflight не читает. Затем на зафиксированном SHA целиком выполняется настроенный `project.testCommand` (fallback — `npm run typecheck && npm run test`). Обычная строка — одна команда; JSON-массив непустых строк — последовательные стадии с отдельным 600-секундным лимитом и общим fail-fast результатом. Каждая стадия целиком группируется после `cd` в checkout: фоновые операторы `&` и последующие `wait` не могут вернуть часть составной команды в исходный каталог агента. Это позволяет крупным полным наборам не упираться в лимит одной агентской команды. `affected-check` для release-gate не используется: даже docs-only индекс обязан пройти фактические проектные проверки. Только успешные результаты обоих шагов дают статус `ready`; ошибки БЗ и regression дают `failed`.

## Защищённая публикация

Deploy доступен только владельцу и только для записи `ready`. Backend сам берёт из настроек проекта `productionAgentId`, `productionCheckoutPath`, `productionDeployCommand`, `productionHealthCheckCommand` и ожидаемый `gitUrl`; клиент передаёт только имя release-ветки. Production-машина должна быть подключена к проекту и online. Одновременно для проекта выполняется не больше одного deploy.

Перед созданием попытки сервер обновляет origin на CI/Git-машине и требует, чтобы текущий SHA ветки совпадал с SHA подготовки. Попытка хранит этот SHA неизменно. На production-машине этап `switching` проверяет чистое рабочее дерево и точное совпадение URL origin, fetch-ит выбранную ветку в уникальный ref `refs/voicechat/releases/<attempt-id>`, сверяет этот стабильный ref и доступность commit object, затем переключает checkout на `release/x.y.z`, приводит его к сохранённому SHA через `reset --hard` и удаляет временный ref. Глобальный `FETCH_HEAD` намеренно не читается: его может перезаписать параллельное обновление списка release-веток.

Этап `building` запускает сохранённую production-команду проекта, предварительно экспортируя в её окружение проверенную версию release-ветки как `VC_RELEASE_VERSION`; поэтому версия в production health и футере не зависит от наличия Git-тега на сохранённом SHA. Для ChatAI это фоновый host-side deploy, который возвращает управление до пересоздания контейнеров. Затем `health_check` повторяет сохранённую команду проверки и принимает публикацию только когда JSON health содержит ожидаемый commit SHA. Поскольку для фоновой команды этот шаг включает фактическую Docker-сборку, его дефолтный лимит — 30 минут; сохранённая настройка проекта по-прежнему имеет приоритет и должна покрывать полную длительность production-сборки. Состояние `building`/`health_check` хранится в БД: после рестарта сервер восстанавливает активную попытку и продолжает health-check, поэтому пересоздание `runner-work` или server не даёт ложный `failed`. Deploy не повторяет regression/`kb:index`, не делает merge или push основной ветки, не создаёт теги и не очищает CI/preview workspace.

Статусы подготовки — `preparing`, `checking`, `ready`, `failed`; статусы deploy — `queued`, `switching`, `building`, `health_check`, `released`, `failed`. История в `project_releases`, шагах и событиях сохраняет каждую попытку и её связь с подготовленной записью. Повторный deploy старой подготовленной ветки использует тот же механизм и тот же сохранённый SHA, без merge, тегов или git revert.

## REST, мост и интерфейс

Маршруты находятся в `apps/server/src/routes/releases.ts`, bridge-контракт — в `packages/shared/src/ipc.ts`, UI — в `packages/ui/src/components/releases/ReleaseCenter.tsx`. Экран разделён на табы «Релизы» и «Деплой». «Релизы» показывает таблицу подготовок (ветка, дата, длительность, статус), создание сразу открывает detail-view, а detail опрашивает `GET /api/projects/:id/releases/:releaseId` каждые 2 секунды до терминального статуса и отображает таймлайн шагов с живой длительностью. «Деплой» показывает последнюю публикацию, её длительность, селектор `ready`-релизов и историю deploy-попыток; в detail deploy скрыты подготовительные skipped-шаги и остаются только switching/building/health-check. Обе ленты скачиваются из браузера как `.txt` с MIME `text/plain;charset=utf-8`; накопленный лог доступен и во время активного рана и включает метаданные рана, снимок машины/checkout, timestamps, длительности, лимиты и полный вывод шагов. Лимиты пяти типов шагов хранятся в настройках проекта, валидируются сервером в диапазоне 1 секунда — 24 часа и копируются в `project_release_steps.limit_ms` при создании рана, поэтому смена настройки и рестарт не меняют активный ран. У многостадийной Regression сохранённый лимит применяется отдельно к каждой команде. Подготовка сохраняет `agent_id`/`checkout_path`, полученные из машины проекта по умолчанию. Интерфейс показывает эту настройку read-only, а backend повторно проверяет связь машины с проектом через `canUseAgent`, наличие checkout и online-статус. Для read-only списка release-веток и запуска deploy backend предпочитает настроенную default-машину, но у старого проекта без `defaultAgentId` безопасно выбирает первую доступную привязанную машину с непустым checkout path. Если такой машины нет, `GET …/releases/branches` возвращает диагностическую ошибку конфигурации с предложением открыть настройки проекта, а не маскирует состояние под 404 отсутствующего маршрута.

Владелец может удалить завершённую подготовку `ready`/`failed`: backend заново сверяет id и строгую ветку, запрещает активный deploy и текущий production-релиз, точечно удаляет только `refs/heads/release/x.y.z` через `git push origin --delete`, затем ставит `deleted_at`. Deploy-попытки остаются в БД для аудита. Кнопка deploy доступна только для `ready`. Переход между строгими `release/x.y.z` сравнивается по числовым компонентам SemVer: меньшая версия показывается как откат, большая — как обновление production. Production-машина, checkout и разрешённые команды редактируются владельцем в настройках проекта. История релизов обратно совместима с сохранёнными шагами прежних версий: неизвестный текущему контракту `kind` отображается как есть, а краткая ошибка берётся из диагностического лога (или заменяется нейтральным fallback), поэтому старые `cleanup`/`push_main` не роняют центр релизов.
