# delivery-state-size-v1 — горячее состояние координатора не должно расти

Ран `delivery-state-size-v1`. Ветка задач — `dev`. Репозиторий — delivery-control.

## Что случилось (2026-10-11)

Оба прогона (`make-stand-inspector-v1`, `delivery-failover-v1`) потеряли все попытки (`lost` ×3 на задачу)
при живых воркерах и исправной сети. Координатор отвечал 7–10 с даже на `/healthz`; воркеры получали
TIMEOUT/503 на heartbeat и теряли аренду 120 с. В журнале — `board_sync_failed: timeout exceeded when trying
to connect`, `sweep_failed`, `request_failure internal`.

Механизм: `Store.mutate` (`src/store.ts`) на каждое изменение читает `control_state` целиком `FOR UPDATE`,
валидирует, дважды делает `JSON.stringify` и пишет состояние обратно. Состояние выросло до 3 МБ, из них
2,5 МБ — `attempts[].integration.gateLog` 50 попыток 16 давно завершённых, но не архивированных прогонов.
Мутации сериализуются замком строки, пул `pg` (`max: 6`, `connectionTimeoutMillis: 5000`) исчерпывается,
и падают уже все запросы, включая `/healthz` (`SELECT 1` ждёт соединение). Хост координатора — 2 CPU.
Попутно: `control_commands` (идемпотентность ответов) никем не чистится — 773 МБ, ~1 млн строк,
+30–100 тыс. строк в день.

Оперативное лечение — архив 16 прогонов (`control run archive`); попытки уходят из состояния через час.

## Решения

- **Логи гейта интеграции — артефакт попытки, не состояние.** `attempt.integration.gateLog` хранится как
  артефакт попытки (`delivery_artifacts`, `name: integration-gate.log`, `kind: log`), в состоянии остаются
  `gateLogSha256`, `gateLogBytes` и имя артефакта. Чтение — существующий `GET /v1/evidence/:id/chunks/:i`
  / `control artifact get`. Приёмка (`auto-accept`, `owner-stage-acceptance`) берёт лог из артефакта.
  Миграция состояния v5 переносит уже сохранённые `gateLog` в артефакты при старте.
- **Кэш команд ограничен по времени.** `control_commands` получает индекс по `created_at`; сторож
  удаляет строки старше `DELIVERY_COMMAND_RETENTION_MS` (по умолчанию 24 ч) пакетами ≤ 5000 строк в тик
  (5 с), отдельным соединением, без транзакции состояния. Повторы запросов воркеров укладываются в минуты,
  сутки — с запасом.
- **Мутация дешевле, пул с запасом, задержка наблюдаема.** Второй `JSON.stringify` на сравнение заменяется
  флагом/хэшем изменения; пул `max: 12`, `connectionTimeoutMillis: 15000`; `/healthz` и `GET /v1/status`
  публикуют `coordinator: {stateBytes, mutateMs: {p50, p95}, poolWaiting}` за последние 60 с; `control status`
  показывает строку координатора и предупреждает, когда `stateBytes > 1 МиБ` или `p95 > 1000 мс`.
  Сторож `refresh` пропускает тик, если предыдущая мутация ещё идёт (уже так), и дополнительно не
  запускается чаще, чем раз в 5 с после завершения предыдущей.

## Общий контракт

- `attempt.integration`: `gateLog` удаляется из состояния; добавляются `gateLogArtifact: string` (имя
  артефакта), `gateLogSha256: string`, `gateLogBytes: number`. Версия состояния 5, миграция в `Store.init`.
- `GET /v1/status` → `coordinator: {stateBytes:number, mutateMs:{p50:number,p95:number}, poolWaiting:number}`;
  `/healthz` → те же поля в `coordinator`.
- Переменная `DELIVERY_COMMAND_RETENTION_MS` (мс, по умолчанию 86400000, минимум 600000).

## Задачи интегратора (Claude, вне манифеста)

- Копия плана в `docs/plans/` delivery-control до старта.
- После приёмки: `sislexa-coordinator-deploy` (миграция v5 при старте, проверить `/healthz` и `stateBytes`),
  релиз воркера на обе машины (`sislexa-worker-rollout`), проверка: `curl -w %{time_total} /healthz` < 0,5 с
  под шестью одновременными попытками; `control_commands` уменьшается до суток истории.

| B01 | delivery-control | — | Integration gate log as an attempt artifact, per docs/plans/delivery-state-size-v1.md «Решения» and «Общий контракт» (copy of the plan is in this repository): the integration report route in `src/server.ts` stores `gateLog` through the attempt artifact store (`src/artifacts.ts`, name `integration-gate.log`, kind `log`, secret review as today) and keeps only `gateLogArtifact`, `gateLogSha256`, `gateLogBytes` in `attempt.integration`; state version 5 with a `Store.init` migration that moves existing `gateLog` strings into artifacts and drops them from the state; `src/owner-stage-acceptance.ts`/`src/worker/auto-accept.ts` read the log from the artifact when they need its content; `control attempt` output shows the artifact name and size; tests: report → artifact + slim state, migration of a v4 fixture with two logged attempts, acceptance reads the artifact; docs/candidate-integration.md and docs/artifacts.md. Gate: `npm run gate:task -- --base <sha>`. |
| B02 | delivery-control | — | Idempotency cache retention, per docs/plans/delivery-state-size-v1.md «Решения» (copy of the plan is in this repository): `Store.init` adds `CREATE INDEX IF NOT EXISTS control_commands_created_at ON control_commands(created_at)`; `src/main.ts` gets a command sweep on its own pool connection (not inside `store.mutate`) that deletes rows older than `DELIVERY_COMMAND_RETENTION_MS` (default 86400000, floor 600000) in batches of at most 5000 per 5 s tick, logs `{"event":"command_sweep","deleted":n}` only when it deleted something and `command_sweep_failed` on error without stopping the timer; tests with an injected clock and a seeded table (old rows go, recent rows stay, batch limit respected); docs/control-service-release.md documents the variable and the sweep. Gate: `npm run gate:task -- --base <sha>`. |
| B03 | delivery-control | — | Cheaper mutations and observable coordinator latency, per docs/plans/delivery-state-size-v1.md «Решения» and «Общий контракт» (copy of the plan is in this repository): `Store.mutate` replaces the second full `JSON.stringify` comparison with a single serialization (serialize once after `fn`, compare its sha256 with the hash of the loaded row text or use a dirty flag returned by `fn`) and records per-mutation duration; `pg.Pool` `max: 12`, `connectionTimeoutMillis: 15000`; a rolling 60 s window gives `coordinator: {stateBytes, mutateMs:{p50,p95}, poolWaiting}` on `/healthz` and `GET /v1/status`; `scripts/control.mjs status` prints a `Coordinator` line and a warning when `stateBytes > 1048576` or `p95 > 1000`; the refresh sweep in `src/main.ts` waits at least 5 s after the previous sweep finished before the next one; tests: mutation stats, status payload, control output warning, sweep spacing with fake timers; docs/control-service-release.md. Gate: `npm run gate:task -- --base <sha>`. |
