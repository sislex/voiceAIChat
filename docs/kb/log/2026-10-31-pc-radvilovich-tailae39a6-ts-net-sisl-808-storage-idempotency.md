---
title: sisl-808-storage-idempotency
date: 2026-10-31
machine: pc-radvilovich-tailae39a6-ts-net
author: voiceAIChat agent
---

# sisl-808-storage-idempotency

## Changes

Added idempotent owner/kind/ref creation for chat and Make spaces in the memory
and SQL stores. Chat uploads use the coordinator call. SQL uses a unique
canonical identity index without merging legacy spaces.

## Verified findings

Existing metadata stored kind/ref only in JSON; canonical identities now live
in storage_space_refs. Duplicate spaces remain visible. The shared contract
covers concurrent creation, scopes, null refs, legacy data and deletion.
SQL tests cover uniqueness and insert-conflict recovery.

## Knowledge topics

- docs/kb/data-auth.md: implementation and one-off cleanup procedure.
- docs/kb/architecture.md: coordinator creation and cleanup reference.

## Strict KB gate reconciliation

Reviewed the 18 stale topics against their areas from checked c79bac7b to
dab1b380. Net runtime changes are storage creation, admin storage quotas, Agent
WebSocket rejection containment and npm contract-release diagnostics. The
following evidence groups cover each listed topic:

| Topics | Area evidence and conclusion |
| --- | --- |
| agent-api-access, clients | server.ts changes only admin storage injection and chat-space creation; API token auth, frontend serving and client configuration have no net changes. |
| deploy | server.ts and routes/admin.ts match documented storage behavior; contracts-release.mjs forces error logging and captures both streams, already described under Contract pin release. |
| features/ci-runner | server.ts storage changes and registry.ts async change-listener rejection handling do not change CI stages; CI repositories, bridge, schema and task planner have no net changes. |
| features/kanban-assistant, features/make-browser, features/manual-qa, features/merge-runner, features/qa-stage-runs | Only server.ts storage changes intersect these areas; widget, preview, QA and merge contracts, handlers and repositories have no net changes. |
| features/kb-usage | server.ts and routes/admin.ts changes concern storage; KB routes, telemetry and persistence have no net changes. |
| features/llm-runners | server.ts and routes/admin.ts changes concern storage; runner protocol and attachment transport are unchanged. |
| features/task-preparation | server.ts storage creation and ipc.ts admin:setUserStorageQuota do not alter preparation contracts or readiness. |
| image-retouch, llm | server.ts upload creation now uses the coordinator; retouch ownership checks, storage paths and runner attachment transport remain unchanged. The new IPC channel is admin-only. |
| protocol | routes/admin.ts quota validation, Identity setter, nullable override and storageUsage match the existing Admin storage quota contract. |
| server-internals | Reviewed all changed server files, including storage tests, admin standalone runtime and Agent WebSocket cleanup. Existing admin and WS sections match; clarified shared space creation and the separate file-write transaction. |
| testing-operations | contracts-release.mjs and its regression are the only net script changes; added the offline ERESOLVE diagnostic behavior and link. |
| ui | server.ts storage creation and the added admin IPC channel match existing consumer-boundary notes; renderer artifacts, UI contracts and conversation repositories have no net changes. |

Refreshed checked markers only after this review. The workflow command and
freshness rules are unchanged.
