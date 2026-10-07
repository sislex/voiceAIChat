# delivery-autonomy-v1 — задачи проходят без ручной работы оператора

Ран `delivery-autonomy-v1`. Ветка задач — `dev`.

Владелец, 2026-10-07: оформить прогоном улучшения 1–4 по итогам дня оператора.

## Что видно сейчас (2026-10-07)

- Почти каждую сданную задачу оператор интегрирует руками: скачивает патч, накладывает на текущую
  `dev`, гоняет полный гейт вне песочницы, открывает PR, сливает, пишет доказательства и owner-reduced
  приёмку. Медиана от сдачи до приёмки — 7,5 минуты, задачи ждут, пока оператор занят.
- Модели в песочнице не могут запускать подпроцессы (`spawnSync EPERM`): тесты, порождающие процессы,
  не идут, модель пишет вслепую и помечает готовую работу `model_blocked` (Image Studio B10).
- Задачи одного репозитория, зависящие друг от друга, стартуют на базе, настроенной до слияния
  предыдущей (Core UI B02/B03 в kb-service-v3): оператор отменял попытку и переносил базу вручную.
- Задачи одного репозитория с пересекающимися `allowedPaths` идут строго по очереди (`parallelScope`
  в `src/model.ts`): шесть задач ops-hygiene-v1 шли 2–3 часа; конфликты при интеграции почти всегда
  были только в импортах.

## Решения

1. Интеграцию выполняет роль `integrator` у воркера на машине владельца (у неё есть git и GitHub);
   координатор лишь поручает её и принимает результат. Песочница модели не меняет политику
   секретов и путей.
2. Задача, сданная с зелёным `gate:task` и чистой проверкой на секреты, принимается интегратором без
   оператора; при конфликте или красном гейте — новая попытка на свежей базе, без участия оператора;
   после двух неудач — очередь оператора (`operatorQueue`).
3. База задачи берётся в момент выдачи — текущая голова целевой ветки.

| B01 | delivery-control | — | Child processes inside the model sandbox and a separate «checks unavailable» outcome (#244). (1) The codex task sandbox (`taskPermissionOptions` / `-s workspace-write` in `src/worker/attempt.ts` and the task-boundary profile) must allow the model to spawn and wait for child processes inside the attempt checkout (node, npm, npx, git, vitest workers) with the same filesystem and network rules as now; add a worker self-test that runs `node -e` and `npx vitest --version` through the sandbox and fails the worker start if child processes are denied. (2) When the model reports that it could not run checks because of the environment, the attempt is not `model_blocked`: add failure code `checks_unavailable`, keep the candidate patch, run the supervisor gate on it and submit when the gate passes. Tests for the sandbox profile arguments, the self-test and both outcomes. Update docs (workers, attempt failures). Gate: `npm run gate:task -- --base <sha>`. |
| B02 | delivery-control | — | Base at dispatch. A task gets `execution.baseAtDispatch` (default true for runs with a target branch): when an attempt is dispatched the worker fetches the target branch and starts from its current head instead of the configured `baseSha` whenever the configured base is an ancestor of that head (dependencies merged after configuration become visible); report it like the existing base substitution (`reason: 'base_at_dispatch'`), and make the coordinator accept it under the same verification as `target_branch_rewritten` (commissioned verifier or `DELIVERY_TRUST_WORKER_TARGET_HEAD=1`). The `gate:task --base` argument follows the substituted base. Keep `main-check` tasks on the configured base. Tests: dependent task starts on the head that contains its merged dependency; disabled flag keeps the configured base; verification rules unchanged. Update docs. Gate: `npm run gate:task -- --base <sha>`. |
| B03 | delivery-control | — | Parallel tasks in one repository with overlapping paths. Add `execution.parallelScope: 'merge'` (in addition to `true`/`false`): tasks in this mode may run in parallel even when their `allowedPaths` overlap; integration is responsible for conflicts. Dispatch (`src/model.ts`) keeps today's behaviour for `true`/`false`. A submission in `merge` mode records the base it was built on; when another task of the same repository and target was merged after that base, the coordinator marks the candidate `needs_rebase` for the integrator. Tests for dispatch (overlap allowed only in merge mode), the needs_rebase marker and backward compatibility of existing executions. Update docs. Gate: `npm run gate:task -- --base <sha>`. |
| C01 | delivery-control | B01, B02, B03 | Integrator role, part 1 — candidate integration. A worker started with role `integrator` (config flag; runs only on owner machines with git credentials, never inside the model sandbox) claims submitted attempts of runs with `autoAccept: true` through a new coordinator lease (`/v1/roles/claim` role `integrator`): downloads the patch from the evidence chunks with sha256 checks, checks out the current target head in a protected worktree, applies the patch (`git apply --index`; for `needs_rebase` or a failed apply try `--3way`), refuses U+FFFD in added lines, runs `npm ci` and the repository's full gate outside the sandbox (`npm run gate`, configurable per repository), and reports `integrated` with the tree, gate log and timings, or `integration_failed` with the conflict files or failing tests. A failed integration sends the task back for a new attempt on the current head (attempt limit unchanged); after two failed integrations the task goes to the operator queue. Tests with a temporary bare origin: clean apply, 3-way rebase in an import-only conflict, real conflict, red gate, damaged patch. Update docs. Gate: `npm run gate:task -- --base <sha>`. |
| C02 | delivery-control | C01 | Integrator role, part 2 — publish and accept. For an `integrated` candidate the integrator opens a pull request to the target branch (GitHub API with the integrator's token, branch `<run>/<task>`), merges it with the expected head SHA, verifies the merge commit tree equals the gated tree, commits the gate log and a supervisor JSON to `docs/evidence/<run>/s<stage>/<task>/` of delivery-control through a merged PR (same layout as the operator's `sislexa-owner-accept`), and posts the owner-reduced task acceptance with the operator token; when every task of a stage is accepted it posts the stage acceptance. Runs opt in with `autoAccept: true` (default false); the operator can switch it per run. Tests with a fake GitHub API: happy path, merge race (head moved → re-integrate), evidence PR, stage acceptance, opt-out. Update docs and the operator CLI (`control run auto-accept ID on|off`). Gate: `npm run gate:task -- --base <sha>`. |
