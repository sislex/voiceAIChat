# task-build-check-v1 — сборка в задачном гейте всех репозиториев

Ран `task-build-check-v1`. Ветка задач — `dev`.

Владелец, 2026-10-08: задачный гейт агента не собирает пакет, как раньше было в Make — ошибки сборки
всплывают только на интеграции (ops-followups-v2 B03: top-level await в CJS-сборке агента; Make 1.4.2:
`node:crypto` в браузерном бандле). Сборку в `gate:task` делают только Make и delivery-control; у ядра,
Kanban, Core UI, UI Kit, LLM Runner, Image Studio, Web Reader, Playwright Reader, Voice и агента её нет.
Решение — одна общая проверка в воркере, а не правка десяти `gate:task`.

| B01 | delivery-control | — | Build check after the task gate. After `npm run gate:task` passes, the worker runs the repository's build check inside the same sandbox and budget rules: `npm run gate:task:build` when the script exists, otherwise `npm run build` when a `build` script exists, otherwise nothing (reported as `build: absent`). Time limit 300 s (configurable per execution `buildCheck: {timeoutSeconds, disabled}`); output bounded like gate output. A failing build is a gate failure (`gate_failed`, command recorded) that enters the same model repair loop with the build output; the attempt report and metrics gain `build: {command, seconds, outcome}`. Repositories whose build needs extra installs declare them via the existing execution `prepare` list (document the agent case: `npm --prefix apps/agent-tray ci`, `npm --prefix apps/login-application ci`). Tests: build script chosen, absent, failure enters repair, timeout, disabled. Update docs (workers, task gate) and the operator note about per-repository prepare. Gate: `npm run gate:task -- --base <sha>`. |
