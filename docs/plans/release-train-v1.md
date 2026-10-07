# release-train-v1 — выпуск одной командой

Ран `release-train-v1`. Ветка задач — `dev`.

Владелец, 2026-10-07: выпуск одной командой — отдельным прогоном.

## Что видно сейчас

Выпуск 0.1.419 (2026-10-07) оператор делал ~15 ручными шагами: версия и `release/x.y.z` в Kanban,
полный гейт, слияние `dev` → `main`, публикация образа и GitHub-релиза из чистого клона
(`scripts/owner-release-publish.mjs`, временный `DOCKER_CONFIG`), закрепление в ядре
(`deploy/tools.lock.json`, `docker-compose.yml`, `docs/kb/deploy.md`, журнал KB), полный гейт ядра,
слияние `dev` → `main`, ветка выпуска и деплой в Release Center через вкладку браузера владельца.
Остановки по пути: Docker Desktop не запущен, тесты, читающие реальные файлы ядра, устарели.

## Решения

1. Поезд выпуска — скрипт ядра `scripts/release-train.mjs` с журналом шагов: каждый шаг идемпотентен,
   прерванный выпуск продолжается с места остановки.
2. Деплой прода всегда ждёт явного подтверждения владельца (флаг `--deploy` или кнопка в Release
   Center); всё до деплоя выполняется без участия.
3. Release Center принимает создание ветки и деплой от токена автоматизации владельца, а не только от
   сессии браузера.

| B01 | Core | — | Release train planner: `node scripts/release-train.mjs plan [--json]` lists, for every owner application in `deploy/tools.lock.json` with a GitHub repository, whether `dev` is ahead of `main` (commit count and subjects), the current pinned version and commit, the proposed next patch version, whether a published GitHub release `v<version>` already exists for the pinned commit, and the Core changes `origin/main..origin/dev`; it checks prerequisites (Docker daemon reachable, `GH_TOKEN`/`GITHUB_TOKEN` present without printing it, clean protected worktree root `~/sislexa-worktrees`) and prints what would be done in order. Pure planning, no writes. Tests with fixture repositories and a fake GitHub API. Update docs/kb (deploy topic). Gate: `npm run gate:task -- --base <sha>`. |
| C01 | Core | B01, C02 | Release train execution: `node scripts/release-train.mjs run [--apps a,b] [--deploy]` executes the plan with a journal (`~/.local/state/sislexa/release-train/<id>.json`) and resume: for each selected owner app — bump the patch version in the root and application `package.json` plus `npm install --package-lock-only` (never `npm version --workspaces`), run the owner's full gate, open and merge `release/<version>` into `main`, sync `dev` to `main`, publish from a clean clone with `scripts/owner-release-publish.mjs --source` using a temporary `DOCKER_CONFIG` (login with the token on stdin; removed afterwards), verify the GitHub release and image; then pin all published versions in Core (`deploy/tools.lock.json`, `docker-compose.yml`, `docs/kb/deploy.md` with the KB touch/log/index steps), run Core `npm run gate`, merge `dev` → `main`, and create the Core release branch through the Release Center API (preflight first); with `--deploy` also start the deploy and wait for `/api/health` to report the new version. Stops with a clear message at the first failure; `run --resume <id>` continues. Tests with fixture repositories, fake GitHub and Release Center APIs, including resume after each step. Update docs/kb. Gate: `npm run gate:task -- --base <sha>`. |
| C02 | Kanban | B01 | Release Center automation token: the release branch creation (`POST /api/projects/:id/releases/branches`), release preflight and deploy (`POST /api/projects/:id/releases/deploy`) routes accept, besides the owner's browser session with CSRF, an owner automation token (existing Core service-token mechanism or a new project-scoped token issued by the project owner, stored hashed, revocable, Authorization header) limited to these release routes of that project; every call is recorded in the release step log with the token id. Tests for accepted token, wrong project, revoked token, other routes rejected, CSRF still required for sessions. Update docs/kb. Gate: `npm run gate:task -- --base <sha>`. |
