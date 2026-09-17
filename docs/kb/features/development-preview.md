---
id: development-preview
title: Development CI: isolated Docker preview and browser evidence
kind: feature
updated: 2026-09-17
checked: 46bdd433
areas:
  - packages/shared/src/developmentPreview.ts
  - packages/shared/src/ci.ts
  - apps/server/src/ci/developmentPreview.ts
  - apps/server/src/ci/developmentPreviewDocker.ts
  - apps/server/src/ci/developmentPreviewBrowser.ts
  - apps/server/src/ci/modelHooks.ts
  - apps/server/src/ci/ciCommandsMcp.ts
  - apps/server/src/kanban/module.ts
  - apps/server/src/routes/ci.ts
  - apps/server/src/db/repos/ci.ts
  - apps/server/docker/development-guard.Dockerfile
  - apps/llm-runner/src/previewGrants.ts
  - apps/llm-runner/src/auth.ts
  - apps/llm-runner/src/server.ts
  - apps/llm-runner/src/cli/claudeCli.ts
  - apps/llm-runner/src/cli/codexCli.ts
  - packages/ui/src/components/ci/CiTaskSettings.tsx
  - packages/ui/src/components/ci/RunFeed.tsx
---

# Development CI: isolated Docker preview and browser evidence

## Place in the CI workflow

Development preview is an opt-in environment owned by one active development run. It is separate from the committed feature-preview lifecycle. Task CI settings return and save `developmentPreview` independently from `browserCheck`; both are kept in the existing `ci_task_browser_checks.check_json` document, and old rows normalize to preview disabled and browser failure policy `continue`. The canonical settings, limits, status, diagnostic codes, operations and evidence contract are in `packages/shared/src/developmentPreview.ts`.

During model work, `DevelopmentPreviewManager` binds the project, task, run, user, selected machine/workspace, model and settings. It exposes `preview_start`, `preview_status`, `preview_logs`, `preview_restart` and `preview_stop` only through that run's CI MCP broker. Status snapshots are written to the run log and shown in the run feed. The authenticated run REST API is read-only for status and permits only `restart` or `stop` while the owning run is active.

## Source and runtime isolation

`createDevelopmentDockerRuntime` snapshots the exact current worktree, including untracked files, after recording HEAD and rejects a source change during the copy. The snapshot omits dotenv files, credential/auth documents, local databases and backups, `node_modules`, Git metadata, CLI profiles and common SSH/cloud configuration; symlinks, oversized files and a pre-existing snapshot root fail closed. The resulting source digest is combined with settings and pinned images to identify the running configuration.

Each incarnation uses a hash-derived Docker Compose project, a read-only application source mount, private dependency and test-data volumes, bounded logs/resources, dropped capabilities and no Docker socket. Runtime and network-guard images must be immutable SHA-256 references supplied by the operator. For the core application, web assets are built from the snapshot by a separate service with networking disabled before the application starts.

The application shares the guard container's network namespace. The guard has only `NET_ADMIN` and installs a default-deny egress policy that allows the fixed gateway endpoint; the gateway alone joins the egress network and publishes the application on a dynamically allocated loopback port. The model must use the returned `<agent>.machine.internal` URL and must not guess a port or launch an unmanaged background server.

## Test data and LLM access

Every incarnation gets a fresh `test-data` volume and an allow-listed environment. No task setting can supply a production DSN, database host or existing volume. Core preview uses SQLite below `/preview-data`; seed `default` creates the normal test account with a per-incarnation random password, while seed `none` runs without that default account. Neither credentials nor production data directories enter status or browser evidence.

The gateway forwards only `POST /v1/run` with a prompt to the selected production LLM Runner. Before startup the server asks that Runner for a short-lived grant scoped to project/task/run/user/provider/model and operation `generate`. The Runner stores only a token hash, permits at most two concurrent child runs, forces a new run id, null session, disabled execution and text-only mode, and rejects extra request fields. The scoped token cannot read files, inspect health/auth, cancel arbitrary runs or mint grants. Claude runs with all tools, MCP configuration, setting sources and session persistence disabled. Codex preview generation fails closed until a verified tool-free invocation exists.

Revocation stops active scoped children. TTL expiry, Runner restart and Runner shutdown also invalidate grants; a failed explicit revocation is reported as pending cleanup while the TTL still bounds access.

## Readiness, retries and evidence

Start and restart are serialized per run. Restart first removes the old environment and then snapshots fresh source; failed cleanup preserves the old handle and prevents a new grant/environment from being created. Startup has a configured deadline, bounded attempts and classified failures such as disabled feature, missing/unavailable Docker or machine, rejected isolation, build/network/gateway/health/application failure. Logs are size-bounded and redact known capabilities/passwords, bearer values, DSNs, private keys and common secret assignments.

A ready environment is not a passed browser check. The trusted Playwright adapter reuses the task's separate browser session and first requires that the model opened the exact preview URL. It then records successful open, read, console-error, failed-network, accessibility, style and screenshot calls. Evidence is accepted only when its URL, worktree SHA and configuration digest match the active environment and all required calls and a screenshot are present. Model prose cannot satisfy the gate; console, page-runtime or failed-network findings turn it into an application failure. Screenshots remain available as run artifacts.

A failed or missing preview/browser result gives the model a bounded repair turn. With policy `continue`, exhausted infrastructure failures become warning/skipped and model work, typecheck and tests continue. With `block`, exhausted attempts prevent successful model-work completion. Browser-only checks without managed preview use the same trusted adapter and bounded continue/block decision.

## Lifecycle and operation

The manager persists credential-free handles in `development-previews.json`, aborts an in-flight startup before stop, reconciles active handles on server restart and retries known cleanup failures every 30 seconds. Finish, explicit stop, expiry and shutdown close the task browser, revoke the scoped grant, run Compose down with volumes, and delete only that run's disposable snapshot. The collector does not scan or prune unrelated Docker resources.

Operators enable the feature with `VC_DEVELOPMENT_PREVIEW_ENABLED=true` and configure trusted runtime and guard image digests. Operational build, diagnosis and orphan-reconciliation instructions live in `docs/kb/deploy.md`; the opt-in real Docker test is `apps/server/src/ci/developmentPreviewDocker.integration.test.ts`.
