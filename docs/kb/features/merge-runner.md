---
title: Merge-ран задачи: безопасное слияние в main
updated: 2026-08-13
checked: e36b0d7
areas:
  - packages/shared/src/merge.ts
  - packages/shared/src/projects.ts
  - packages/shared/src/protocol.ts
  - apps/server/src/merge
  - apps/server/src/db/database.ts
  - apps/server/src/db/schema.ts
  - apps/server/src/routes/projects.ts
  - apps/server/src/server.ts
  - packages/ui/src/components/ci/MergeRunFeed.tsx
  - packages/ui/src/components/kanban/TaskModal.tsx
  - packages/ui/src/remote
---

# Merge-ран задачи: безопасное слияние в main

## Граница подсистемы

Merge выполняет отдельный `MergeRunManager` из
`apps/server/src/merge/runManager.ts`; development CI заканчивается подготовкой и
push ветки задачи в `origin`, после чего карточка находится в
`awaiting_merge`. Merge-ран не запускает production deploy и не смешивает своё
состояние или ленту с CI-раном разработки.

Клиент запускает процесс через
`POST /api/projects/:id/tasks/:taskId/merge`, не передавая ветку, target, Git URL,
checkout или машину. `VoiceChatDb.startMergeRun` определяет их из задачи,
проекта и последнего успешно отправленного `ci_workspaces`, требует owner-доступ,
target `main`, сохранённый source SHA и привязанную машину. Машина merge-рана
всегда берётся из этой записи workspace, а не из текущей default-машины проекта
или настройки карточки: именно на ней гарантированно существует родительский
каталог для временного merge-клона. Создание идемпотентно:
partial unique index и транзакционная проверка оставляют не больше одного активного
merge-рана задачи, а повторное нажатие возвращает его.

## Исполнение и защита main

Менеджер использует один процесс-глобальный слот и ведёт ран по стадиям
`checking → fetching → merging → testing → pushing`. Fetch сохраняет source и
актуальный `origin/main` в refs `refs/merge-runs/<runId>/source|target`, поэтому
не зависит от общего `FETCH_HEAD`, и повторно сравнивает remote source с
зафиксированным SHA. Изменившаяся после CI ветка завершается как stale source до
checkout target.

CI-workspace после успешного push может быть `released` и уже удалён cleanup-командой.
Поэтому менеджер использует из его записи только сохранённые ветку, SHA, машину и
путь, а Git-операции выполняет в **постоянном merge-клоне проекта**
`{repos_root}/{project}/.merge`, созданном напрямую из проектного Git URL при
первом ране на машине. Перед каждым merge дерево вычищается (`merge --abort`,
`checkout -f --detach <target>`, `reset --hard`, `clean -fd`); `node_modules`
в `.gitignore` и потому переживает очистку. Изоляцию обеспечивает глобальный
слот менеджера — активный merge-ран всегда один. Merge строится от полученного
target SHA и создаёт merge-коммит с идентификатором задачи, не переключая и не
загрязняя рабочую копию CI.

Сразу после fetch — до stale-сверки — менеджер проверяет
`git merge-base --is-ancestor source target`: уже влитая в main ветка завершает
ран мгновенным успехом «Ветка уже вмержена в main» (mergeSha = target) без
установки зависимостей, гейта и push; карточка уходит в `done`, копии
репозиториев задачи чистятся как при обычном успехе.

При конфликте пути из `git diff --name-only --diff-filter=U` сохраняются в
снимке. Конфликт, затрагивающий **только** `docs/kb/README.md`
(перегенерируемый индекс БЗ), менеджер разрешает сам: `node scripts/kb.mjs
index`, `git add`, `commit --no-edit` — и merge продолжается. Любой другой
набор конфликтов переводит ран и карточку в `decision_required`; автоматическое
LLM-разрешение в текущей реализации не запускается.

Машину рана можно выбрать: `POST …/merge` и `…/retry` принимают `agentId` любой
машины проекта (`startMergeRun` проверяет привязку через `project_machines`);
без него ран идёт на машине workspace, retry наследует машину предыдущей
попытки. На машине, отличной от машины разработки, workspace-каталог не нужен:
постоянный клон создаётся в `{repos_root}/{project}/.merge` по схеме CI-раннера
(`mergeBase` в runManager; `mkdir -p` создаёт родителя). Origin
клона сверяется канонично (`canonicalGitUrl`: host/owner/repo без протокола,
`git@`, `.git`), поэтому машинный rewrite SSH→HTTPS (`insteadOf`, MacBook) не
валит проверку, а посторонний репозиторий по-прежнему отклоняется.

Копии репозиториев задачи учитываются в `task_repositories` (машина, путь,
`dev-workspace` | `merge-clone`, `active` | `deleted`): workspace разработки
регистрируется при merge-ране, запись помечается `deleted` только после
подтверждённого `rm -rf`. Постоянный merge-клон — project-scoped, в учёте задач
не значится и при их закрытии не удаляется. Успешный merge и **ручной перенос
карточки в Done** (хук в маршруте `…/move`) удаляют все активные копии задачи
на доступных машинах (`releaseTaskRepositories` — публичный метод менеджера);
запись недоступной машины остаётся до следующей очистки. Список отдаёт
`GET …/tasks/:taskId/repositories`, в UI он виден во вкладке «Merge» задачи.

Перед проверками менеджер сверяет `git hash-object package-lock.json` с
маркером `node_modules/.merge-lock-sha`: при совпадении `npm ci` пропускается
(«Зависимости актуальны»), при расхождении выполняется
`npm ci --no-audit --no-fund` с кэшем `{repos_root}/{project}/.merge-npm-cache`
(лимит 15 минут) и маркер обновляется. Маркер живёт внутри `node_modules`,
поэтому `git clean -fd` его не трёт. Ошибка установки завершает ран до
запуска проверок.

Настроенная `project.testCommand` либо fallback `npm run affected-check`
выполняется во временном merge-клоне до push. Обычная строка запускается как одна
команда; JSON-массив непустых строк исполняется последовательно с fail-fast — в том
же формате, который использует release-gate проекта; каждой команде отводится до
30 минут (полный UI-набор не укладывался в прежние 5). Результат проверки хранит времена,
длительность, exit code, timeout и полный вывод. Любая неуспешная обязательная
проверка оставляет `origin/main` неизменным и возвращает карточку в
`awaiting_merge`.

Перед push менеджер заново fetch-ит main и требует прежний target SHA. Push
выполняется явным refspec через
`--force-with-lease=refs/heads/main:<targetSha>`; безусловного force нет.
Успех фиксируется лишь после того, как `git ls-remote` подтверждает merge SHA,
затем задача переходит в `done`. Конкурентное изменение main и неопределённый
результат push переводят процесс в `decision_required` с рекомендуемым
действием.

## Состояние, восстановление и управление

Контракт снимка находится в `packages/shared/src/merge.ts`: он отделяет общий
статус от записей стадий, проверок и конфликтов и содержит SHA, времена, журнал,
рекомендованное действие, `canCancel`, `canRetry` и `pushStartedAt`. SQLite
хранит эти данные в `merge_runs`; snapshot доски дополнительно отдаёт
`activeMergeRunId` и `latestMergeRunId`, поэтому активная или последняя лента
восстанавливается после reload.

`DELETE /api/merge/runs/:runId` отменяет дочернюю команду и возвращает карточку
в `awaiting_merge`, но только пока push не отмечен начатым.
`POST /api/merge/runs/:runId/retry` создаёт новую попытку через повторные
серверные проверки. Обычный retry сохраняет строгую сверку с SHA development-рана.
Если предыдущая попытка обнаружила Git-конфликты, владелец разрешает их в task-ветке;
у такой новой попытки source SHA намеренно остаётся пустым до fetch, после чего
менеджер сразу фиксирует актуальный remote SHA и продолжает merge. Иначе ручное
разрешение неизбежно считалось бы stale source. Тем же образом снимается закрепление
при retry попытки, которая сама завершилась ошибкой stale source (`retryMergeRun`
распознаёт её по тексту ошибки), и при явном `{"unpin":true}` в теле retry —
кнопка «Мержить текущий head ветки» в ленте stale-рана. Обычный retry (упавшие
проверки и прочие сбои) по-прежнему сохраняет строгую сверку с SHA
development-рана. Постоянный merge-клон после рана не удаляется.

История попыток задачи — `GET …/tasks/:taskId/merge/runs` (`listMergeRuns`,
свежие первыми), в UI это список «Попытки» во вкладке Merge. Из успешного рана
доступен production-деплой: `POST /api/merge/runs/:runId/deploy` запускает
штатный `ReleaseManager.start` по ветке main и пишет `deployId`,
`deployVersion` и `productionStatus` в снимок рана (кнопка «Выпустить на прод»
в ленте). Терминальный исход merge-рана показывается тостом через
store-подписку на `merge.snapshot` (дедуп по ран+статус).

При старте сервера `reconcile()` подбирает незавершённые записи. Для рана с
`pushStartedAt` и `mergeSha` он не повторяет merge или push: только читает
remote main, завершает success при совпадении либо требует ручного решения при
расхождении. Остальные активные записи безопасно запускаются через обычный
исполнитель.

## Realtime-лента

Сервер публикует отдельное WS-сообщение `merge.snapshot` через подписчиков
CI-транспорта; контракт сообщения зарегистрирован в
`packages/shared/src/protocol.ts`. `MergeRunFeed` принимает snapshots через
remote-мост и параллельно опрашивает REST раз в три секунды как fallback. В
карточке показываются статус, стадия, SHA, машина, инициатор, длительность,
ошибка, конфликты, проверки и сохранённый лог; доступны копирование, скачивание
`.txt`, управление автоскроллом, отмена и повтор.
