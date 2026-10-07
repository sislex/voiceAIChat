# deps-speed-v1 — установка зависимостей не ломает и не тормозит задачи

Ран `deps-speed-v1`. Ветка задач — `dev`.

Владелец, 2026-10-07: оформить отдельным прогоном три улучшения подготовки зависимостей.

## Что видно сейчас (2026-10-07)

- Слияние в `dev` Make поменяло `package.json` без проверки чистой установки: `npm ci` на `dev` падал,
  две задачи (make-project-mode-v1 C02, make-project-mode-v2 B02) сгорели на `prepare_failed` и ждали
  оператора. Ошибка была в базе, а не в задачах.
- Кэш зависимостей (`src/worker/warm-workspace.ts`, ключ — lock, корневой и workspace-манифесты, `.npmrc`,
  локальные архивы, Node): из 40 последних подготовок 11 попаданий (медиана 8 с), 24 промаха `not_found`
  (медиана 13 с, максимум 78 с), 1 `invalid_entry`. Промах почти всегда — первая задача после слияния,
  изменившего lock или манифест.
- 4 подготовки: `hit` для `npm ci`, затем `bypass: unsupported_command` для следующего шага подготовки
  (31–32 с каждый раз): кэшируется только ровно `npm ci`.

## Решения

1. Голова целевой ветки, на которой `npm ci` не проходит, — не провал задачи: выдача задач этого
   репозитория останавливается, в очередь оператора ставится одна запись про репозиторий.
2. Кэш прогревается заранее: после движения головы целевой ветки свободный воркер на каждой машине
   собирает запись для новой головы.
3. Шаги подготовки после `npm ci` кэшируются по объявленным входам и выходам.

| B01 | delivery-control | — | Install health of the target head. (1) The integrator role (and the operator acceptance helper path it shares) refuses to merge a candidate whose diff touches `package.json`, `package-lock.json`, `npm-shrinkwrap.json` or `.npmrc` unless a clean `npm ci --ignore-scripts` on the merged tree in a fresh directory exits 0; the result is recorded in the integration report. (2) When an attempt fails in `prepare` at the `npm ci` step and a clean `npm ci` of the bare target head (no candidate changes) also fails on that worker, the coordinator marks the repository target `install_broken` (new failure code `target_install_broken` on the attempt, the attempt does not count against the task's limit), stops dispatching tasks of that repository and target, and adds one `operatorQueue` entry `{repository, targetBranch, headSha, reason: 'target_install_broken'}`; dispatch resumes automatically when the target head moves and a probe `npm ci` passes. Tests: refused merge with broken lock, accepted merge with clean install, attempt not counted, dispatch paused and resumed on head move, single queue entry for several tasks. Update docs (attempt failures, operator queue). Gate: `npm run gate:task -- --base <sha>`. |
| B02 | delivery-control | — | Prewarm the dependency cache. When the head of a target branch with active runs moves (merge observed by the coordinator), the coordinator issues a low-priority `prewarm` job per machine for each repository whose lock, root or workspace manifests or `.npmrc` changed between the old and new head; an idle worker on that machine checks out the new head from the warm-cache mirror, runs `prepareWithCache` (`npm ci` miss path) and stores the entry; a task dispatch always preempts a prewarm job (prewarm is cancelled, never blocks a slot needed by a task); at most one prewarm per repository per machine at a time; reuse existing prune limits. Report prewarm results in metrics (`dependencyCache` gains `prewarmed: true` on a hit created by prewarm). Tests: job issued only on dependency changes, preemption by a task, dedupe, metrics flag. Update docs (warm worker attempts). Gate: `npm run gate:task -- --base <sha>`. |
| B03 | delivery-control | — | Cache prepare steps after `npm ci`. Extend `execution.prepare` entries with an optional cache declaration `{argv, cache: {inputs: string[], outputs: string[]}}` (repository-relative globs, outputs inside the checkout, no `..`, no symlinks out): the key is the `npm ci` cache key plus the git tree hashes of the input paths and the argv; on hit the outputs are restored and verified by digest like `warm-workspace.ts`, on miss the step runs and the outputs are stored; steps without a declaration keep today's behaviour (`bypass: unsupported_command`, renamed in reports to `uncached_step`). Tests: hit restores outputs, input change misses, invalid globs rejected, corrupted entry falls back to running the step. Update docs and the plan compiler documentation for the new field. Gate: `npm run gate:task -- --base <sha>`. |
