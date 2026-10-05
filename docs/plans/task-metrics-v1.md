# task-metrics-v1 — время задачи: модель, тесты, круги исправлений

Ран `task-metrics-v1`. Идёт параллельно с интеграцией `dev-lane-v1`.

Владелец хочет видеть по каждой задаче, сколько времени уходит на работу модели и на тестирование, и
сколько кругов «модель → гейт» понадобилось, если гейт падал. Сейчас воркер уже замеряет фазы попытки
(`src/worker/phase-metrics.ts`: `checkout`, `prepare`, `model`, `gate`), но пишет их только в свой лог:
координатор их не хранит, оператор и владелец их не видят, круги локального исправления не различаются.

## Решения

1. Метрики — только длительности, исход и номера кругов. Вывод команд, события модели и секреты в них не
   попадают (как в `phase-metrics.ts`).
2. Круг = один вызов модели и следующий за ним гейт. Первый круг — реализация, следующие — исправления
   после упавшего гейта (локальный цикл исправления внутри попытки).
3. Итог задачи суммирует все попытки, включая неудачные и повторные.

| B01 | delivery-control | — | Task time metrics in Delivery Control. (1) Worker: record a phase timeline per attempt — checkout, prepare, then rounds; each round is one model run and the gate run that follows it (round 1 = implementation, later rounds = local repair after a failed gate), with durationMs, outcome (passed/failed/budget/timeout) and, for gate:task, tests and seconds; keep phase-metrics.ts guarantees (fixed labels only, no command output, model events or secrets); send the timeline with the attempt result/fail report and through the fenced terminal API, bounded in size. (2) Coordinator: validate and persist the timeline per attempt (additive schema/migration, old attempts without metrics stay valid), aggregate per task (attempts, rounds, total/model/gate/prepare/checkout time, wall time from first dispatch to done) and per run (sums and the slowest tasks), expose it in the status API and emit `attempt.metrics`. (3) Operator CLI: `control status` shows per task `model 12m · gate 3m (2 rounds) · prepare 1m · attempts 1/3`, and `control metrics RUN [TASK]` prints the per-attempt/per-round breakdown and run totals; `--json` for both. (4) Tests: round accounting with a failed gate followed by a repair round, budget failure, retry across attempts, old attempts without metrics, rejection of oversized or malformed timelines, absence of command output in stored metrics; update docs (README, docs/dev-lane.md). |
