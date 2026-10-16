# orphan-guard-v1 — страж осиротевших процессов воркера

Ран `orphan-guard-v1`. Ветка задач — `dev`. Задачу выполняют воркеры MacBook (M2); M1 выключен.

## Что случилось

2026-10-15 MacBook (M2) владельца дважды подряд «завис» до сброса кнопкой питания (20:58 и 21:20). Ядро оба раза
работало до сброса, паники не было. Перед первым зависанием журнал показывает бурю запусков
`~/.local/git-runtime/bin/git` (песочный git воркеров Delivery Control из `worker.json`): 2 500–5 700 процессов в
минуту, то есть 40–95 в секунду, непрерывно с 07:00 (начало хранимого журнала) до сброса; за час до 97 тысяч
запусков. Отчёты `DiagnosticReports` за прошлые дни относят тяжёлый git к коалициям
`com.sislexa.delivery-worker.*`. Родитель цикла пережил остановку слота (`slot_stopped` в 07–09 утра, попыток в
работе весь день не было) и умер только вместе с перезагрузкой; после неё запусков git нет.

Почему страж не сработал: `src/worker/guardian.ts` убивает только группу процессов (`process.kill(-pid)`) команды,
запущенной через `command.ts`. Потомок, сменивший сессию или группу (`setsid`, `detached`, собственная песочница
модели, npm-скрипт с демоном), из группы выходит и после завершения попытки живёт сколько угодно. Отдельных
spawn вне стража тоже хватает: `src/worker/integrator.ts:25` (без `detached` и без убийства группы),
`src/worker/browser-broker.ts`. Остановка слота (`slot.ts`, блок `finally` с `pruneAttempt`) и супервизора
(`supervisor.ts`, `stop`) удаляет каталоги попытки, но не ищет процессы, которые из них запущены.

## Задачи интегратора (Claude, вне манифеста)

- После приёмки: выпуск Delivery Control (выкат координатора и воркеров на MacBook), проверка на машине:
  `ps -Ao pid,ppid,args | grep git-runtime` пуст после остановки слота с запущенным `setsid`-потомком; запись в
  `~/.local/share/sislexa/delivery-metrics/changes.tsv` через `sislexa-delivery-metrics --note`.

| B01 | delivery-control | — | Orphan process guard for worker slots, per docs/plans/orphan-guard-v1.md «Что случилось»: (1) add `src/worker/orphan-sweep.ts` that reads the host process table (`ps -axo pid,ppid,pgid,etime,command`) and kills — SIGTERM, then SIGKILL after a 5 s grace — every process that is not an ancestor-linked child of a live slot but whose command line, cwd (`lsof -p` on macOS, `/proc/<pid>/cwd` on Linux) or environment references an attempt root under `workerAttemptsRoot`, the warm-cache dirs or the sandbox git runtime path from the worker config; (2) run the sweep in `slot.ts` in the attempt `finally` block before `pruneAttempt`, on slot shutdown, and every 60 s from `supervisor.ts` for attempt roots that no longer belong to a running slot; (3) in `guardian.ts` on close also walk the pid tree from the spawned pid and kill descendants that left the process group; (4) runaway breaker: when the sweep sees more than 20 new descendants per second of one attempt for 30 s, abort the attempt with failure code `runaway_spawn` and kill the tree; (5) log `orphan_killed` (pid, truncated command, attemptId, age) and `orphan_sweep_failed`, add the counters to attempt metrics; (6) unit tests with fake process tables for tree walk, root matching and the breaker, plus an integration test that starts a detached `setsid` child from a fake attempt root and asserts it is gone after the sweep; document the guard in `docs/`. |
