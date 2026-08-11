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

Создание ветки сразу запускает самостоятельную подготовку. `ReleaseManager` переводит запись через `preparing` и `checking`, запускает release-preflight базы знаний, повторно читает origin и сохраняет получившийся точный SHA. Если `kb:index` изменил только `docs/kb/README.md`, preflight коммитит и отправляет индекс в release-ветку. Затем на зафиксированном SHA выполняется `npm run affected-check`. Только успешные результаты обоих шагов дают статус `ready`; ошибки БЗ и regression дают `failed`.

## Защищённая публикация

Deploy доступен только владельцу и только для записи `ready`. Backend сам берёт из настроек проекта `productionAgentId`, `productionCheckoutPath`, `productionDeployCommand`, `productionHealthCheckCommand` и ожидаемый `gitUrl`; клиент передаёт только имя release-ветки. Production-машина должна быть подключена к проекту и online. Одновременно для проекта выполняется не больше одного deploy.

Перед созданием попытки сервер обновляет origin на CI/Git-машине и требует, чтобы текущий SHA ветки совпадал с SHA подготовки. Попытка хранит этот SHA неизменно. На production-машине этап `switching` проверяет чистое рабочее дерево и точное совпадение URL origin, делает fetch выбранной ветки, проверяет доступность commit object и совпадение `FETCH_HEAD`, затем переключает checkout на `release/x.y.z` и приводит его к сохранённому SHA через `reset --hard`.

Этап `building` запускает только сохранённую production-команду проекта. После него отдельный этап `health_check` запускает сохранённую команду проверки. Deploy не выполняет regression, `kb:index`, merge или push основной ветки, не создаёт теги и не очищает CI/preview workspace. Поэтому offline-машина разработки или cleanup не могут изменить успешный статус публикации.

Статусы подготовки — `preparing`, `checking`, `ready`, `failed`; статусы deploy — `queued`, `switching`, `building`, `health_check`, `released`, `failed`. История в `project_releases`, шагах и событиях сохраняет каждую попытку и её связь с подготовленной записью. Повторный deploy старой подготовленной ветки использует тот же механизм и тот же сохранённый SHA, без merge, тегов или git revert.

## REST, мост и интерфейс

Маршруты находятся в `apps/server/src/routes/releases.ts`, bridge-контракт — в `packages/shared/src/ipc.ts`, UI — в `packages/ui/src/components/releases/ReleaseCenter.tsx`. Кнопка deploy доступна только для `ready`; центр отдельно показывает подготовку и стадии публикации, текущую released-ветку и предупреждает, когда выбор старой ветки означает откат. Production-машина, checkout и разрешённые команды редактируются владельцем в настройках проекта. История релизов обратно совместима с сохранёнными шагами прежних версий: неизвестный текущему контракту `kind` отображается как есть, а краткая ошибка берётся из диагностического лога (или заменяется нейтральным fallback), поэтому старые `cleanup`/`push_main` не роняют центр релизов.
