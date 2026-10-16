# orphan-guard-v2 — страж осиротевших процессов без собственной бури

Ран `orphan-guard-v2`. Ветка задач — `dev`. Задачу выполняют воркеры MacBook (M2); M1 выключен. Продолжение
`orphan-guard-v1` (B01 принят 2026-10-15 22:18, патч в `dev`), выкат на машины отложен до этой доработки.

## Что случилось

Патч `orphan-guard-v1` B01 (`src/worker/orphan-sweep.ts`, `guardian.ts`, `slot.ts`, `supervisor.ts`) делает
правильную вещь, но сам порождает поток процессов:

1. `sweepOrphans` для каждого процесса хоста, который не совпал по командной строке и не защищён, запускает
   `/usr/sbin/lsof -a -p PID -d cwd -Fn` и `ps eww -p PID -o command=`. На MacBook владельца 757 процессов
   (651 с ppid 1): один проход — ≈1 500 запусков и 3,9 с при 8 параллельных инспекциях. Супервизор делает
   проход каждые 60 с, супервизоров на машине два (воркеры и интегратор) — это ≈50 запусков процессов в секунду
   постоянно. Буря песочного git, из-за которой машина дважды зависла 2026-10-15, была 40–95 запусков в секунду.
2. `guardian.ts` снимает `ps -axo …` каждые 250 мс на каждую выполняемую команду (prepare, gate, модель):
   три слота — до 12 `ps` в секунду; `monitorAttempt` в `slot.ts` добавляет ещё один `ps` в секунду на попытку.
3. На macOS окружение и cwd всех своих процессов можно получить двумя командами на проход:
   `ps -axeww -o pid,ppid,pgid,etime,command` (аргументы и окружение) и `lsof -a -u <uid> -d cwd -Fpn` (cwd);
   на Linux — чтение `/proc/<pid>/environ` и `/proc/<pid>/cwd` только для кандидатов.

## Задачи интегратора (Claude, вне манифеста)

- После приёмки: выкат координатора и воркеров (`sislexa-coordinator-deploy`, `sislexa-worker-rollout`),
  замер на Mac: `ps -Ao comm | grep -cE '(^|/)(lsof|ps)$'` в течение минуты не должен расти,
  `grep orphan_sweep_failed service.log` пуст; проверка стража: `setsid`-потомок из каталога попытки убит после
  остановки слота. Запись в `sislexa-delivery-metrics --note`.

| B01 | delivery-control | — | Cut the orphan guard's own process churn, per docs/plans/orphan-guard-v2.md «Что случилось»: (1) in `src/worker/orphan-sweep.ts` gather cwd and environment for all candidate processes with at most two host commands per sweep instead of `lsof`/`ps eww` per process — on macOS one `ps -axeww -o pid,ppid,pgid,etime,command` and one `lsof -a -u <uid> -d cwd -Fpn`, on Linux procfs reads only for processes that are not matched by command and not protected; keep `processDetails` as a fallback for a single pid; (2) in `guardian.ts` observe descendants every 2 s instead of 250 ms and only while the child runs; (3) in `monitorAttempt` sample every 2 s, reuse one process table per tick for the tree and the `RunawayBreaker`, and express the breaker threshold per sampled interval so 20 births per second for 30 s still trips; (4) in `supervisor.ts` keep the 60 s cadence but skip inspection entirely when the cheap table shows no candidate rows; (5) unit tests asserting that a sweep over a 1 000-row table issues at most three host commands and that the breaker still trips at the same rate; record the measurement (757 processes, 1 500 spawns, 3.9 s per sweep before the change) in `docs/orphan-guard.md`. |
