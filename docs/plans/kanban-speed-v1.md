# kanban-speed-v1 — канбан со скоростью воркеров

Ран `kanban-speed-v1`. Ветка задач — `dev`. Задачи выполняют воркеры MacBook (M2); M1 выключен.

## Что случилось 2026-10-14

Четыре маленькие задачи Core (SISL-714, 715, 716, 718) шли через автопилот канбана по 1,5–3 часа; воркеры Delivery Control
делают такие задачи за 15–20 минут. Сама работа модели одинакова (10–13 мин). Разница — в конвейере вокруг неё:

1. **Интеграционный этап гонял `gate:release`** (полный гейт, бюджеты, системные сьюты трёх владельцев): 25–30 минут, под
   бюджетом 30 минут (`apps/server/src/ci/integrationTests.ts:55`) — два прогона SISL-715 ушли в `blocked` по таймауту. Команда
   берётся из настроек проекта: `integrationTestCommand` пустой → `testCommand = npm run gate:release`
   (`db/repos/ci.ts:1572`). **Исправлено настройкой 2026-10-14:** `integrationTestCommand = npm run gate:task -- --base
   origin/main`; `testCommand` (`gate:release`) остаётся для релизной регрессии.
2. **Клон и мерж-клон — полные клоны с GitHub.** Через медленный канал Mac (~120 КБ/с) шаг «Клонировать репозиторий задачи»
   (команда проекта в БД, 600 с) не укладывался, мерж падал «Не удалось получить ветки из origin»
   (`merge/runManager.ts:331,349`, таймаут 300 с). **Команда клона исправлена 2026-10-14** (версия 3): `--reference-if-able
   "${GIT_MIRROR_DIR:-<worktree проекта>}" --dissociate`. Мерж-клон и постоянное зеркало — в коде Kanban.
3. **npm-кэш отдельный на задачу** (`ci/runManager.ts:1623-1624`, `packages/shared` `managedCiWorkspacePaths`): каждая задача
   качает пакеты заново. Общий `~/.npm` раньше ломался при двух одновременных `npm ci` (EEXIST/ENOENT в `_cacache`).
4. **Флаки-тест = «дефект реализации».** `integrationTests.ts:183-189` останавливается на первом ненулевом коде без повтора,
   `componentQa.ts:258-276` так же; `kanban/module.ts:932-958` запускает цикл исправления модели. Под нагрузкой (три
   `gate:release` сразу, load average 49 на 8 ядрах) падали `scripts/affected-check.test.mjs` и e2e Playwright Reader.
5. **Нет быстрого режима.** Подготовка (LLM brief и тест-кейсы, ~5 мин, `kanban/module.ts:987-1008`) идёт всегда; для
   мелкой задачи она добавляет лишние тест-кейсы (SISL-720 получила TC про формат brief).
6. **Вложенные git-репозитории.** `scripts/system-gate.mjs` клал чекауты владельцев в `.cache/system-owners` внутри клона
   задачи; страж Kanban (`ci/runManager.ts:1135-1170`) роняет подготовку и отправку ветки с кодом 66. Исправление — в ветке
   `SISL-718`.
7. **`vendor/` — 151 МБ из 173 МБ дерева Core**, на 53 архива (~120 МБ) ничто не ссылается; каждая неглубокая копия Core
   весит ~135 МБ.

## Решения

- **Постоянное зеркало Git на машине.** Kanban держит `<storage>/git-mirrors/<sha256(gitUrl)[:16]>.git` (`git clone --mirror`,
  `git fetch --prune` под mkdir-замком, как `warm-workspace.ts` Delivery Control), передаёт путь командам CI в `GIT_MIRROR_DIR`
  и клонирует мерж-клон с `--reference-if-able <mirror> --dissociate`; `origin` остаётся настоящим URL.
- **Тёплые `node_modules`.** Ключ — хэш lockfile, package.json, `.npmrc`, платформы, архитектуры и major Node; попадание —
  копия `<storage>/warm-modules/<key>` в рабочую копию; промах — `npm ci` с общим кэшем `<storage>/.npm-cache` под замком
  установки и публикация через staging+rename; хранится 6 последних ключей. Без замка общий кэш не используется.
- **Один повтор упавшего этапа.** Неинфраструктурный провал этапа интеграции/автоматизированного QA повторяется один раз в
  остатке бюджета; зелёный повтор — этап пройден, в журнале «повтор прошёл (флаки)»; красный — `implementation_defect`.
- **Быстрый режим по метке `fast-lane`.** Задача с меткой `fast-lane`: подготовка без LLM (синтетическая готовность
  `uiImpact:'none'`, `testCases:[]`), Component QA и интеграционный этап — `skipped`, разработка и мерж — как обычно.
- **Чекауты владельцев системного гейта — вне клона Core** (`~/.cache/sislexa/system-owners/<хэш>`), Core-фикстура — из
  локального чекаута.
- **В `vendor/` — только архивы со ссылками**, тест не даёт копиться новым.

## Задачи интегратора (Claude, вне манифеста)

- Копия плана в `docs/plans/` sislexa-kanban до старта.
- После приёмки: выпуск Kanban, закрепление в Core, релиз Core и деплой; проверить на проде новую задачу через канбан и
  сравнить время этапов с SISL-714/715.

| B01 | Core | — | Remove unreferenced archives from `vendor/`, per docs/plans/kanban-speed-v1.md «Что случилось» 7: delete every `vendor/*.tgz` that is not referenced by any `package.json`/`package-lock.json` in the repository, `vendor/owner-artifacts.json`, `dependency-snapshots.json` or `scripts/`; add `scripts/vendor-archives.test.mjs` (wired into `test:tooling`) that fails when `vendor/` holds an unreferenced `.tgz` and passes on the cleaned tree; make the pin/owner-release scripts (`scripts/owner-release-publish.mjs`, `scripts/contracts-release.mjs` and similar) remove the archive they replace when nothing else references it, with a test. Commits `516629bc` and `7b9de429` on branch `SISL-720` contain a reviewed starting point (do not take `1e807271`, it is out of scope: nothing about brief/readiness formats). `npm ci` on a clean checkout must leave `package-lock.json` unchanged. Update docs/kb (releases/artifacts topic) with one sentence about the rule. Gate: `npm run gate:task -- --base <sha>`. |
| B02 | Core | — | Owner checkouts of the system gate outside the Core checkout, per docs/plans/kanban-speed-v1.md «Что случилось» 6: cherry-pick commits `8d9c0a5b`, `2a252315` and `bd6b51c4` from branch `SISL-718` (seed owner Core fixtures from the local checkout, clean interrupted fetch residue only without active Git, owner checkouts in `~/.cache/sislexa/system-owners/<checkout hash>` with `SISLEXA_SYSTEM_OWNERS_DIR` override, KB entry); resolve conflicts with `dev`, keep `scripts/system-gate.test.mjs` green. `assertNoActiveGit` must not refuse because of unrelated Git processes when no residue exists (it is only called when residue is present — keep it that way). Gate: `npm run gate:task -- --base <sha>`. |
| B03 | Core | — | `Cache-Control: no-store` for `GET /api/agents/version`, per docs/plans/kanban-speed-v1.md (former SISL-714): the response of `GET /api/agents/version` (`apps/server/src/routes/agents.ts`) carries `Cache-Control: no-store`, body unchanged; test in `apps/server/src/rest.machines.test.ts` (or next to the existing agents route tests) checks the header. Commit `692ee0e4` on branch `SISL-714` is a reviewed starting point. Gate: `npm run gate:task -- --base <sha>`. |
| B04 | Core | — | Self-update outcome in the machines WS feed, per docs/plans/kanban-speed-v1.md (former SISL-715): REST `GET /api/agents` returns `updateStatus {status, message, at}` per machine, the WS machines feed (`agentsFeed` in `apps/server/src/server.ts`) must include the same field for initial and subsequent lists, absent when there is no result; tests next to the existing agentsFeed tests (`apps/server/src/server.agentsFeed.test.ts`). Commits `d57c74b0` and `39ae9c3b` on branch `SISL-715` are a reviewed starting point. Gate: `npm run gate:task -- --base <sha>`. |
| B05 | Kanban | — | Persistent Git mirror for CI and merge clones, per docs/plans/kanban-speed-v1.md «Что случилось» 2 and «Решения» (copy of the plan is in this repository): add `apps/server/src/ci/gitMirror.ts` that builds a shell snippet (run on the agent machine through the existing command channel) keeping `<storage>/git-mirrors/<sha256(gitUrl) first 16 hex>.git` — `git clone --mirror` when missing, otherwise `git fetch --prune origin`, under a `mkdir` lock with a stale-lock timeout; on lock contention or mirror failure fall back to no mirror (never fail the run because of the mirror). Development runs (`ci/runManager.ts` env at ~1631) export `GIT_MIRROR_DIR` when the mirror is ready; merge runs (`merge/runManager.ts` ~331) clone the persistent merge clone with `--reference-if-able <mirror> --dissociate` and keep `origin` as the real URL; the merge fetch may fetch the mirror first. Tests for the snippet (lock, fallback) and for env/merge command construction. Update the CI/merge KB topic. Gate: `npm run gate:task -- --base <sha>`. |
| B06 | Kanban | B05 | Warm `node_modules` and a locked shared npm cache, per docs/plans/kanban-speed-v1.md «Что случилось» 3 and «Решения» (copy of the plan is in this repository): key = sha256 of `package-lock.json`, root and workspace `package.json`, `.npmrc`, platform, arch and Node major; hit → copy `<storage>/warm-modules/<key>` into the workspace (`cp -c -R` on macOS/APFS, `cp -a --reflink=auto` on Linux) and verify `node_modules/.package-lock.json` exists; miss → `npm ci --prefer-offline` with `npm_config_cache=<storage>/.npm-cache` under an install lock (one install per machine at a time), then publish via staging dir + rename under a lock, keep the 6 newest keys; bypass the warm copy when the lockfile has `file:` dependencies pointing outside the repository or lifecycle install scripts the key cannot cover — fall back to the locked shared cache. Apply to the development step «Установить зависимости» environment (`ci/workspaceDeps.ts`), the integration install (`ci/integrationTests.ts:179`) and the merge install (`merge/runManager.ts:479`). Keep per-task caches working when `<storage>` is unknown. Tests with fakes for hit/miss/lock/bypass. Update the CI KB topic. Gate: `npm run gate:task -- --base <sha>`. |
| B07 | Kanban | — | Retry a failed test stage once before `implementation_defect`, per docs/plans/kanban-speed-v1.md «Что случилось» 4 and «Решения» (copy of the plan is in this repository): in `apps/server/src/ci/integrationTests.ts` (stage loop ~183-189) and `apps/server/src/ci/componentQa.ts` command mode (~258-276), when a stage fails with a non-infrastructure failure and budget remains, rerun the same stage once; a green rerun counts as passed and the log gets «повтор прошёл (флаки): <stage>»; a red rerun keeps today's classification; infrastructure failures and timeouts are not retried. When the output carries `GATE-FAILED-TESTS: <json>` with 1–20 files, rerun `npm run test:files -- <files>` instead of the whole stage (same convention as release regression). Tests: flaky stage passes on rerun, persistent failure → implementation_defect after exactly one rerun, timeout → no rerun, GATE-FAILED-TESTS → targeted rerun. Update the QA KB topic. Gate: `npm run gate:task -- --base <sha>`. |
| B08 | Kanban | — | Fast lane for small tasks by label `fast-lane`, per docs/plans/kanban-speed-v1.md «Что случилось» 5 and «Решения» (copy of the plan is in this repository): when a task has the label `fast-lane`, autopilot preparation (`kanban/module.ts` `autoPilotPreparation`/`launchTaskPreparation`) does not call the LLM and stores a successful synthetic readiness snapshot (`uiImpact: 'none'`, no test cases, brief = task title + description + acceptance criteria), so Component QA and the integration stage become `skipped` by the existing rules (`db/repos/ci.ts:1438,1555-1558`); development, automated QA and merge are unchanged; removing the label before preparation restores the normal flow. No contract change in `@voicechat/shared` (labels already exist). Tests: label → no LLM call and skipped stages; without label → current behaviour. Update the autopilot KB topic. Gate: `npm run gate:task -- --base <sha>`. |
