---
title: git-code-pane
date: 2026-08-31
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# git-code-pane

## Что сделано

- Панель кода: git в **рабочей копии задачи или сессии** — ветка и переключение,
  список изменений, дерево файлов (ленивое, по уровням), side-by-side сравнение,
  правка файла, `add`/`commit`, `push`, создание ветки. Три поверхности на одном компоненте: вкладка «Код» страницы
  проекта (`#/projects/:id/code[/<workspaceId>]`), вкладка «Код» карточки задачи,
  клик по бейджу workspace в шапке чата.
- `packages/shared/src/gitWorkspace.ts` — контракт и чистые разборщики вывода git
  (`status --porcelain=v1 -z -b`, `for-each-ref`, `ls-tree -l`, `log`), валидаторы
  имён ветки/ref/пути, кодек id рабочей копии.
- `apps/server/src/git/scripts.ts` + `workspaceService.ts` + `routes/projectGit.ts`:
  скрипты, резолвер целей со всеми гейтами и 11 ручек `/api/projects/:id/git/*`.
- Новое полномочие `repository:write` (есть у `developer`) + правила в картах
  `projectPermissionForRequest`/`projectFeatureForRequest`.
- `db.updateCiWorkspaceRevision(id, branch, sha, pushed)` — прежний
  `recordCiWorkspaceRevision` стал обёрткой с `pushed = true`; добавлен
  `db.getTaskRepositoryById`.

## Что выяснили (факты, которых не было в KB)

- `git status --porcelain` **кавычит** пути с пробелами даже при
  `core.quotepath=false` (`?? "unt racked.txt"`), а с `-z` — нет; у переименования в
  `-z` первым идёт **новый** путь, вторым старый. Отсюда выбор `-z` + `base64` вместо
  разбора C-кавычек.
- Любой `>` в скрипте делает команду невыполнимой на машине с `allowWrite: false`
  (`WRITE_RE` в `evaluateAgentCommand`) — поэтому маркеры секций пишутся как
  `==VC:name==`, а stderr не перенаправляется.
- Имя секции в разборщике обязано допускать цифры (`status_b64`, `content_b64`) —
  на первом варианте регулярки `[a-z_]+` секции молча склеивались.
- `execStream` не пишет в журнал команд машины, а `registry.exec` пишет: для аудита
  мутаций важно, каким из них идти.
- Незакоммиченные правки в рабочей копии задачи роняют следующий CI-ран
  (`ci/runManager.ts`, exit 66 «Рабочая копия содержит локальные изменения») — именно
  поэтому цикл без коммита и push был незакрытым, и панель говорит об этом баннером.
- Merge-ран берёт источник из **последней отправленной** записи `ci_workspaces`
  (`findLatestPushedCiWorkspace`), поэтому ручной коммит обязан записываться с
  `pushed = 0`, а успешный push — с `pushed = 1`.
- Большие файлы в `packages/shared/src/ci.ts` не находятся `grep`-ом в этом окружении
  (определяется как бинарный): типы `CiWorkspace`/`CiWorkspaceReportItem` там есть,
  искать в таких файлах надёжнее скриптом (`python3 -c "...open(...).read()..."`).

## Куда занесено

- docs/kb/protocol.md — раздел «Git в рабочей копии: `/api/projects/:id/git/*`»
- docs/kb/machines.md — раздел «Git в рабочей копии на машине» (правила скриптов)
- docs/kb/ui.md — раздел «Панель кода: git в рабочей копии задачи и сессии»
- docs/kb/projects.md — раздел «Раздел «Код»: рабочие копии проекта»
- docs/kb/data-auth.md — полномочие `repository:write` и барьеры поверх него

## Открытые вопросы / что осталось

- Поиск по содержимому репозитория из панели (как `make:search` в Make) не сделан:
  сейчас файл находят через дерево или список изменений.
- Гонка «ран стартовал ровно в момент нашего checkout» полноценной блокировкой не
  закрыта: она ловится ошибкой `index.lock` и повтором. Настоящая блокировка требует
  таблицы блокировок каталогов.
- `conversation_workspaces` сервер по-прежнему не заполняет, поэтому цель `chat:`
  опирается на legacy `conversations.workdir` + `execTarget`.
- Модель пока не умеет открывать панель блоком ```tool (`ToolSpec.kind` не расширен) —
  сознательно отложено, чтобы не расширять инструкции чата в этом же круге.
