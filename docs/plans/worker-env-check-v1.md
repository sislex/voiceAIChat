# worker-env-check-v1 — проверка окружения воркеров

Ран `worker-env-check-v1` проверяет на настоящих задачах исправления окружения воркеров от 2026-10-04:
свой `HOME` для команд гейта и модели (delivery-control #106), посредник браузера `chromium-broker`
(#107), проверку на секреты до гейтов (#81), быстрый гейт `gate:quick` и перезапуск упавших тестов
первыми (delivery-fast-gate-v1). Задачи полезные сами по себе: обе убирают запись тестов мимо временной
папки системы. Каждая задача начинается от свежего `main` своего репозитория.

| B01 | Kanban | — | Server tests leave data directories in the OS temp folder: apps/server/src/ci/runManager.test.ts creates join(tmpdir(), `vc-ci-${Date.now()}`) as VC_DATA_DIR before each test and never removes it, and ten more server test files do the same (vc-ci-kb-*, vc-ci-report-*, vc-gate-*, vc-cii-*, vc-kb-ci-*, vc-prep-*, vc-prep-make-*, vc-autopilot-*, vc-ptypes-*, vc-proj-*, vc-inv-*); a developer machine had 58k leftover directories. Add a vitest globalSetup for apps/server that points TMPDIR at a per-run directory (inherited by the test workers) and removes it after the run; do the same for packages/shared, whose coreSource.test.ts leaves kanban-core-shared-* directories; a test or check that a run leaves no new directories in the OS temp folder; update docs/kb |
| B02 | core-ui | — | Browser tests write screenshots to hard-coded /tmp paths, which the delivery worker sandbox denies (EPERM): packages/ui/src/modules/operations/browser/applicationReleases.e2e.test.ts uses '/tmp/voicechat-application-releases-browser' in two places; use join(os.tmpdir(), 'voicechat-application-releases-browser') like e2e/applicationFrontend.e2e.test.ts (core-ui #42), keep VC_VISUAL_ARTIFACTS first; search the repository for any other hard-coded /tmp or home-directory writes in tests and fix them the same way; the changed browser test must pass in the gate |
