---
title: Автопроход задачи по QA-конвейеру
updated: 2026-09-16
checked: 63808e3c
areas:
  - packages/shared/src/projects.ts
  - apps/server/src/kanban/module.ts
  - apps/server/src/db/repos/tasks.ts
  - apps/server/src/db/repos/qa.ts
  - apps/server/src/db/database.ts
  - apps/server/src/db/schema.ts
  - apps/server/src/routes/projects.ts
  - apps/server/src/routes/qa.ts
  - apps/server/src/ci/componentQa.ts
  - apps/server/src/ci/integrationTests.ts
  - apps/server/src/ci/runManager.ts
  - apps/server/src/ci/modelHooks.ts
  - packages/ui/src/components/kanban/TaskCard.tsx
  - packages/ui/src/components/kanban/TaskModal.tsx
  - packages/ui/src/components/ci/RunFeed.tsx
  - packages/ui/src/components/ProjectSettings.tsx
---

# Автопроход задачи по QA-конвейеру

## Включение и настройки

Автопроход доступен только элементам типа `task` и по умолчанию выключен. Флаг
`Task.autoPilot` хранится в `tasks.auto_pilot`, меняется через обычный PATCH
карточки и меню `TaskCard`; включённое состояние видно на доске чипом
«⏩ Автопроход». Настройка проекта `autoPilotDefault`
(`projects.autopilot_default`, чекбокс «Включать автопроход у новых задач» в
`ProjectSettings`) ставит этот флаг новым карточкам типа `task` при создании:
пока его приходилось включать руками каждой задаче, конвейер всё равно начинался
с действия человека. Эпик и история флаг не наследуют — этапы они не проходят. Счётчик уже использованных возвратов хранится отдельно в
`auto_pilot_fix_cycles` и наружу отдаётся как `autoPilotFixCycles`.

Владелец проекта задаёт в `ProjectSettings` команду полного Automated QA,
необходимость ручного QA и максимальное число автоматических доработок. Поля
`projects.automated_qa_command`, `autopilot_requires_manual_qa` и
`autopilot_fix_limit` имеют дефолты `npm test`, false и 3; лимит принимается
только как неотрицательное целое. Контракты проекта и задачи находятся в
`packages/shared/src/projects.ts`, запись и миграции — в
`apps/server/src/db/database.ts` и `apps/server/src/db/schema.ts`.

Task settings expose autopilot and a manual QA pause. `Task.autoPilotRequiresManualQa`
is stored in `tasks.auto_pilot_requires_manual_qa` and carried by task PATCH and
board snapshots. New tasks inherit the project preference once; subsequent edits
are independent. Migration preserves the previous project setting for existing
tasks. With the pause disabled, autopilot moves from `manual_qa` to the merge
queue immediately. Clearing the pause also wakes the coordinator.

## Координатор

The coordinator lives in `apps/server/src/kanban/module.ts` and subscribes to
`boardHub.onChange`. Executors emit directly through the hub, so subscribing only
to the `emitBoard` wrapper would miss completion events. A tick selects the
executor for the task's current `semantic_type`: preparation, development,
Component QA, Integration Tests, Automated QA, or `MergeRunManager`. Executor
idempotency reuses active runs. A process-local set serializes ticks per project;
`pendingTicks` preserves changes received during a tick and processes them next.

Failures are caught per task so one unavailable workspace cannot stall the project.
Skipped Component QA, Integration Tests and manual QA emit board events to wake
their successors. A QA run created as `blocked` reaches the failure handler even
when its executor never starts. Retrying failed or blocked QA respects the shared
delay using persisted `finishedAt`, preventing immediate infrastructure retry
loops. A zero retry limit still permits the first preparation and merge attempts.

The delay alone was not a limit: an infrastructure failure deliberately skips the
fix-cycle counter, so a QA stage whose environment is broken restarted after every
backoff forever — in production three tasks each queued five 30-minute Automated QA
runs on «Лимит времени Automated QA исчерпан» and nobody was told. The tick now
counts the streak of failed stage runs (`trailingQaStageFailures` in
`ci/autopilotResume.ts`, newest first over `runs` of the stage; `cancelled` breaks
the streak) and at `autoPilotFixLimit` records `autopilot.stopped` and moves the
task to `decision_required` — the safeguard merge already had. Regression:
`autopilotPipeline.test.ts › останавливает этап после лимита подряд упавших ранов`.

Начало конвейера покрыто тем же координатором. Из `backlog` и `preparation`
карточка сама уходит в подготовку (`launchTaskPreparation` идемпотентен и
переносит её в колонку `preparation`), из `ready` — сама встаёт в очередь
development-рана через `startForDevelopmentTransition`. До этого старт подготовки
и переход `ready → development` жили только в drag&drop-роуте доски
(`apps/server/src/routes/projects.ts`), поэтому карточка с включённым
автопроходом ждала, пока человек перетащит её руками.

Этап не запускается на спящей машине: перед стадией координатор проверяет, что
у проекта есть online-машина (подготовка требует её только у Git-проекта, а
пропуск ручного QA — чистая работа с доской). Иначе падение вида «Машина
отключилась во время выполнения команды» перезапускалось следующим board-событием
и жгло круги доработки за чужой сбой. Приход машины в онлайн board-события не
даёт, поэтому раз в минуту (`AUTOPILOT_SWEEP_MS`) координатор сам обходит проекты
из `db.autoPilotProjectIds()`; тик идемпотентен и на живом конвейере ничего не
делает.

Обрыв канала до исполнителя LLM («Соединение с исполнителем Codex оборвалось до конца ответа») тоже считается инфраструктурным: `classifyLlmTransportFailure` в `apps/server/src/ci/infraErrors.ts` помечает такой провал шага «Работа модели» событием `run.infra_error`. Прежде ран отчитывался «Ошибка модели — выберите другую модель», хотя модель даже не успела ответить, и автопроход вставал.

Ран, брошенный сбоем машины или транспорта, координатор **возобновляет с упавшего шага**, а не
начинает заново: работа модели уже лежит в рабочей копии, и новый ран заставил бы
её повторить (реальный случай CHAT-413 — ноутбук ушёл в сон на шаге «Закоммитить
работу в ветку задачи»). Условие возобновления — чистая функция
`shouldResumeAfterInfraFailure` (`apps/server/src/ci/autopilotResume.ts`): ран
терминально упал (`failed`/`timeout`), у него есть событие `run.infra_error`, и
предел `AUTOPILOT_INFRA_RESUMES` не исчерпан. Каждое возобновление пишет
`run.autopilot_infra_resume`, а считает их `db.countCiEvents(runId, type)`. Дефект
кода так не лечится — для него остаётся обычный fix-loop.

Автоматический development-старт из `ready` и `development` проходит через
один общий предохранитель. Он читает последний актуальный ран и до любого нового
рана или `retryFromFailed` проверяет dirty workspace, паузу
`AUTOPILOT_RETRY_BACKOFF_MS` и `db.countTrailingFailedCiRuns(taskId)` против
`autoPilotFixLimit`. Поэтому возврат карточки в `ready` не стирает историю
отказов и не обходит cooldown или лимит; при отсутствии предыдущего отказа первый
старт разрешён даже с нулевым лимитом повторов.

Провал «Рабочая копия содержит локальные изменения»
(`isDirtyWorkspaceFailure`) имеет приоритет и над `run.infra_error`: там лежит
потенциально ценная незакоммиченная работа, поэтому автоматика не создаёт новый
ран, не продолжает старый и не очищает каталог. Она один раз на связанный `runId`
пишет персистентный `autopilot.stopped` с причиной и ручным действием; повторные
и попавшие в `pendingTicks` события после рестарта не размножают запись.
Пользователь сохраняет изменения либо вручную продолжает подходящий шаг того же
рана; сброс рабочей копии остаётся действием с явным подтверждением. Для обычного
code failure сохраняется новый fix-run, а инфраструктурный отказ после общих
проверок продолжает существующий ран через `retryFromFailed` в пределах отдельного
лимита `AUTOPILOT_INFRA_RESUMES`. При исчерпании общего лимита карточка по
доступному workflow переходит в `decision_required` с `autopilot.stopped`.
Успешный ран обнуляет последовательность отказов.

Общая проверяемая матрица причин находится в
`apps/server/src/ci/runAdmission.ts`. Она одинаково описывает development,
Component QA, Integration Tests, Automated QA и merge: инфраструктурные причины
(`offline`, отсутствующий toolchain, недоступный origin, ENOSPC) допускают
продолжение с упавшего шага после восстановления; dirty workspace и незавершённый
merge сохраняют работу и требуют решения человека; исчерпанный общий бюджет,
неверная привязка и неизвестная причина fail-closed. `admitPipelineRun`
проверяет абсолютный workspace, владельца и версию привязки, активную попытку,
решение, budget и `nextRetryAt`; первый запуск разрешён при нулевом retry-limit.
`AdmissionReservations` не допускает две одновременные резервации одного
снимка задачи, а после асинхронного preflight версия привязки должна совпасть с
проверенной до её атомарной активации.

Регрессия в `apps/server/src/autopilotPipeline.test.ts` воспроизводит
`ready → development → failed/timeout dirty → ready`, конкурентные board-события
и отсутствие новых ранов/повторных stop-событий. Границы cooldown и
инфраструктурной классификации закреплены в `ci/autopilotResume.test.ts`, а
видимое объяснение и безопасные ручные действия — DOM-тестом `RunFeed`.

Ожидание ответа на вопрос модели (`waiting_for_answer`) координатор не трогает:
там нужен человек. Упавшая попытка подготовки повторяется автоматически в
пределах `autoPilotFixLimit` — разовый инфраструктурный сбой не должен требовать
ручного «Повторить». При исчерпании лимита пишется `autopilot.stopped`, и
карточка уходит в `decision_required` (из `backlog` такого перехода нет, поэтому
там она просто остаётся с записью в аудите).

Оба runner-а передают в `completed` ещё и `classification`: без неё отвалившаяся
посреди шага машина («Машина отключилась во время выполнения команды») шла в
fix-loop как дефект кода и жгла цикл доработки за чужой сбой (прод, CHAT-413).
Component QA and Integration Tests await `completed` on every outcome, including
early exits for unavailable workspaces, failed diff inspection and missing case
coverage. The completion transition must finish before the final board event can
start another attempt. Failure classification distinguishes implementation defects
from infrastructure outages so the latter do not consume development fix cycles.

Успешные специализированные runner-ы сообщают результат callback-ом. Координатор
завершает gate штатными DB-методами, поэтому переходы идут через
`canTransitionWorkflow` с actor `automation`, а не прямым обходом карты. Цепочка
после development имеет вид `component_qa → integration_tests → automated_qa →
manual_qa → awaiting_merge → merge`. Если ручной QA не обязателен, координатор
переводит карточку из `manual_qa` в `awaiting_merge`; если обязателен — оставляет
её ждать человека. `awaiting_merge` не обходится: оттуда запускается существующий
merge-ран.

Колонка `merge` обрабатывается тем же шагом координатора, что и `awaiting_merge`:
карточка с упавшим merge-раном раньше не подхватывалась никем, и «Машина
отключилась во время выполнения команды» оставляла её стоять навсегда (прод,
CHAT-412). `db.startMergeRun` идемпотентен (возвращает активный ран), поэтому
повторные тики безопасны; предохранители — `countTrailingFailedMergeRuns` против
`autoPilotFixLimit` и пауза `retryAllowedNow` по `lastMergeRunFinishedAt`.

Каждый координаторный перенос записывается в `qa_audit` с actor `automation` и
payload `from/to`; отдельно журналируются ошибка, возврат, пропуск ручного QA и
исчерпание лимита. Источники поведения — `autoPilotSnapshot`,
`transitionAutoPilotTask` и `recordAutoPilotEvent` в
`apps/server/src/db/database.ts`.

## Ошибка и возврат на доработку

Для ошибки выбран связанный bug, а не изменение критериев исходной задачи:
диагностика сбоя является отдельной работой и должна иметь собственный жизненный
цикл, не превращая утверждённые критерии приёмки в журнал запусков.
`handleAutoPilotFailure` создаёт в backlog task с меткой `bug`, записывает в его
описание этап, причину и ссылку на ран и ставит `source_task_id` на исходную
карточку. Затем увеличивает счётчик циклов, переводит исходную задачу в
`development` разрешённым automation-переходом и запускает development fix-run.
После его успеха board event снова запускает QA-цепочку с Component QA.

Diagnostic bugs receive `autoPilot=false`: the original task's fix run handles
the defect, and project defaults must not launch duplicate development. The
reason, summary, commands, blockers and log tail are persisted in `fixContext`
before enqueueing and included in the first development model request.
Component QA and Integration Tests also store `linkedFixRunId`.

Перед созданием очередного bug метод сравнивает использованные циклы с
`autoPilotFixLimit`. При исчерпанном лимите новая доработка не стартует: карточка
переходит в `decision_required`, а причина, этап, ран, счётчик и лимит остаются в
аудите. Автоматика не может вывести её из этой колонки, потому что это запрещает
общий `canTransitionWorkflow`.

## Automated QA и восстановление

Исполнитель команды, потоковый лог, timeout и повтор после рестарта описаны в
[qa-stage-runs.md](qa-stage-runs.md). Восстановление относится к самому
Automated QA-рану; Component QA и Integration Tests при рестарте сохраняют своё
прежнее терминальное поведение. Ручные start/retry/cancel Automated QA используют
тот же runner через `apps/server/src/routes/qa.ts`.
