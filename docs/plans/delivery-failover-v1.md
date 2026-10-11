# delivery-failover-v1 — запасной интегратор и перенос задач с пропавшего воркера

Ран `delivery-failover-v1`. Ветка задач — `dev`. Продолжение [integrator-reliability-v1](integrator-reliability-v1.md)
и [machine-recovery-v1](machine-recovery-v1.md).

## Цель владельца (2026-10-11)

- Интегратор должен быть и на M1: если этот Mac (M2) отключился, интеграция автоматически продолжается
  на запасном интеграторе.
- Если воркер не в сети больше 5 минут, его задача переходит другому доступному воркеру. Когда воркер
  возвращается, он просто берёт другую доступную задачу.
- Разработка — максимально быстро и параллельно.

## Что есть сейчас

- Воркер шлёт heartbeat каждые 15 с, аренда попытки 120 с (`/v1/workers/register` → `leaseSeconds: 120`).
  `refresh()` в `src/model.ts`: попытка без heartbeat → `lost` (`attempt.lost`, `failure.code = lost`),
  задача → `blocked`, если `attempts < retryLimit (3)`, иначе `failed`; воркер → `offline`. То есть
  потеря воркера **съедает попытку из лимита**, а `retryRequiresNewExecution` блокирует автоматический
  повтор с тем же профилем выполнения — задача ждёт оператора (`control task retry … --reuse-execution`).
  Пять минут — это порог сторожа живости слота (`worker_stalled`, выход 75), а не координатора.
- Слот воркера при обрыве связи входит в `connection_reconciling` (до 45 с), затем сессия/роль
  отвергаются по эпохе, слот останавливается и супервизор поднимает его заново — вернувшийся воркер
  регистрируется свежей сессией и берёт следующую задачу; незавершённая работа старой сессии огорожена
  эпохой и не принимается. Эта часть уже отвечает цели.
- Интегратор — обычный воркер с `role: "integrator"` и возможностью машины `integrator`
  (`docs/candidate-integration.md`). `claimIntegration` в `src/integration-queue.ts` учитывает только заявки,
  чья роль интегратора ещё жива (`expiresAt > now`, аренда роли 60 с), поэтому заявка пропавшего интегратора
  освобождается и её возьмёт другой интегратор. Координатор **уже допускает несколько интеграторов**; не
  проверено, что второй интегратор корректно подхватывает **наполовину выполненную** интеграцию (ветка
  публикации `<run>/<task>` уже создана, гейт шёл) и что `integrator/wait` справедлив между машинами.
- Второго интегратора нет: единственный — `alexeys-macbook-air-integrator` на M2 (`~/.config/sislexa/
  delivery-control/integrator/worker.json`, `integratorSlots: 3`, свои `github.token`/`operator.token` для
  публикации, LaunchAgent `com.sislexa.delivery-worker.alexeys-macbook-air-integrator`). Регистрация машины —
  `POST /v1/admin/machines {id, tokenHash, slots, capabilities, capacity}`; смена слотов —
  `/v1/admin/machines/slots`, где `capacity` обязана совпадать с `capacity` в `worker.json` машины
  (иначе `enrollment_capacity_mismatch`). Выкат релизов воркера на M1 идёт через operator inbox
  (`sislexa-worker-rollout`, шаги install/config/switch/prune), интегратор на M1 туда не включён.

## Решения

- **Потеря воркера — не вина задачи.** Попытка, потерянная из-за отсутствия heartbeat (не отмена, не
  `model_timeout`), переводит задачу в `ready` с тем же профилем выполнения и **не** расходует `retryLimit`:
  у задачи отдельный счётчик `lostAttempts` с лимитом `DELIVERY_LOST_ATTEMPT_LIMIT` (по умолчанию 3), после
  которого задача становится `failed` с `lost`. Порог потери — `DELIVERY_ATTEMPT_LOST_MS` (по умолчанию 5 мин):
  аренда попытки продлевается heartbeat как сейчас, но `lost` наступает только когда последний успешный
  heartbeat старше порога. Событие `attempt.lost` получает `redispatch: true` и `lostAttempts`.
- **Вернувшийся воркер не продолжает старую попытку.** Поведение огорожения сохраняется: старая сессия
  отвергается, слот перезапускается, частичные артефакты старой попытки остаются только как диагностика
  (`artifacts` попытки), новая попытка начинается с чистого чекаута.
- **Запасной интегратор — ещё одна машина-интегратор.** Координатор обслуживает несколько интеграторов;
  заявка берётся первой свободной машиной, заявка пропавшего интегратора освобождается по истечении аренды
  роли (60 с) и переходит другому. Подхват наполовину выполненной интеграции: интегратор, получивший заявку с
  уже существующей веткой публикации, пересоздаёт её от актуальной базы (force-update своей ветки
  `<run>/<task>`), а не падает; результат отчитывается как обычно.
- **Регистрация второго интегратора — документированная и проверяемая процедура**: скрипт готовит запрос
  регистрации и шаблон `worker.json` интегратора из существующего `worker.json` машины без секретов,
  проверяет конфигурацию по схеме; выкат релизов на удалённый интегратор идёт теми же шагами inbox, что и
  для воркера M1.

## Общий контракт

- `attempt.lost.data`: `{ attemptId, workerId, epoch, failure, redispatch: boolean, lostAttempts: number }`.
- Задача: `lostAttempts?: number` в состоянии и в `GET /v1/status` (`tasks[].lostAttempts`); `control status`
  и `control metrics` показывают потери отдельно от `failures`.
- Переменные координатора: `DELIVERY_ATTEMPT_LOST_MS` (мс, по умолчанию 300000, минимум 2×lease),
  `DELIVERY_LOST_ATTEMPT_LIMIT` (по умолчанию 3).
- `scripts/integrator-enrol.mjs` (см. B03): `prepare <worker.json> <integrator-id> --out-dir DIR` пишет
  `machine-request.json` (без секрета: `tokenHash` считается из токена, который оператор кладёт в `DIR/machine.token`
  с режимом 600) и `worker.json` интегратора (`role: integrator`, `integratorSlots`, `runId: "*"`, пути токенов
  публикации), `check <worker.json>` валидирует по схеме воркера; секреты скрипт никогда не печатает.

## Задачи интегратора (Claude, вне манифеста)

- Копия плана в `docs/plans/` репозитория delivery-control до старта.
- После приёмки: выкат координатора (`sislexa-coordinator-deploy`) и релиза воркера на обе машины;
  регистрация `alexrozhnov-macbook-air-02-integrator` (admin-токен), токены публикации на M1 (GitHub — от
  владельца; операторский — `control operator-token create`), LaunchAgent на M1 через inbox, включение M1
  в `sislexa-worker-rollout` для интегратора. Проверка: остановить интегратор на M2 во время интеграции —
  M1 доводит её; выключить воркер с запущенной попыткой на 6 минут — задача уходит другому воркеру без
  расхода `retryLimit`, вернувшийся воркер берёт новую задачу.

| B01 | delivery-control | — | Lost-worker redispatch without spending the retry budget, per docs/plans/delivery-failover-v1.md «Решения» and «Общий контракт» (copy of the plan is in this repository): in `src/model.ts` `refresh()` an attempt whose lease expired without cancellation or `deadline` becomes `lost` only when its last successful heartbeat is older than `DELIVERY_ATTEMPT_LOST_MS` (default 300000, floor 2× lease); the task returns to `ready` with the same execution profile (bypass `retryRequiresNewExecution` for this case), `task.lostAttempts` increments and the task fails with `lost` only when it reaches `DELIVERY_LOST_ATTEMPT_LIMIT` (default 3); `attempt.lost` carries `redispatch` and `lostAttempts`; `GET /v1/status` exposes `tasks[].lostAttempts`, `control status`/`control metrics` show losses separately from failures; cancellation and `model_timeout` keep today's behaviour; tests with an injected clock: lost after the threshold, redispatch to another waiting worker, budget untouched, limit reached, stale session of the returning worker rejected; docs/attempt-failures.md and docs/workers.md. Gate: `npm run gate:task -- --base <sha>`. |
| B02 | delivery-control | — | Integrator failover with a half-finished integration, per docs/plans/delivery-failover-v1.md «Решения» (copy of the plan is in this repository): (1) `src/integration-queue.ts`/`src/server.ts` — when an integrator role expires mid-integration its claim is released (`integration.claim_released` event) and the next waiting integrator on any machine receives it on `/v1/integrator/wait` within one wait cycle; (2) `src/worker/integrator.ts` — an integration whose publication branch `<run>/<task>` already exists on the remote (left by a previous integrator) is rebuilt from the current target head with a force-update of that branch, logged in the gate log, never failing on «branch exists»; (3) `integrator/wait` serves waiting integrators fairly across machines (oldest waiter first); tests: two integrator sessions on two machines, first session expires after claiming, second completes; existing-branch rebuild with a fake remote; docs/candidate-integration.md. Gate: `npm run gate:task -- --base <sha>`. |
| B03 | delivery-control | — | Second integrator machine tooling and docs, per docs/plans/delivery-failover-v1.md «Общий контракт» (copy of the plan is in this repository): `scripts/integrator-enrol.mjs` with `prepare` (writes `machine-request.json` for `POST /v1/admin/machines` with `capabilities: ["integrator"]`, `slots` equal to `integratorSlots`, capacity from the source worker.json, and a `worker.json` for the integrator derived from the machine's worker.json: `role: "integrator"`, `integratorSlots`, `runId: "*"`, `publication` token paths, `integrationGates` copied from a given reference worker.json, no secrets printed) and `check` (validates a worker.json with the worker config schema and reports which token files are missing or have wrong modes); a LaunchAgent plist template for `com.sislexa.delivery-worker.<machine>` pointing at an installed release; docs/machines.md gets «Second integrator on another machine» with the operator steps (enrol, tokens, plist, rollout through the operator inbox, verification); tests for `prepare`/`check` on fixtures. Gate: `npm run gate:task -- --base <sha>`. |
