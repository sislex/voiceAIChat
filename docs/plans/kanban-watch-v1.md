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

| B01 | Core | — | Integration read endpoint for board cards (self-contained): add `GET /integrations/v1/projects/:id/tasks/state` to `apps/server/src/routes/integrationIngress.ts`, guarded by the project's integration principal with a new scope `tasks:read` (extend `IntegrationTokenScope` in `apps/server/src/auth/integrationTokens.ts` and the scope validation in `apps/server/src/routes/integrationTokens.ts`); the route only forwards to the external board service through the existing bridge the same way the external-tasks route forwards (`GET /internal/kanban/projects/:id/tasks/state`, internal token), no board logic in this repository (`apps/server/src/kanban/boundary.test.ts`); put the response contract `BoardCardsSnapshot` into `packages/shared/src/integrations.ts` with the shape `{ generatedAt, tasks: [{ id, seq, key, title, column: { id, name, semanticType }, autoPilot, autoPilotFixCycles, updatedAt, labels, development: { runId, status, startedAt, finishedAt, failedStep: { title, exitCode, tail } | null } | null, qa: [{ stage, status, failedSummary }], merge: { runId, status, targetBranch, failedSummary } | null, decisionReason: string | null }] }` where `tail` is the last 40 redacted lines of the failed step; tests for the scope check, the 403 on a foreign project and the forwarding; update `docs/kb/protocol.md`. |
| B02 | Kanban | — | Internal snapshot route for the board watcher (self-contained): implement `GET /internal/kanban/projects/:id/tasks/state` in the standalone service with the same internal auth as the external-tasks route, returning `{ generatedAt, tasks: [{ id, seq, key, title, column: { id, name, semanticType }, autoPilot, autoPilotFixCycles, updatedAt, labels, development: { runId, status, startedAt, finishedAt, failedStep: { title, exitCode, tail } | null } | null, qa: [{ stage, status, failedSummary }], merge: { runId, status, targetBranch, failedSummary } | null, decisionReason: string | null }] }` — every task of the project with its column semantic type, autopilot flags and labels, the latest development run with the first failed step (title, exit code, last 40 log lines passed through the existing secret filter), QA stage runs (stage, status, failure summary), the latest merge run (status, target branch, failure summary) and the decision reason when the card sits in `decision_required`; keep the route under 500 ms for 200 cards (one query per table, log loaded only for the failed step); tests with a fixture project covering a failed before-model step, a QA failure and a merged card; document in `docs/kb/ci-qa-merge.md`. |
| B03 | delivery-control | — | Board card watcher in the coordinator (self-contained): add `src/board-watch.ts` that once a minute polls `GET /integrations/v1/projects/:id/tasks/state` of the board origin (`DELIVERY_BOARD_CORE_URL`, bearer token from `DELIVERY_BOARD_TOKEN_FILE`, projects from the board-projects file used by `board-sync.ts`) and expects `{ generatedAt, tasks: [{ id, seq, key, title, column: { id, name, semanticType }, autoPilot, autoPilotFixCycles, updatedAt, labels, development: { runId, status, startedAt, finishedAt, failedStep: { title, exitCode, tail } | null } | null, qa: [{ stage, status, failedSummary }], merge: { runId, status, targetBranch, failedSummary } | null, decisionReason: string | null }] }`; keep the last snapshot per project in coordinator state (`boardCards`, bounded to open cards plus 50 recently finished), diff consecutive snapshots into events `kanban.card_moved`, `kanban.run_failed` (step title, exit code, tail), `kanban.fix_cycle`, `kanban.decision_required`, `kanban.card_stuck` (autopilot card unchanged beyond thresholds: 10 min in `ready`, 30 min in development or QA columns, overridable in `service.env`) and `kanban.card_done`; add a «Kanban» section to `control status` and `status --json` (per project: cards in progress, stuck, decision required, last failures with step and tail head), put stuck and failed cards into the operator queue with the reason, and write the events to the metrics journal read by `scripts/delivery-metrics` so cards are counted next to run tasks (submitted, failed, time to done, fix cycles per card); unit tests with fake snapshots for the diff, thresholds and queue entries plus an integration test with a fake ingress server; document in `docs/`. |
