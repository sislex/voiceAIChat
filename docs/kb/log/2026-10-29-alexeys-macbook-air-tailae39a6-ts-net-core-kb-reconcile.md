---
title: core-kb-reconcile
date: 2026-10-29
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# core-kb-reconcile

## Scope and method

Reconciled the 33 topics reported stale by `kb:check --strict` at
Core `4aa06d23` (SISL-795). Read the KB workflow/module guidance first, then
compared topic claims with current tracked source, relevant changes since
`checked`, public contracts, package manifests and deployment/gate scripts.

Removed area entries for deleted workspaces/managers and tracked their surviving
Core contracts, adapters and repositories. This does not certify private owner
implementations: historical details remain explicitly identified as migration
references until the owner KB covers them. Core's remote/off boundary is verified
by `apps/server/src/kanban/boundary.test.ts`; no local manager fallback remains.

## Per-topic evidence

Paths below are relative to Core. Feature topic names refer to `docs/kb/features/`;
other names refer to `docs/kb/`.

| Topic | Compared implementation and reconciliation |
| --- | --- |
| architecture | `server.ts` LLM construction, `kanban/core.ts`, `kanbanBridge/{proxy,remote}.ts`, root package manifest: remote/off ownership, no CLI fallback, independently published renderer. |
| clients | `config.ts`, `routes/androidApp.ts`, `shared/src/androidRelease.ts`, UI artifact/proxy scripts: retain owner client boundary and track public Android downloads. |
| conventions | Root scripts/workspaces, Shared manifest/tsconfig, server tsconfig, application/quick/task gates: remove obsolete workspace installs and test counts, correct gate/dependency guidance. |
| ci-runner | Shared CI/merge/protocol, `db/repos/ci.ts`, Kanban proxy, Automation Runner ports/server/store and Core automation client: identify external orchestration, Core persistence, bounded log reads. |
| development-preview | `shared/src/developmentPreview.ts`, CI persistence and bridge: document disabled/docker/auto defaults, limits and owner execution boundary. |
| feature-preview | Shared preview/agent protocol, bridge tunnel authorization, `compose.preview.yml`, Dockerfile: owner lifecycle, loopback isolation and pinned Storybook assets instead of local compilation. |
| kanban-assistant | Shared widget/IPC contracts, Core widget relay/context and bridge: owner orchestration and optional expiry callbacks. |
| kb-usage | Knowledge auto-context/MCP ports, Core usage writer and `db/repos/{kb,kbHit}.ts`: 3500/1600 budgets, moved query/token code and retained telemetry. |
| llm-runners | Core remote client/config/server construction and Shared LLM: independent runner, unconfigured client when endpoint absent; historical owner source paths labeled. |
| make-browser | `turns.ts` Make selection/capabilities, `mcp/makeFiles.ts`, server owner file routes: explicit execution target, scoped tool-only turns, owner transport and attachment boundary. |
| manual-qa | Shared QA plus `db/repos/{qa,ci}.ts`, bridge events: Core manual-QA persistence and specialized Component QA/Integration Tests tables, owner execution. |
| merge-runner | Shared merge contract, `db/repos/ci.ts` merge claims, Kanban boundary/RPC: no Core manager/cleanup fallback. |
| playwright-reader | Core browser/reader bridge, browser-shot routes, manifest and contract imports: published owner implementation; retain consumer integration responsibilities. |
| project-knowledge-base | `packages/knowledge/src/{ports,mcp,rpc,autoContext,boundary.test}.ts`, Core KB adapters/module registration, kb-tools: package ownership, live viewer scope, last successful snapshots; replace self-referential freshness area with executable code and modules registry. |
| qa-stage-runs | `db/repos/qa.ts:110` and `:147`, Shared QA gates, CI repository and events: creation is running/starting, transition accepts queued or running; specialized and generic runs remain distinct. |
| release-composition | Composition/publisher/vendor-store scripts and Shared composition contract: immutable release URLs, cache versus committed bytes, explicit publishing, version examples historical. |
| release-gate-plan | `release-gate.mjs`, `owner-pins.mjs`, `application-gate.mjs`: validated full-gate attestation base, pin proof, independent owner/performance selection, unknown-base full fallback. |
| releases | Shared release/application contracts, application/release scripts, bridge and deployment configuration: owner orchestration versus Core validation, pinning, runtime and SQL responsibilities. |
| task-autopilot | `db/repos/tasks.ts` autopilot/transition persistence, QA repository, Shared projects, bridge events: executor belongs to Kanban; replace deleted controller/UI areas. |
| task-preparation | `shared/src/qa.ts:129` and `:176`, task persistence and bridge: absent KB exemption, code-source requirement, critical-source failures; owner prompt/parser paths historical. |
| glossary | Task-gate budgets, vendor-store/composition, Shared application/dev-stand vocabulary: 1000 cases/300 seconds and immutable URL pins. |
| image-retouch | `server.ts` retouch wiring/admission, chat history-file repository, owner imports and Shared frames: owner processing, access checks, text-only rejection and retained AI persistence. |
| kb-workflow | `packages/kb-tools/kb.mjs`, Core `kb/{codeUpdate,modelDocs}.ts`, Shared gaps, Kanban boundary: strict conditions, touch semantics and package coverage; extracted model-hook references clarified. |
| projects | Shared projects/QA/widget contracts, task SQL, Kanban boundary/proxy/events: central ownership map for all extracted workflow topics. |
| protocol | Shared protocol/IPC/agent/chat/thread-cost contracts, Android manifest/route and Core transports: add public verified APK download behavior; remove deleted owner areas. |
| server-internals | Recent server/turn/file-route changes, Knowledge host boundary and environment contract: Make file admission/limits, retouch and Android transport changes. |
| shared | Changes since a19140220, Shared exports/manifests, threadCost/chat/IPC/agent/Android types: dependencies, SDK ownership, reset and compact service-data contracts, optional widget expiry. |
| stt-runner | Core STT client/session, session wiring/config and Docker/compose: wire types are owned by voice-contracts; local areas now point to the consumer port. |
| stt-tts | STT/TTS clients/sessions, system capabilities, dev-web script: independent voice services and owner wire types; remove deleted UI audio source area. |
| testing-operations | Application/task/browser/release gates, release-train changes and runtime configuration: short temporary browser paths, bounded workers, verified release base and post-deploy health retries. |
| tts-runner | Core TTS remote client/session/types, server/config and Docker/compose: owner wire types and Core resource/audio transport. |
| ui | Core UI artifact/frontend scripts, browser UI/routes, manifests and Shared bridge contracts: owner asset verification, development proxy and published Storybook. |
| agent-api-access | `routes/rest.apiTokens.test.ts`, server admission and Shared protocol: documented API-token access behavior still matches; no factual body change required. |

## Additional strict-check repairs

Added missing `AGENTS.md` for the existing Automation Runner and Knowledge
workspaces, based on their manifests and implementation boundaries. No production
code or checker rules were changed.

## Validation

- `npm run kb:index`: regenerated 43 topics and 1326 journal entries.
- `npm run kb:check -- --strict`: exit 0; zero stale topics, valid links and package coverage.
- `npm run gate:fast`: exit 0; documentation-only diff selected no applications or contracts.
- `npm run test:files -- apps/server/src/kb/taskInjection.test.ts`: 7 tests passed, including real-KB context relevance and budget checks.
- `git diff --check`: passed.

Repeat strict validation after the area-grouped commits to verify that the
freshness markers remain valid.
