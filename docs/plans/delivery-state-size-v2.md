# delivery-state-size-v2 — горячее состояние координатора без ручной уборки

Ран `delivery-state-size-v2`. Ветка задач — `dev`. Репозиторий — delivery-control.

## Что случилось (2026-10-21)

Все три задачи `delivery-state-size-v1` в коде (`origin/main` delivery-control `0107713`): лог гейта —
артефакт (`gateLogArtifact`), `control_commands` чистится по `DELIVERY_COMMAND_RETENTION_MS`, пул `max: 12`,
`connectionTimeoutMillis: 15000`, метрики `coordinator` в `/healthz` и `control status`. Тем не менее
2026-10-21 координатор снова в зоне предупреждения: `state 935390 bytes | mutate p50 2773 ms p95 4290 ms |
pool waiting 6` (в пике p95 6825 мс) — до lost-шторма 2026-10-11 (7–10 с) осталось немного.

Разложение состояния по `GET /v1/status?all=1` (880 КБ JSON, 12 прогонов, 76 попыток, 7 из них уже
архивированы и ждут вытеснения):

| Раздел | Байт | Что внутри |
|---|---|---|
| `attempts` | 279 000 | `result` 60 К, `metrics` 48 К, `integration` 33 К, `execution` 33 К, `workspace` 31 К |
| `runs` | 249 000 | `tasks` 181 К (`description` 69 К, `ownerAcceptance` 58 К, `execution` 25 К), `plan` 65 К — те же описания второй раз |
| `boardCards` | 150 000 | зеркало 16 досок: 163 карточки (`title` 77 К), `lastFailures` |
| `mainChecks` | 37 000 | `profiles`/`merges`/`checks` всех прогонов, без удаления |
| `delivery.acceptances` | 33 000 | 97 записей, без удаления, не уходят с архивом прогона |
| `cardRuns` | 16 000 | 7 записей, `input` карточки целиком; запись остаётся навсегда |

По прогонам: `deployment-profiles-v2` — 235 К, `deployment-profiles-v1` — 75 К, остальные 10–45 К.
Причины роста, которых v1 не касался:

1. **Прогон уходит из состояния только после ручного `run archive`.** Карточечные прогоны `card-*`,
   завершённые и доставленные, неделями лежат в состоянии; прогон с одной упавшей задачей держит в нём
   все свои попытки (deployment-profiles-v2 — 27 задач, 235 К) — 15 пунктов «ждёт оператора» по 65–118 ч.
2. **Справочники не вытесняются вместе с прогоном.** `takeArchivedRuns` убирает `runs` и `attempts`, но
   не `delivery.acceptances`, `mainChecks`, `cardRuns`, `boardRepairs`.
3. **Зеркало досок живёт в состоянии.** `BoardWatch.poll` на каждом тике делает 16 полных мутаций
   (по одной на проект) и ещё одну на уборку: каждая читает, валидирует и пишет всё состояние ради
   `polledAt`/`unchangedSince` одной доски.
4. **Пульс воркера — полная мутация.** `POST /v1/workers/heartbeat` и `/v1/workers/next` у 14 воркеров
   переписывают всё состояние ради `lastSeen`/`lastHeartbeatAt`/`expiresAt`. Мутации сериализованы
   замком строки `FOR UPDATE`, поэтому p50 в секундах — это в основном ожидание замка, а не работа.
5. **План прогона хранится дважды.** `run.plan.tasks[].description` и `run.tasks[].description`.

## Решения

- **Завершённые прогоны вытесняются сами.** Прогон, у которого все задачи `done` (с owner-приёмкой, если
  она нужна этапу) и нет активных попыток, сторож архивирует через `DELIVERY_AUTO_ARCHIVE_MS` (по
  умолчанию 6 ч, 0 — выключено) после последнего изменения; карточечный прогон — после доставки результата
  на доску (`cardRuns[...].deliveredAt`). Событие `run.archived` с `archiveReason: "auto: finished"`.
  Ручной `run archive` остаётся.
- **Старые попытки незакрытых прогонов уходят из состояния.** У задачи в горячем состоянии остаётся
  только последняя попытка; более ранние терминальные попытки (`lost`/`failed`/`rejected`/`cancelled`)
  старше `DELIVERY_ATTEMPT_EVICT_MS` (по умолчанию 24 ч) переносятся в `control_archived_attempts`
  (`id`, `run_id`, `task_id`, `value jsonb`, `archived_at`). Чтение `control attempt <id>` и метрики
  берут их оттуда.
- **Вместе с прогоном уходят его справочники.** `takeArchivedRuns` выносит в запись
  `control_archived_runs` также `delivery.acceptances`, `mainChecks.profiles/merges/checks`,
  `cardRuns` и `boardRepairs` этого прогона.
- **Зеркало досок — отдельная таблица.** `control_board_projects(project_id text PRIMARY KEY, value jsonb,
  polled_at timestamptz)`; `BoardWatch` пишет туда без транзакции состояния, `operator-queue` и
  `board-repair` читают оттуда. В состоянии зеркала нет; миграция переносит `boardCards` при старте.
- **Пульс не переписывает состояние.** `lastSeen` воркера и `lastHeartbeatAt` попытки хранятся в
  `control_leases(kind, id, last_seen, expires_at)` (UPSERT без замка состояния); heartbeat берёт
  мутацию состояния только когда что-то меняется по существу: отмена, draining, продление `expiresAt`,
  когда до него меньше 60 с, первая фиксация диска. Проверка аренды (`refresh`, `heartbeatFenced`)
  читает время из `control_leases`.
- **План — по ссылке.** `run.plan` хранится в `control_run_plans(manifest_hash PRIMARY KEY, value jsonb)`,
  в состоянии остаётся `manifestHash`; `run.tasks[].description` — источник описания.
- **Видно, где время.** `coordinator.mutateMs` делится на `lockWaitMs` и `workMs` (p50/p95 за 60 с),
  добавляется `mutationsPerMinute` по источникам (`heartbeat`, `next`, `board`, `refresh`, `api`);
  чтение строки не делает `octet_length(value::text)`, размер берётся из сериализации, уже сделанной
  при записи.

## Общий контракт

- Таблицы: `control_archived_attempts`, `control_board_projects`, `control_leases`, `control_run_plans`
  (создаются в `Store.init`, `IF NOT EXISTS`). Версия состояния 6, миграция в `Store.init` переносит
  `boardCards`, `run.plan`, `lastSeen`/`lastHeartbeatAt` и старые попытки.
- Переменные: `DELIVERY_AUTO_ARCHIVE_MS` (мс, по умолчанию 21600000, `0` — выключено, минимум 600000),
  `DELIVERY_ATTEMPT_EVICT_MS` (мс, по умолчанию 86400000, минимум 3600000).
- `/healthz` и `GET /v1/status` → `coordinator: {stateBytes, mutateMs:{p50,p95}, lockWaitMs:{p50,p95},
  workMs:{p50,p95}, mutationsPerMinute: Record<string, number>, poolWaiting}`; старые поля без изменений.
- `GET /v1/status` сохраняет форму: `boardCards`, `run.plan`, `worker.lastSeen`, `attempt.lastHeartbeatAt`
  собираются из таблиц при чтении (`publicState`), потребители (`control status`, ассистент доски,
  Kanban) не меняются.

## Задачи интегратора (Claude, вне манифеста)

- Копия плана в `docs/plans/` delivery-control до старта.
- Задачи идут цепочкой B01 → B02 → B03 → B04 → B05: все правят `Store.init`/миграцию v6 и `src/server.ts`,
  параллельно интегратор отклонил бы их по конфликту `apply`. Выкат — один раз после B05.
- До выката: бэкап базы координатора (`scripts/backup-host.sh`), замер `control status | head -2`.
- После приёмки: `sislexa-coordinator-deploy` (миграция v6 при старте), релиз воркера на машины
  (`sislexa-worker-rollout`), проверка: `stateBytes` < 300 000 при текущей нагрузке, `mutateMs.p95` < 500 мс,
  `poolWaiting` 0, `curl -w %{time_total} /healthz` < 0,5 с; `deployment-profiles-v*` и `card-*`
  уходят без ручного `run archive`.

| B01 | delivery-control | — | Board mirror out of the hot state, per docs/plans/delivery-state-size-v2.md «Решения» and «Общий контракт» (copy of the plan is in this repository): `Store.init` creates `control_board_projects(project_id text PRIMARY KEY, value jsonb NOT NULL, polled_at timestamptz NOT NULL)`; `BoardWatch.poll` in `src/board-watch.ts` writes each project snapshot there with a plain UPSERT (no `store.mutate`) and removes rows of projects that left the projects file; `applyBoardSnapshot` keeps its failure/stuck logic but takes and returns the stored project; `src/operator-queue.ts` and `src/board-repair.ts` read board projects from the table (pass them in, no state field); `publicState` keeps the `boardCards` shape for `GET /v1/status` by loading the table; the state migration moves an existing `boardCards` map into the table and deletes it from the state (this task introduces state version 6; later tasks of this run extend the same v6 migration); tests: poll writes rows without a state mutation, operator queue sees stuck cards from the table, migration of a v5 fixture with two projects, status shape unchanged; docs/board-watch.md (or the existing board doc). Gate: `npm run gate:task -- --base <sha>`. |
| B02 | delivery-control | B01 | Automatic archive of finished runs and eviction of run side tables, per docs/plans/delivery-state-size-v2.md «Решения» and «Общий контракт» (copy of the plan is in this repository): a sweep in `src/main.ts` (inside the existing refresh mutation) archives runs whose tasks are all `done` (owner acceptance recorded where the stage requires it), with no running/submitted attempts, idle for `DELIVERY_AUTO_ARCHIVE_MS` (default 21600000, `0` disables, floor 600000) — card runs once `cardRuns[*].deliveredAt` is set — like `archiveRun` with reason `auto: finished`; `takeArchivedRuns` in `src/model.ts` also moves the run's `delivery.acceptances`, `mainChecks` profiles/merges/checks, `cardRuns` and `boardRepairs` entries into the `control_archived_runs` value and removes them from the state; terminal attempts that are not the task's current attempt and finished more than `DELIVERY_ATTEMPT_EVICT_MS` ago (default 86400000, floor 3600000) move to a new `control_archived_attempts(id text PRIMARY KEY, run_id text, task_id text, archived_at timestamptz DEFAULT now(), value jsonb)` table; `control attempt` and run metrics read evicted attempts from that table; tests (injected clock): auto-archive timing, failed task keeps the run, card run after delivery, side tables leave with the run, old attempt evicted and still counted in metrics; docs/control-service-release.md. Gate: `npm run gate:task -- --base <sha>`. |
| B03 | delivery-control | B02 | Heartbeats without full-state writes, per docs/plans/delivery-state-size-v2.md «Решения» and «Общий контракт» (copy of the plan is in this repository): `Store.init` creates `control_leases(kind text NOT NULL, id text NOT NULL, last_seen bigint NOT NULL, expires_at bigint, PRIMARY KEY(kind,id))`; `POST /v1/workers/heartbeat` in `src/server.ts` authenticates the worker/attempt from a lock-free `store.read()` and records `lastSeen`/`lastHeartbeatAt` with an UPSERT into `control_leases`, taking `store.mutate` only when the response or the state must change (cancellation, draining, disk report, attempt `expiresAt` closer than 60 s, stale assignment); `refresh`/`loseAttempt`/`heartbeatFenced` and `POST /v1/workers/next` use the lease table times (merged into the state copy inside the mutation) so lease expiry semantics stay exactly as today (`attemptLeaseMs`, `attemptLostMs`); `publicState` still reports `worker.lastSeen` and `attempt.lastHeartbeatAt`; tests: a heartbeat does not change `control_state`, a silent worker still loses its attempt after `attemptLostMs`, cancellation still reaches the worker, extension near expiry mutates once; docs/control-service-release.md. Gate: `npm run gate:task -- --base <sha>`. |
| B04 | delivery-control | B03 | Run plan by reference, per docs/plans/delivery-state-size-v2.md «Решения» and «Общий контракт» (copy of the plan is in this repository): `Store.init` creates `control_run_plans(manifest_hash text PRIMARY KEY, value jsonb NOT NULL)`; run creation (`POST /v1/admin/runs`) stores the validated plan there and keeps only `manifestHash` on the run; every reader of `run.plan` in `src/` (dispatch, verification, evidence planning, continuation, metrics) gets the plan through one helper that loads it once per mutation/request; the state migration moves existing `run.plan` objects into the table; `publicState`/`GET /v1/status` keeps `run.plan` in its output; archived runs keep their plan in `control_archived_runs` as today; tests: run creation, dispatch and run verification with the plan outside the state, migration of a v5 fixture, status shape unchanged. Gate: `npm run gate:task -- --base <sha>`. |
| B05 | delivery-control | B04 | Mutation latency split and rate, per docs/plans/delivery-state-size-v2.md «Решения» and «Общий контракт» (copy of the plan is in this repository): `Store.mutate` in `src/store.ts` records lock wait (connect + `SELECT … FOR UPDATE`) and work time separately and accepts a `source` label (`heartbeat`, `next`, `board`, `refresh`, `api`; callers in `src/server.ts` and `src/main.ts` pass it); `coordinatorStats` adds `lockWaitMs`, `workMs` (p50/p95 over 60 s) and `mutationsPerMinute` by source; the row read drops `octet_length(value::text)` and `stateBytes` comes from the serialization already done for the write (or the last known value when nothing changed); `scripts/control.mjs status` prints the extra fields on the `Coordinator` line and warns when `stateBytes > 524288`, `p95 > 1000` or `poolWaiting > 0` for the sample; tests: stats split with a fake clock, rate by source, status output; docs/control-service-release.md. Gate: `npm run gate:task -- --base <sha>`. |
