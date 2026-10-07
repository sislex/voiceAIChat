# ops-hygiene-v1 — автоочистка серверов, контроль дисков и меньше впустую потраченных попыток

Ран `ops-hygiene-v1`. Ветка задач — `dev`.

Владелец, 2026-10-07: по итогам дня оператора сделать задачами для воркеров пункты 1–6 и 8 списка
улучшений.

## Что видно сейчас (2026-10-07)

- За день вручную освобождено ~30 ГБ на четырёх машинах. Прод после каждого выпуска падает ниже 10 ГБ:
  остаются образы прошлых выпусков (9 образов, 3,7 ГБ). На хосте координатора лежали 21 версия
  координатора, 61 дамп базы и резервные копии LLM Runner (8,1 ГБ) — до 5,5 ГБ свободных из 40.
- Свободное место проверяет только фоновый цикл в сессии оператора (`sislexa-disk-check`); без сессии
  контроля нет.
- Причины сбоев попыток определяются по свободному тексту `summary`. 132 из 135 событий
  `attempt.failed` за 01–06.10 не имеют кода; в «гейт» попадают отчёты модели, где просто встречается
  слово gate. Из «прочего» за 06.10: 9 × `target_branch_base_changed` (B02/B03 task-gate-scope-v1 и C02
  release-disk-preflight-v1 по 3 раза), `This operation was aborted`, `api_400`.
- `target_branch_base_changed` (воркер, `src/worker/attempt.ts`): настроенная база задачи больше не в
  истории целевой ветки (ветку `dev` пересоздали после выпуска) — попытка падает до начала работы, а
  повтор с той же настройкой падает снова, пока оператор не перенастроит задачу.
- Воркеры простаивают, когда очередная задача ждёт шага оператора (`execution_not_configured`,
  `operator_triage_required`, сдана и ждёт приёмки); в статусе это не выделено.
- Выкат воркера клонирует delivery-control с GitHub без тайм-аута: 2026-10-07 клон завис на 10 минут
  (`early EOF`). Скрипт выката живёт только у оператора (`~/.local/bin/sislexa-worker-rollout`).
- Закрыть прогон нельзя — только пауза; 9 старых прогонов висят в статусе.
- Второй слот M1 выключен с 2026-10-04 (сбои Chromium и нехватка памяти при двух слотах) — до перевода
  браузера на `chromium-broker`.

## Решения

1. Очистку делает тот, кто создаёт мусор: Kanban — после деплоя прода, выкат координатора — свои версии,
   резервное копирование координатора — свои дампы, LLM Runner — свои резервные копии. Всегда остаётся
   то, на что есть ссылка, и одна предыдущая версия для отката.
2. Свободное место машин воркеров и хоста координатора видит координатор: телеметрия в heartbeat, порог
   на машину, событие и строка в статусе. Диск прода проверяет Kanban (у него уже есть команда замера).
3. Причина сбоя — машинный код, а не текст: воркер и координатор пишут `failure.code` и детали; текст
   модели остаётся описанием.
4. Попытка, которая не начала работу из-за пересозданной целевой ветки, начинает с текущей головы
   ветки, а не падает.
5. Задачи delivery-control этапа 1 запускаются после выката воркера с B01, чтобы параллельные слияния в
   `dev` не роняли соседние задачи.

## Шаги оператора

- После приёмки B01 — выкат воркера и координатора с B01, затем настройка задач этапа 1.
- **O1, второй слот M1 (пункт 8).** Во время этапа 1 включить второй слот (`sislexa-m1-slots2`) и
  пропустить через M1 не меньше 6 попыток, из них хотя бы 2 с браузерным гейтом. Оставить два слота,
  если нет сбоев `host_resource`, падений Chromium и доля успешных попыток M1 не ниже, чем у одного слота
  за 04–06.10 (24%); иначе вернуть один слот (`sislexa-m1-slots1`) и записать причину заметкой.
  Результат — запись в журнал метрик (`sislexa-delivery-metrics --note`).

| B01 | delivery-control | — | Start from the current target branch head when the configured base was rewritten. Today `src/worker/attempt.ts` throws `target_branch_base_changed` during checkout when the task's configured `baseSha` is no longer an ancestor of the fetched target branch head (the `dev` branch is recreated after a release); the attempt fails before any work and every retry with the same configuration fails again (9 wasted attempts on 2026-10-06). Change: in that case use the fetched head as the attempt base — check it out, record `{configuredBaseSha, baseSha, reason:'target_branch_rewritten'}` in the assignment, the workspace report and the attempt progress — and continue normally; the coordinator must accept the submission against the reported base when that base is the target branch head at checkout time (verify it is a commit of the target branch; keep rejecting an arbitrary base) and must use it for review, evidence and merge; record the substitution in task metrics. Keep the current behaviour (no substitution) for `main-check` tasks. Tests: rewritten branch starts from the head and submits; normal moved branch keeps the configured base; a forged base in the submission is rejected; main-check unchanged. Update docs (worker attempt lifecycle). Gate: typecheck, build, test:candidate. |
| B02 | Kanban | — | Production disk hygiene in the Kanban release manager. (1) After a successful production deploy remove Docker images on the production host that no container uses, except the images of the previous successful release of each service (needed for rollback); remove the Docker build cache as today; write what was removed and the freed space into the deploy step log; a cleanup failure never fails the deploy. (2) After a successful deploy also prune release backup directories under `/var/backups/voicechat` written by the release flow, keeping the newest 3. (3) Every 30 minutes measure the production free space with the existing disk command and, when it is below `RELEASE_MIN_FREE_BYTES` (10 GiB, from `@voicechat/shared`), raise one project notification (repeat at most every 6 hours while low, clear when back above). Tests for keeping in-use and previous-release images, the backup retention, the non-fatal cleanup and the notification throttling. Update docs/kb. |
| B03 | llm-runner | — | Backup retention for LLM Runner production operations. Scripts that create directories under `/var/backups/llm-runner/` (release, upgrade and cutover helpers, see docs/operations.md) leave them forever; on the coordinator host they reached 8.1 GiB. Add `scripts/prune-backups.sh` (dry run by default, `--apply` to delete) that keeps the newest 3 backup directories plus any directory listed in `/etc/llm-runner/keep-backups` (one name per line) and never touches anything outside `/var/backups/llm-runner`; call it with `--apply` at the end of every successful release/upgrade script; tests with a temporary backup root (keep count, keep list, dry run, path safety). Update docs/operations.md. |
| C01 | delivery-control | B01 | Machine-readable failure codes for attempts. Today the reason of a failed attempt is only free text (`summary`), so 132 of 135 failures in the event stream carry no code and reports guess by substring. Add `failure: { code, detail? }` to `attempt.failed` and `attempt.lost` events, to the attempt record and to task metrics `attemptDetails`. Codes: `gate_failed` (detail: gate index, command, exit code), `prepare_failed` (step, exit code), `checkout_failed` (stage), `secret_review`, `out_of_scope_change`, `host_resource`, `model_error` (detail: http status or provider error, e.g. `api_400`), `model_timeout` (aborted or over the time limit, e.g. `This operation was aborted`), `model_blocked` (the model finished without a candidate and declared itself blocked), `target_branch_rewritten` (if substitution was impossible), `cancelled`, `lost`, `other` (keep the raw message in detail). Set the code where the failure is raised, not by parsing text afterwards. `control metrics` and status summarise failures by code. Tests for each code path that exists today and for the metrics summary. Update docs. Gate: typecheck, build, test:candidate. |
| C02 | delivery-control | B01 | Archive runs. Add `POST /v1/admin/runs/archive {runId, reason}` (operator token) and `control run archive ID --reason TEXT --journal FILE`: allowed only for a paused run with no running or submitted attempts; archived runs keep all history, evidence and metrics, never dispatch, cannot be resumed, and are hidden from `control status` and the default status JSON (add `--all` / `?all=1` to include them, with `archived: true, archivedAt, archiveReason`); the board sync marks their open cards as closed with the reason. Tests for the guards, hiding, `--all`, board sync and that dispatch ignores archived runs. Update docs. Gate: typecheck, build, test:candidate. |
| C03 | delivery-control | B01 | Show work that waits for the operator. Status gets `operatorQueue`: every task that cannot progress without an operator — `blocked` with `execution_not_configured`, `failed` with `operator_triage_required`, `submitted` awaiting acceptance, stage acceptance pending — with run, task, reason and waiting time; `control status` prints it first as «Ждёт оператора» together with the number of idle workers. Emit `operator.attention` once when such an item appears while at least one worker is idle and again if it waits longer than 30 minutes; board sync labels the card «ждёт оператора». Tests for each reason, the idle-worker condition, the 30-minute repeat and the CLI output. Update docs. Gate: typecheck, build, test:candidate. |
| C04 | delivery-control | B01 | Disk telemetry for worker machines and the coordinator host. Workers report free and total bytes of the volume holding the worker root (`statfs`) in their heartbeat at most once a minute; the coordinator measures its own data volume. Each machine gets `diskMinFreeBytes` (default 10 GiB, coordinator default 5 GiB, settable through the existing machine capabilities admin route). Status shows free space per machine; when it drops below the minimum emit `machine.disk_low` (repeat at most every 6 hours while low, `machine.disk_ok` when recovered) and stop dispatching new attempts to that machine until it recovers (running attempts continue); `control status` marks the machine «мало места». Tests for heartbeat parsing, threshold, event throttling, dispatch pause and recovery. Update docs. Gate: typecheck, build, test:candidate. |
| C05 | delivery-control | B01 | Worker release installation script in the repository. Move the operator's rollout procedure into `scripts/worker-release.mjs`: `install SHA` builds `~/.local/share/sislexa/delivery-worker-releases/<SHA>` from a local bare mirror (`~/.local/share/sislexa/delivery-worker-releases/.mirror.git`, created or fetched first; every git network command runs with a 120 s timeout and up to 3 retries, then falls back to a fresh clone), checks out the exact SHA, verifies `git rev-parse HEAD`, runs `npm ci` and `npm run build` and checks `dist/src/worker/supervisor.js`; `switch SHA` updates the LaunchAgent plist (ProgramArguments[1], WorkingDirectory) with a backup and reloads it with launchctl; `prune SHA` keeps `<SHA>`, the release currently referenced by the plist and the newest other release, deleting the rest. Each subcommand prints one JSON line, exits non-zero on failure and its command line stays under 1000 characters so it can run through `control inbox shell`. Tests with a temporary home and a local origin (install, retry on a hanging fetch via an injected timeout, verification failure, prune keep set). Update docs (worker rollout). Gate: typecheck, build, test:candidate. |
| C06 | delivery-control | B01 | Coordinator host retention. (1) The coordinator release procedure (scripts used to install a release under `/opt/delivery-control/releases`) removes old releases after a successful switch and health check, keeping the release `current` points to, the two newest others and every release referenced by a systemd unit or drop-in of `delivery-control*` services (parse `systemctl cat`); it also removes its own leftovers (`operator-*.tar` archives, `*-prep` directories) older than the switch. (2) `scripts/backup-host.sh` keeps the newest 10 database dumps with their manifests in its backup directory. Dry-run output lists what would be removed. Tests with a temporary root (keep set including a unit-referenced release, leftovers, dump retention). Update docs (operations). Gate: typecheck, build, test:candidate. |
