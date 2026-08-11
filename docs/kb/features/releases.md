---
title: Версионные release-ветки и публикация в production
updated: 2026-08-11
checked: 946dac1
areas:
  - packages/shared/src/release.ts
  - packages/shared/src/protocol.ts
  - packages/shared/src/ipc.ts
  - packages/shared/src/projects.ts
  - apps/server/src/releases
  - apps/server/src/routes/releases.ts
  - apps/server/src/db/schema.ts
  - apps/server/src/db/database.ts
  - apps/server/src/server.ts
  - packages/ui/src/components/releases
  - packages/ui/src/components/ProjectSettings.tsx
  - packages/ui/src/components/ProjectPage.tsx
  - packages/ui/src/App.tsx
  - packages/ui/src/remote/httpApi.ts
---

# Версионные release-ветки и публикация в production

## Release-ветки

Центр релизов работает только с удалёнными ветками строгого вида `release/x.y.z` без ведущих нулей. Общая валидация находится в `packages/shared/src/release.ts`. Создать ветку может только владелец; Git-операции подготовки выполняются на default CI/Git-машине проекта, а не на production-машине.

Создание ветки сразу запускает самостоятельную подготовку. `ReleaseManager` переводит запись через `preparing` и `checking`, запускает release-preflight базы знаний, повторно читает origin и сохраняет получившийся точный SHA. Preflight fetch-ит ветку в собственный ref `refs/voicechat/preflight/<release-branch>` и выполняет `kb:index` в отдельном временном Git worktree на его SHA, поэтому параллельный fetch, подготовка или production checkout не могут изменить исходную ревизию либо переключить рабочее дерево. Если изменился только `docs/kb/README.md`, индекс коммитится и отправляется в release-ветку с `--force-with-lease` на исходный SHA: конкурентное изменение remote останавливает шаг, но не перезаписывается. Временные worktree и ref удаляются при выходе; глобальный `FETCH_HEAD` preflight не читает. Затем на зафиксированном SHA целиком выполняется настроенный `project.testCommand` (fallback — `npm run typecheck && npm run test`). `affected-check` для release-gate не используется: даже docs-only индекс обязан пройти фактические проектные проверки. Только успешные результаты обоих шагов дают статус `ready`; ошибки БЗ и regression дают `failed`.

## Защищённая публикация

Deploy доступен только владельцу и только для записи `ready`. Backend сам берёт из настроек проекта `productionAgentId`, `productionCheckoutPath`, `productionDeployCommand`, `productionHealthCheckCommand` и ожидаемый `gitUrl`; клиент передаёт только имя release-ветки. Production-машина должна быть подключена к проекту и online. Одновременно для проекта выполняется не больше одного deploy.

Перед созданием попытки сервер обновляет origin на CI/Git-машине и требует, чтобы текущий SHA ветки совпадал с SHA подготовки. Попытка хранит этот SHA неизменно. На production-машине этап `switching` проверяет чистое рабочее дерево и точное совпадение URL origin, fetch-ит выбранную ветку в уникальный ref `refs/voicechat/releases/<attempt-id>`, сверяет этот стабильный ref и доступность commit object, затем переключает checkout на `release/x.y.z`, приводит его к сохранённому SHA через `reset --hard` и удаляет временный ref. Глобальный `FETCH_HEAD` намеренно не читается: его может перезаписать параллельное обновление списка release-веток.

Этап `building` запускает только сохранённую production-команду проекта; для ChatAI это фоновый host-side deploy, который возвращает управление до пересоздания контейнеров. Затем `health_check` повторяет сохранённую команду проверки и принимает публикацию только когда JSON health содержит ожидаемый commit SHA. Состояние `building`/`health_check` хранится в БД: после рестарта сервер восстанавливает активную попытку и продолжает health-check, поэтому пересоздание `runner-work` или server не даёт ложный `failed`. Deploy не повторяет regression/`kb:index`, не делает merge или push основной ветки, не создаёт теги и не очищает CI/preview workspace.

Статусы подготовки — `preparing`, `checking`, `ready`, `failed`; статусы deploy — `queued`, `switching`, `building`, `health_check`, `released`, `failed`. История в `project_releases`, шагах и событиях сохраняет каждую попытку и её связь с подготовленной записью. Повторный deploy старой подготовленной ветки использует тот же механизм и тот же сохранённый SHA, без merge, тегов или git revert.

## REST, мост и интерфейс

Маршруты находятся в `apps/server/src/routes/releases.ts`, bridge-контракт — в `packages/shared/src/ipc.ts`, UI — в `packages/ui/src/components/releases/ReleaseCenter.tsx`. Кнопка deploy доступна только для `ready`; центр отдельно показывает подготовку и стадии публикации и текущую released-ветку. Переход между строгими `release/x.y.z` сравнивается по числовым компонентам SemVer: меньшая версия показывается как откат, большая — как обновление production. Production-машина, checkout и разрешённые команды редактируются владельцем в настройках проекта. История релизов обратно совместима с сохранёнными шагами прежних версий: неизвестный текущему контракту `kind` отображается как есть, а краткая ошибка берётся из диагностического лога (или заменяется нейтральным fallback), поэтому старые `cleanup`/`push_main` не роняют центр релизов.
