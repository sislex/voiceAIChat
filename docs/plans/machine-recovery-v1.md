# machine-recovery-v1 — машина разработки сама восстанавливается после перезагрузки

Ран `machine-recovery-v1`. Ветка задач — `dev`.

Владелец, 2026-10-08: при перезапуске мака всё должно запускаться автоматически, или достаточно запустить
Docker и один скрипт агента — после этого восстанавливаются стенды и воркеры.

## Что было при перезагрузке M1 (2026-10-08)

- Воркеры (LaunchAgent) поднялись сами после входа пользователя.
- Inbox оператора не поднялся: его отдельная копия сборки (`delivery-operator-inbox-tools`) устарела и не
  читала новый конфиг воркера (`last exit code = 1`); на маке inbox в том же состоянии.
- Контейнеры базового стенда поднялись с Docker (`unless-stopped`).
- Dev-процессы компонентов стенда (Core UI, Make) и шлюз стенда не поднялись: агент не восстанавливает
  записи `~/.voicechat/dev-processes/registry.json`, шлюзом (`scripts/dev-gateway.mjs` ядра) никто не
  управляет, файл стенда лежал во временном каталоге и пропал. Оператор вручную записал файл стенда и
  LaunchAgent шлюза; при смене порта компонента файл приходится править руками.
- Выпуск воркера 86e63b98 не стартует на M1: самопроверка (`sandbox_self_test_failed`) с обёрткой
  `codex-profiles/sol-0.156.1/codex-sol`; M1 откатан на e0789210.

## Решения

1. Всё, что нужно машине разработки, — LaunchAgent с `RunAtLoad`/`KeepAlive`; ручной шаг после входа
   — не больше одной команды (`sislexa-machine-up`), которая всё проверяет и поднимает.
2. Стендом на машине управляет агент-компаньон: он хранит файл стенда в постоянном каталоге,
   перезапускает компоненты и шлюз после своего старта и обновляет файл стенда при каждой подмене.
3. Inbox оператора запускается из текущего выпуска воркера, а не из отдельной копии.

## Настройки владельца (не задачи воркеров)

- macOS: автоматический вход пользователя на машинах разработки (иначе LaunchAgent не стартуют).
- Docker Desktop: «Start Docker Desktop when you sign in».

| B01 | Agent | — | Dev stand recovery in the companion agent (`apps/agent/src/devProcess.ts`). (1) On agent start, for every entry of `~/.voicechat/dev-processes/registry.json` whose worktree still exists, restart the component with the same command, env and port (if the port is busy, allocate a new one from the stand range and record it), wait for readiness, and report each result to Core through the existing devProcess channel (new event `devProcess.recovered` / `devProcess.recoveryFailed` with standId, component, url). (2) The agent owns the stand gateway: it runs Core `scripts/dev-gateway.mjs` from the stand's Core worktree as a managed process `gateway` per stand, writes the stand manifest to `~/.voicechat/dev/stands/<standId>/manifest.json` (atomic rename, schema accepted by that gateway version — omit fields the gateway does not know), updates it on every component start/reset/recovery, and restarts the gateway on crash with backoff. (3) `sislexa-agent status` lists stands, components, ports and gateway health. Tests with fake processes: recovery after restart, busy port reallocation, manifest rewrite on component change, gateway restart, failed recovery reported. Update docs/kb. Gate: `npm run gate:task -- --base <sha>`. |
| B02 | delivery-control | — | Machine bring-up command and inbox from the worker release. (1) The operator inbox LaunchAgent runs `operator-inbox.js` from the worker's current release (the same path the worker supervisor uses, e.g. a `current` symlink switched by the rollout), so a worker rollout updates the inbox too; the rollout script (`scripts/worker-release.mjs` / operator docs) restarts the inbox after switching. (2) `scripts/machine-up.mjs` (installed as `sislexa-machine-up`): checks that Docker is running (starts Docker Desktop with `open -a Docker` on macOS and waits for `docker info`), kickstarts every `com.sislexa.*` and `com.voicechat.agent` LaunchAgent of the user that is not running, waits for the worker heartbeat and inbox poll on the coordinator, checks each stand gateway URL from the agent status, and prints a pass/fail table; exit 1 on any failure. Tests with fake launchctl/docker/coordinator. Update docs (machines, operator). Gate: `npm run gate:task -- --base <sha>`. |
| B03 | delivery-control | — | Sandbox self-test with codex profile wrappers. Worker release 86e63b98 fails `sandbox_self_test_failed` on the M1 worker whose codex is the wrapper `~/.local/share/sislexa/codex-profiles/sol-0.156.1/codex-sol`, while the Mac with plain `codex` passes. Make the self-test record the exact failing probe (argv without secrets, exit code, first 2 KB of stderr) in the worker start error and in `/v1/status` machine diagnostics; ensure the probes work through wrapper scripts that forward arguments (`exec "$CODEX" "$@"`), including the `codex exec` argument probe (treat provider/network errors as pass, only argument rejection — exit 2 or `unexpected argument` — as failure). Tests with a wrapper fixture that forwards arguments and one that drops them. Update docs. Gate: `npm run gate:task -- --base <sha>`. |
| B04 | Kanban | — | Stand reconciliation after machine restart. When the stand machine's agent reconnects (or reports `devProcess.recovered` / `devProcess.recoveryFailed`), Kanban updates the stand manifest components (`url`, `startedAt`, failed components back to `base` with an operation record explaining why) and exposes `recoveredAt` and per-component `health` in `GET /api/projects/:id/dev-stands/:standId`; a stand whose gateway is unhealthy for more than 2 minutes after reconnect is reported `degraded`. Tests for recovered, failed and degraded flows. Update docs/kb (environments-service). Gate: `npm run gate:task -- --base <sha>`. |
