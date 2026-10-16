# kanban-watch-v1 — координатор следит за карточками канбана как за задачами воркеров

Ран `kanban-watch-v1`. Ветка задач — `dev`. Задачи выполняют воркеры MacBook (M2); M1 выключен.

## Что случилось

Владелец 2026-10-16: «Координатор также должен следить за тасками в канбане так же, как за тасками, которые
разрабатываются через воркеры». Сейчас Delivery Control знает о канбане только в одну сторону: `board-sync.ts`
отражает задачи прогонов карточками (`PUT /integrations/v1/projects/:id/external-tasks/...`). Карточки самого
канбана координатор не видит: SISL-735 и SISL-736 15 октября сутки крутились между «Готово к разработке» и запуском
(шаг подготовки падал с кодом 66 за 2 секунды), SISL-737 дважды падал на Automated QA, и ни одно из этих событий не
попало ни в `control status`, ни в очередь оператора, ни в метрики `sislexa-delivery-metrics`. Причины приходилось
доставать вручную через `GET /api/ci/runs/<runId>/log`. Сбои карточек разбирает только автопилот (фикс-циклы до
`autoPilotFixLimit`, затем «Требуется решение»), оператора никто не зовёт.

Целевое поведение:

- Ядро отдаёт координатору по интеграционному токену снимок карточек проекта:
  `GET /integrations/v1/projects/:id/tasks/state` (scope `tasks:read`), ответ
  `{ generatedAt, tasks: [{ id, seq, key, title, column: { id, name, semanticType }, autoPilot, autoPilotFixCycles,
  updatedAt, labels, development: { runId, status, startedAt, finishedAt, failedStep: { title, exitCode, tail } | null }
  | null, qa: { stage, status, failedSummary }[], merge: { runId, status, targetBranch, failedSummary } | null,
  decisionReason: string | null }] }`. `tail` — последние 40 строк вывода упавшего шага без секретов. В режиме
  `VC_KANBAN_MODE=remote` ядро пересылает запрос сервису доски так же, как внешние задачи.
- Координатор раз в минуту опрашивает снимок по проектам из файла board-projects, хранит последнее состояние карточек
  в своём состоянии и превращает изменения в события: `kanban.card_moved`, `kanban.run_failed` (с шагом и хвостом),
  `kanban.card_stuck` (карточка с автопилотом не меняла колонку дольше порога, по умолчанию 30 минут в
  `development`/QA-колонках и 10 минут в `ready`), `kanban.decision_required`, `kanban.fix_cycle`, `kanban.card_done`.
- `control status` получает раздел «Kanban» (по проектам: сколько карточек в работе, застрявших, в «Требуется
  решение», последние сбои), сбои и застревания попадают в очередь оператора (`operator.attention`) с причиной, события
  пишутся в журнал метрик, `sislexa-delivery-metrics` считает карточки канбана рядом с задачами прогонов (сдано, упало,
  время до «Готово», фикс-циклы на карточку).

## Задачи интегратора (Claude, вне манифеста)

- После приёмки: выпуск Kanban, закрепление в Core, релиз Core и деплой; токен интеграции координатора получает scope
  `tasks:read`; выкат координатора; проверка на карточке в проекте Sislexa и на искусственно сломанной карточке.

| B01 | Core | — | Integration read endpoint for board cards, per docs/plans/kanban-watch-v1.md «Целевое поведение»: add `GET /integrations/v1/projects/:id/tasks/state` to `apps/server/src/routes/integrationIngress.ts` guarded by the integration principal of the project with a new scope `tasks:read` (`apps/server/src/auth/integrationTokens.ts`, token issuing routes and the admin contract), returning the snapshot shape from the plan (tasks with column semantic, autopilot state, last development run with the failed step title/exit code/40-line redacted tail, QA stage states, merge run with target branch, decision reason); in embedded mode build it from the local repositories, in `VC_KANBAN_MODE=remote` forward it to the board service's internal route `GET /internal/kanban/projects/:id/tasks/state` the same way external tasks are forwarded; put the response contract into `packages/shared/src/integrations.ts`; tests for scope checks, the embedded snapshot and the remote forwarding; update `docs/kb/protocol.md`. |
| B02 | Kanban | — | Internal snapshot route for the board watcher, per the shape in docs/plans/kanban-watch-v1.md «Целевое поведение»: implement `GET /internal/kanban/projects/:id/tasks/state` in the standalone service (same internal auth as the external-tasks route) returning the plan's snapshot — every task of the project with column semantic type, autopilot flags, labels, the latest development run (status, timestamps, the first failed step with title, exit code and the last 40 log lines redacted by the existing secret filter), QA stage runs (stage, status, failure summary), the latest merge run (status, target branch, failure summary) and the decision reason when the card sits in `decision_required`; the route must stay under 500 ms for 200 cards (one query per table, no per-card log loads except the failed step); tests with a fixture project covering a failed before-model step, a QA failure and a merged card; document in `docs/kb/ci-qa-merge.md`. |
| B03 | delivery-control | — | Board card watcher in the coordinator, per docs/plans/kanban-watch-v1.md «Целевое поведение»: add `src/board-watch.ts` that polls `GET /integrations/v1/projects/:id/tasks/state` once a minute for every project of the board-projects file with the board token, keeps the last snapshot per project in coordinator state (`boardCards`, bounded to the open cards plus 50 recently finished), diffs consecutive snapshots into events `kanban.card_moved`, `kanban.run_failed` (step, exit code, tail), `kanban.fix_cycle`, `kanban.decision_required`, `kanban.card_stuck` (autopilot card unchanged beyond thresholds: 10 min in `ready`, 30 min in development or QA columns, configurable in `service.env`) and `kanban.card_done`; surface a «Kanban» section in `control status` (per project: cards in progress, stuck, decision required, last failures with step and tail head) and in `status --json`, add stuck and failed cards to the operator queue with the reason, write the events to the metrics journal consumed by `scripts/delivery-metrics` so cards are counted next to run tasks (submitted, failed, time to done, fix cycles per card); unit tests with fake snapshots for the diff, thresholds and queue entries, an integration test with a fake ingress server; document in `docs/`. |
