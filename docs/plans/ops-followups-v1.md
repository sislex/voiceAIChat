# ops-followups-v1 — что сломалось 2026-10-07/08 и не должно повториться

Ран `ops-followups-v1`. Ветка задач — `dev`.

Владелец, 2026-10-08: все решения, выпуски и деплой — оператору на время отсутствия. Оператор оформил
проблемы ночи прогоном, пока воркеры свободны.

## Что было

- Поезд выпуска (`scripts/release-train-run.mjs`) пять раз останавливался: создание PR в `main` сразу после
  пуша ветки иногда падает; проверка образа шла раньше, чем образ становился виден в GHCR; публикация
  запускалась из рабочей копии ядра без `node_modules` (`tsx` не найден); пуш коммита закрепления в `dev`
  не переживает движение `dev`; ошибки дочерних команд и ответы GitHub не видны — каждый сбой приходилось
  повторять руками.
- Интегратор после серии таймаутов координатора завис на ~3 часа: процесс жив, без heartbeat и запросов
  (последнее событие `integrator_retry_wait`), помог только перезапуск LaunchAgent.
- Агент-компаньон не управляет шлюзом стенда (machine-recovery-v1 B01 принят частично): шлюз запускается
  ручным LaunchAgent из старой рабочей копии ядра, а файл стенда при смене порта компонента правится руками.
- Задачный гейт Make не собирает фронтенд: импорт значений из корня `@voicechat/make-contracts`
  (`node:crypto`) сломал production-сборку и всплыл только на полном гейте выпуска.

| B01 | Core | — | Release train robustness (`scripts/release-train-run.mjs`). (1) Before running, check that the Core checkout running the train has installed dependencies (`node_modules/.bin/tsx`), otherwise stop with a clear message. (2) GitHub API calls (`gh` helper): on 422/5xx/network errors retry up to 5 times with backoff, and include the HTTP status and the GitHub `message`/`errors` in the thrown error. (3) Child commands: on failure include the command, exit code and the last 40 lines of its output in the error and the journal (still no tokens: the existing redaction applies). (4) `verify`: poll the GitHub release, manifest and `docker manifest inspect` for up to 5 minutes before failing. (5) `coreMerge`: if pushing the pin commit to `dev` is rejected because `dev` moved, rebase the pin commit onto the current `origin/dev` (conflicts only in generated `docs/kb/README.md` are resolved by re-running `kb:index`; any other conflict stops), re-run the Core gate on the result and push. Tests with the existing fixtures for each case. Update docs/kb (deploy). Gate: `npm run gate:task -- --base <sha>`. |
| B02 | delivery-control | — | Integrator and worker liveness watchdog. A worker or integrator whose supervisor loop makes no successful coordinator request for more than 5 minutes while the process is alive must exit with a distinct code (`worker_stalled`) so launchd restarts it; log the last successful request time and the pending operation. Find and fix the integrator stall seen on 2026-10-08 (after `transport_failed` retries ended in `integrator_retry_wait`, no further events for hours). Tests with a fake coordinator that times out, then recovers, then hangs. Update docs (workers, integrator). Gate: `npm run gate:task -- --base <sha>`. |
| B03 | Core | — | Versioned stand gateway CLI. Make `scripts/dev-gateway.mjs` a stable, versioned entry: accept the stand manifest of the current schema including optional `gateway` and future unknown top-level fields ignored with a warning (component entries stay strict), print its version on `--version`, support `SISLEXA_STAND_MANIFEST` changes without restart (already read per request) and a `/__gateway/health` endpoint returning version, manifest standId and per-component upstream reachability. Publish the gateway in the Shared/Core contracts docs as the agent-facing contract. Tests for manifest with `gateway`, unknown fields, health endpoint. Update docs/kb (deploy). Gate: `npm run gate:task -- --base <sha>`. |
| C01 | Agent | B03 | The companion agent manages the stand gateway (remainder of machine-recovery-v1 B01). The agent runs the Core gateway (B03) for each stand on the machine as a managed process from the stand's Core worktree, writes the manifest to `~/.voicechat/dev/stands/<standId>/manifest.json` (atomic rename) on every component start/reset/recovery, restarts the gateway on crash with backoff, recovers it after agent start, and reports gateway health via `/__gateway/health` in `sislexa-agent status` and the devProcess events. Replaces the manual LaunchAgent `com.sislexa.dev-gateway.<standId>` (document how the operator removes it). Tests with fake processes. Update docs/kb. Gate: `npm run gate:task -- --base <sha>`. |
| B04 | Make | — | Task gate builds the frontend. `npm run gate:task` in Make must include the production build of `make-ui` when files under `packages/make-app/src` or `packages/make-contracts` change (the build already runs in the full gate), and a static check that browser code (`packages/make-app/src`, excluding tests) imports values only from browser-safe `@voicechat/make-contracts` subpaths, not from the package root. Tests for the check. Update docs/kb (testing). Gate: `npm run gate:task -- --base <sha>`. |
