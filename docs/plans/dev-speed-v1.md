# dev-speed-v1 — ускорение разработки: меньше ожидания оператора и простоев

Ран `dev-speed-v1`. Ветка задач — `dev`.

Владелец, 2026-10-07: сделать пункты 1–8 из предложений оператора по ускорению разработки.

## Что видно сейчас (2026-10-07)

- Модель занимает 5–15 минут на задачу (≈85% времени задачи); ручная интеграция оператора — медиана
  7,5 минуты на задачу плюс ожидание, пока оператор занят другим.
- Роль `integrator` есть, но привязана к одному прогону (`integrator_requires_single_run_slot` в
  `src/worker/config.ts`), и `autoAccept` по умолчанию выключен — в работе её нет.
- Выкат воркера 7db20d0 добавил `-P` в `codex exec`, который его не поддерживает: ~1,5 часа ни одна
  задача не запускала модель. Самопроверка запускает только `codex sandbox`.
- make-project-mode-v1 C01 был слишком велик: модель сдала половину (`model_blocked`), остаток оператор
  вынес в отдельный прогон руками.
- Задачи Make C02–C04 ждали реализацию ядра C01, хотя тесты Make идут на фейковом `MakeCore` из
  контрактов B01.
- Выпуск контрактов (архив Make contracts / Shared → закрепление в ядре → у потребителей) — ручная
  цепочка: за день дважды ломала `npm ci` у Make.

## Решения

1. Интегратор обслуживает все прогоны с `autoAccept`; новые прогоны создаются с `autoAccept: true`.
2. Выкат воркера проходит пробную задачу на одном слоте, прежде чем идти дальше.
3. Сданная частичная работа с зелёным гейтом принимается, остаток становится задачей-продолжением.
4. Зависимость может быть «по контракту»: задача стартует, когда зависимость сдана (кандидат), а не принята.
5. Выпуск контрактов — одна команда ядра с проверкой `npm ci` у потребителей.
6. Модель получает заранее собранный контекст задачи.
7. Слоты: оператор добавляет слот на маке (не задача воркеров).

| B01 | delivery-control | — | Integrator for all runs. Allow role `integrator` with `runId` any-run (drop `integrator_requires_single_run_slot` for that case; still exactly one slot); it claims integration jobs of every run whose plan has `autoAccept: true`, oldest submission first, one at a time per repository and target. Run import (`POST /v1/admin/runs`) defaults `autoAccept` to true for runs with a target branch unless the plan sets it to false; `control run auto-accept ID on|off` keeps working. The integrator refuses candidates that touch dependency manifests unless a clean `npm ci --ignore-scripts` of the merged tree passes (reuse the deps-speed-v1 B01 helper if present on the base, otherwise implement it here). Tests: any-run integrator claims jobs of two runs in order, per-repository exclusivity, default autoAccept on import, explicit false respected, manifest guard. Update docs (integrator, operator CLI). Gate: `npm run gate:task -- --base <sha>`. |
| B02 | delivery-control | — | Worker release canary. (1) Extend the worker sandbox self-test to run the exact `codex exec` argument list used for model invocations (same options builder as `src/worker/attempt.ts`, with `--help`-free dry invocation: an invalid model name or `-c model_provider` pointing to an unreachable local URL) and fail the start when codex rejects the arguments (exit 2 / `unexpected argument`), so an argv regression never reaches tasks. (2) Add `scripts/worker-canary.mjs`: given a worker release SHA, drains one slot, switches it to the release, dispatches a built-in canary run (one trivial task in a fixture repository on the coordinator, real model invocation with a tiny prompt and the real gate path) and reports pass/fail with timings; the operator rollout continues to other slots only on pass. Tests: argv rejection detected, valid argv passes, canary script state machine with a fake coordinator. Update docs (worker rollout). Gate: `npm run gate:task -- --base <sha>`. |
| B03 | delivery-control | — | Partial work and continuations. When an attempt ends `model_blocked` or `model_partial` with a non-empty patch and the supervisor gate passes, the coordinator keeps the candidate as `submitted_partial` with the model summary of what is missing; owner acceptance (and the integrator) may accept it with `continuation: {description}` which creates a new task `<id>-cont` in the same run and stage-plus-zero (same repository, execution copied, depends on the accepted task) instead of failing the task. Plan compiler: warn (in the compile output and `verify` response) about task descriptions longer than 1500 characters or naming more than one repository surface, as a hint to split. Tests: partial submit with green gate, continuation creation and dispatch, red gate still fails, compiler warnings. Update docs. Gate: `npm run gate:task -- --base <sha>`. |
| B04 | delivery-control | — | Contract dependencies and speculative start. Plan rows accept `deps` entries `B01~` (contract dependency): the task becomes ready when the dependency has a `submitted` candidate with a green gate, not only when accepted. When dispatched this way and the dependency is in the same repository, the attempt starts from the dependency candidate tree (base = target head plus the candidate patch, reported as base substitution `reason: 'speculative_dependency'`); in another repository it starts from the target head. If the dependency candidate is later rejected or replaced, dependent attempts based on it are cancelled and requeued; accepted ones rebase normally at integration (`needs_rebase`). Tests: ready on submitted dependency, speculative base for same repository, cancellation on rejection, plain deps unchanged. Update the plan format docs. Gate: `npm run gate:task -- --base <sha>`. |
| B05 | delivery-control | — | Prepared model context. Before the first model invocation the worker runs, inside the attempt checkout and with the task-boundary sandbox, the repository's context command when present (`npm run -s kb:context -- "<task title>"`, bounded to 20 s and 16 KB of output; skipped when the script is absent) and prepends its output plus the list of `allowedPaths` files changed in the last 20 commits touching those paths to the prompt under a «Prepared context» heading. Record the time spent and the context size in attempt metrics (`contextMs`, `contextBytes`). Tests: context included when the script exists, skipped when absent, timeout and size bounds, metrics recorded. Update docs. Gate: `npm run gate:task -- --base <sha>`. |
| B06 | Core | — | One-command contract release. `node scripts/contracts-release.mjs <package> --version x.y.z --source <owner-repo-path> --commit <sha> [--consumers make,kanban,core-ui,...]` for owner contract packages (`@voicechat/make-contracts` and similar, packed with `npm pack -w` from a clean detached checkout of the commit) and for Shared (`build:core-contracts`): vendors the archive into Core with sha12 asset name, updates every Core `package.json` reference, `package-lock.json` (`npm install --package-lock-only`), `dependency-snapshots.json` and `vendor/owner-artifacts.json` (sha256, sha512 integrity, commit, provenance); for each listed consumer checkout it vendors the archive, updates references and exact peer pins, then runs a clean `npm ci --ignore-scripts` and reports per consumer pass/fail with the conflicting peer chain on failure; never pushes. Tests with fixture repositories: Core pin, consumer pin, peer conflict reported, dirty source refused. Update docs/kb (shared, deploy). Gate: `npm run gate:task -- --base <sha>`. |
