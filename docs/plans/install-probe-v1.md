# install-probe-v1 — проверка установки зависимостей цели, которая действительно восстанавливается

Ран `install-probe-v1`. Ветка задач — `dev`. Задачу выполняет воркер MacBook (M2); M1 выключен.
Продолжение [release-reliability-v1](release-reliability-v1.md).

## Что случилось 2026-10-13/14

1. Три задачи Core упали на подготовке: `npm ci` в песочнице воркера не скачал готовую сборку `better-sqlite3` с GitHub
   Releases (`prebuild-install … Request timed out`; по IPv6 загрузка висела 25–30 с, по IPv4 — 0,8 с), сборка из исходников
   без заголовков Node тоже упала. Воркер сообщил `target_install_broken`, координатор поставил `sislex/voiceAIChat` → `dev`
   на паузу (`targetInstalls`, `status: 'install_broken'`, headSha `097b3a5`).
2. Пауза не снялась за 10+ часов, хотя сеть восстановилась и голова `dev` сдвинулась. Зонд установки в `src/worker/slot.ts`:
   бюджет `Math.min(110000, …)` при аренде координатора 120 с (`claimInstallProbe`, `src/target-install.ts`);
   `probeTargetInstall` (`src/worker/install-probe.ts`) делает полный `git clone --no-checkout <url>` репозитория Core по сети,
   затем `npm ci` с пустым кэшем; любая ошибка или таймаут проглатываются (`.catch(()=>undefined)` и пустой `catch`), результат
   не отправляется, `finishInstallProbe` не вызывается — флаг вечный, в журналах воркера и координатора ни строчки.
3. Ручного выхода у оператора нет: снять `install_broken` может только успешный зонд; задачи в `blocked` нельзя принять
   (`owner_task_acceptance_barrier`), а `task retry` требует `failed`. Прогон пришлось заархивировать, задачи Core делать вручную.

## Решения

- **Зонд клонирует из локального зеркала воркера** (то же зеркало/кэш, что использует подготовка попытки: `warm-cache/mirrors`
  или зеркало checkout), затем `git fetch origin <branch>` с сетевого `origin`; сетевой полный клон — только если зеркала нет.
- **Бюджет зонда настраивается:** `targetInstallProbeSeconds` в `worker.json` (по умолчанию 600) и та же длительность аренды
  на координаторе (`CONTROL_TARGET_INSTALL_PROBE_SECONDS`, по умолчанию 600); воркер берёт меньшее из своего бюджета и аренды.
- **Ошибки зонда не теряются.** Воркер пишет в журнал `install_probe_failed phase=<clone|fetch|checkout|npm_ci|timeout>` и
  отправляет `/v1/targets/install/result` с `failure: {phase, exitCode?}` (без вывода команд); координатор хранит
  `lastProbe: {at, phase, exitCode, headSha}` в строке `targetInstalls`, показывает его в `GET /v1/status` и в записи очереди
  оператора, планирует следующий зонд (`nextProbeAt`, не чаще раза в минуту).
- **Оператор может снять паузу.** `POST /v1/admin/targets/install/reset {repository, targetBranch, reason}` (admin) переводит
  строку в `healthy`, пишет событие `target.install_reset` с причиной; заблокированные задачи снова доступны воркерам.
  CLI: `control target reset OWNER/REPO BRANCH --reason TEXT --journal FILE`.

## Задачи интегратора (Claude, вне манифеста)

- Копия плана в `docs/plans/` delivery-control до старта.
- После приёмки: выкат координатора и воркеров (`SKIP_M1=1 sislexa-worker-rollout`), `control target reset sislex/voiceAIChat dev`,
  проверить, что пауза снята; затем свежий прогон с задачей Core проходит подготовку.

| B01 | delivery-control | — | Recoverable target install probe, per docs/plans/install-probe-v1.md «Что случилось» and «Решения» (copy of the plan is in this repository): (1) `src/worker/install-probe.ts` `probeTargetInstall` clones from the worker's local repository mirror/cache used by attempt preparation (fall back to the network URL only when no mirror exists) and fetches the target branch from the real origin; (2) probe budget `targetInstallProbeSeconds` in worker config (default 600) and coordinator lease `CONTROL_TARGET_INSTALL_PROBE_SECONDS` (default 600) in `src/target-install.ts` `claimInstallProbe`, replacing the hard-coded 110 s / 120 s; (3) `src/worker/slot.ts` no longer swallows probe errors: log `install_probe_failed phase=<clone|fetch|checkout|npm_ci|timeout>` and post the result with `failure: {phase, exitCode?}` (no command output); `finishInstallProbe` stores `lastProbe {at, phase, exitCode, headSha}` on the row, exposed in `GET /v1/status` and the operator queue entry, and schedules the next probe; (4) admin route `POST /v1/admin/targets/install/reset {repository, targetBranch, reason}` sets the row healthy, emits `target.install_reset` with the redacted reason, and CLI `control target reset OWNER/REPO BRANCH --reason TEXT --journal FILE`. Tests: probe uses the mirror, budget from config, failure phases reported and stored, reset clears the pause and blocked tasks become eligible, stale probe results still rejected. Update docs/attempt-failures.md «Target install health» and docs/operator-queue.md. Gate: `npm run gate:task -- --base <sha>`. |
