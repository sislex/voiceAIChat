---
title: Версионные release-ветки и публикация в production
updated: 2026-08-10
checked: 1d2008b
areas:
  - packages/shared/src/release.ts
  - packages/shared/src/protocol.ts
  - packages/shared/src/ipc.ts
  - apps/server/src/releases
  - apps/server/src/routes/releases.ts
  - apps/server/src/db/schema.ts
  - apps/server/src/db/database.ts
  - apps/server/src/server.ts
  - packages/ui/src/components/releases
  - packages/ui/src/components/ProjectPage.tsx
  - packages/ui/src/App.tsx
  - packages/ui/src/remote/httpApi.ts
---

# Версионные release-ветки и публикация в production

## Release-ветки

Центр релизов работает только с удалёнными ветками строгого вида `release/x.y.z` без ведущих нулей. Общая валидация находится в `packages/shared/src/release.ts`. Перед показом списка сервер выполняет fetch с prune и читает только `refs/remotes/origin/release/*`, поэтому UI выбирает существующую ревизию из актуального origin. Каждая часть составных shell-команд вызывается как Git-подкоманда: `git fetch && git for-each-ref`, создание ветки — `git fetch && git branch && git push`, merge — `git fetch && git checkout && git merge`. Пропущенный `git` после `&&` заставляет zsh искать отдельные программы `for-each-ref`/`branch`/`checkout` и завершает соответствующий release-шаг ошибкой.

Создать release-ветку может только владелец проекта. Базой служит настроенная `ciBaseBranch` (по умолчанию `main`) либо уже существующая валидная release-ветка; совпадающее имя и недопустимая база отклоняются до создания. Git-операции выполняются на default-машине проекта в пути её checkout. Реализация находится в `apps/server/src/releases/releaseManager.ts`.

## Защищённая публикация

Запуск доступен только владельцу. `ReleaseManager` повторно обновляет origin, находит выбранную ветку и фиксирует её SHA до первого шага. Одновременно для одного проекта исполняется не больше одной публикации. REST возвращает созданную попытку сразу, а обязательные ворота продолжаются асинхронно.

Порядок ворот задан `RELEASE_STEP_ORDER` в `packages/shared/src/release.ts`: regression через `npm run affected-check`, проверка актуальности файловой базы знаний, merge зафиксированного SHA в основную ветку, push основной ветки, штатный host-side production deploy, health-check и очистка feature-preview/workspace завершённых задач. Первый сбой переводит текущий шаг и попытку в `failed`; последующие шаги остаются `queued`. `released` ставится только после всех ворот.

Merge строится от свежей `origin/<ciBaseBranch>` и использует сохранённый SHA, поэтому движение release-ветки после старта не меняет публикуемый код. Ворота push создают на этом SHA тег `v<version>` и атомарно отправляют основную ветку вместе с тегом: повтор того же релиза безопасен, а уже занятый другим SHA тег отклоняет всю отправку. Прод-скрипты читают этот тег и передают номер в `VC_RELEASE_VERSION`. Production deploy вызывается через штатный `deployTrigger`. Release health-check обращается к `/api/health` по loopback самого сервера, а не через default-машину проекта: default-машина обслуживает Git release-веток и может быть MacBook без production на `127.0.0.1:8787`. Host-side deploy независимо ждёт реальный health после сборки. Cleanup удаляет preview задач из `done` и переводит их активные CI workspace в `released`. Инфраструктурная привязка находится в `apps/server/src/server.ts`.

## История и повторы

Схема в `apps/server/src/db/schema.ts` хранит попытки в `project_releases`, упорядоченную ленту ворот в `project_release_steps` и аудит в `project_release_events`. Повтор создаёт новую попытку со ссылкой `previousReleaseId`; прежние SHA, шаги и события не переписываются. Историю читают участники проекта, изменяющие операции выполняет только владелец. DB-операции находятся в `apps/server/src/db/database.ts`.

## REST, мост и интерфейс

Маршруты списка и создания веток, истории, запуска и чтения попытки находятся в `apps/server/src/routes/releases.ts`; адреса и bridge-контракт — в `packages/shared/src/protocol.ts` и `packages/shared/src/ipc.ts`, web-мост — в `packages/ui/src/remote/httpApi.ts`.

На странице проекта появился маршрут и вкладка «Релизы». `packages/ui/src/components/releases/ReleaseCenter.tsx` параллельно обновляет ветки и историю, позволяет владельцу создать версию или опубликовать выбранную origin-ветку и показывает SHA, инициатора, номер попытки, статусы ворот, модели и логи. Участнику без роли owner доступен просмотр, но не изменяющие операции.
