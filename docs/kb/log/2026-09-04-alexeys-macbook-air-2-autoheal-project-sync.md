---
title: autoheal-project-sync
date: 2026-09-04
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# autoheal-project-sync

## Что сделано

- `projectMainRefreshScript` (`apps/server/src/server.ts`) вместо остановки на грязной
  общей копии проекта прячет правки в stash `vc-autosync-<UTC>` и возвращает копию на
  базовую ветку (`checkout <base>`, иначе `checkout -B <base> refs/remotes/origin/<base>`),
  после чего идёт обычный fetch + `merge --ff-only`.
- Отчёт об автолечении печатается строкой `AUTOHEAL=…`; `ensureProjectMainCurrent`
  возвращает его как `autoHealed`, подготовка пишет в системный лог попытки, ход —
  в промпт модели с запретом самостоятельно восстанавливать спрятанное.
- Тесты: `taskPreparation.test.ts` — автолечение грязной копии с восстановлением из
  stash, возврат с ветки задачи и из detached HEAD, fallback exit 66 при unmerged index;
  `turns.test.ts` — `autoHealed` попадает в промпт хода.

- Убран единственный путь, которым Make писал в репозиторий: маршрут
  `POST /api/make/:id/project-push`, мост `make:projectPush`, `REST.makeProjectPush`,
  тип `MakeProjectPushResult`, кнопки «Вернуть»/«Вернуть всё изменённое» в
  `MakeProjectSyncDialog` и поле `write` в `machineFs`-депенденси make-роутов.
  Make теперь только читает файлы репозитория в свою мастерскую (`project-pull`).

- Make-чат закрыт от машины целиком (`turns.ts`, флаг `makeChat`): машина не
  резолвится, remote-мост не собирается, offline-машина не блокирует ход,
  `MAKE_ONLY_DISALLOWED_TOOLS` действуют при любой роли (раньше admin получал
  встроенные Bash/Write), Codex-ход Make всегда в `plan`. Снимок контекста в
  `routes/rest.ts` приведён к тем же правилам.
- Прежние привязки Make-чатов к машине сняты миграцией в `database.ts`
  (idempotent UPDATE; `exec_target = 'none'` сохраняется), а
  `setConversationExecTarget` больше не пишет машину и каталог Make-чату.
- Единственное действие Make с репозиторием — разовое обновление общей копии до
  `origin/<base>` при создании чата: `refreshProjectMain` в `server.ts`
  вызывается из `POST /api/conversations` при `assistantKind: 'make'`, без
  `await` и best-effort.

## Что выяснили (факты, которых не было в KB)

- Причина инцидента с CHAT-408: общая копия `…/projects/<id>/worktree` делится между
  системным preflight (нужен чистый `main`) и Git-панелью/чатами задач. По reflog копии
  08:38:52 её переключили `main → CHAT-407`, 08:39:06 в ней появилась незакоммиченная
  правка `packages/ui/src/styles/app.css` — следующая подготовка упала на exit 66, а
  после сброса упала бы на exit 67 (ветка ≠ base). Мержем это не лечится: `merge --ff-only`
  при грязном дереве git отвергает.
- `git stash push` отказывает при unmerged index («could not write index / needs merge»,
  git 2.55) — это и есть безопасный признак «автолечение не имеет права трогать».
- `project-push` писал файл мастерской прямо в общую копию проекта: `machine.root`
  в `routes/make.ts` — это `project_machines.path`, а он равен
  `assignments.projectWorkdir.path` (`database.ts`), то есть
  `<storageRoot>/projects/<projectId>/worktree` (`shared/projects.ts:196`). Коммита
  push не делал — копия оставалась dirty. Это второй (после Git-панели и чатов
  задач) источник грязи в общей копии; для Make-ходов системный preflight ещё и
  пропускается (`turns.ts`, условие `assistantKind !== 'make'`).
- Под `set -u` в POSIX sh `$var»` (кириллическая кавычка вплотную) читается как имя
  `var»` → `unbound variable`. В сообщениях скриптов нужно `${var}`.
- stash делает коммит и требует git identity; на машине агента её может не быть, поэтому
  вызов идёт через `-c user.name=… -c user.email=…`.

## Куда занесено

- docs/kb/llm.md — политика инструментов Make-чата и разовый refresh при создании

- docs/kb/machines.md — раздел про системный preflight общей проектной копии
- docs/kb/features/task-preparation.md — поведение preflight подготовки
- docs/kb/ui.md — раздел Make ↔ репозиторий проекта (теперь только чтение)
- docs/kb/protocol.md — контракт make-маршрутов без `project-push`

## Открытые вопросы / что осталось

- Diverged базовая ветка (локальные коммиты в общей копии) по-прежнему останавливает
  синхронизацию (exit 68 / отказ `merge --ff-only`) — автолечение сюда не расширяли.
