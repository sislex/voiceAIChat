---
title: thread-reset-kb-reconciliation
date: 2026-10-29
machine: alexeys-macbook-air-tailae39a6-ts-net
author: voicechat-ci
---

# thread-reset-kb-reconciliation

## Diagnosis and repair

The implementation commit 2b9bba5e followed the previous KB touch, so the
markers did not cover that commit. The strict check also reported the preceding
2dd38b0b Compose pin update. Compared the listed topics and their areas with
these code changes; preserved every area and the strict gate policy. Updated
clients.md and shared.md with the additive degraded-summary contract.

## Per-topic reconciliation evidence

- `agent-api-access.md`: server.ts:804-814 only changes summary runner wiring; API-token authentication and routes are unchanged.
- `architecture.md`: server.ts:804-814 adds the secondary summary runner; module ownership, deployment selection and main turn clients are unchanged.
- `clients.md`: server.ts:804-814 and ConversationSummary.source establish the optional degraded-summary indicator; added the consumer contract note.
- `conversation-groups.md`: types.ts:872-878, schema.ts:49, database.ts:448 and chat.ts summary mapping only add summary_source; group membership and ordering are unchanged.
- `data-auth.md`: schema.ts and database.ts add nullable summary_source; chat.ts:692-696 retains the id/user_id ownership filter. Authentication and accounting are unchanged.
- `deploy.md`: 2dd38b0b changes only Make/Kanban image pins in Compose and tools.lock; the deployment topic already records them. 2b9bba5e changes only summary service wiring in server.ts.
- `features/ci-runner.md`: Compose pin changes in 2dd38b0b and summary-only schema/database/server changes in 2b9bba5e do not change CI execution or its Core bridge.
- `features/feature-preview.md`: database.ts adds only summary_source; preview resources, environment contracts and lifecycle are unchanged.
- `features/kanban-assistant.md`: server.ts and schema/database changes concern conversation summaries only; widget relay and assistant contracts are unchanged.
- `features/kb-usage.md`: schema/database add only conversations.summary_source; KB usage tables, tracker, MCP and subscriptions are unchanged.
- `features/llm-runners.md`: server.ts:804-814 retries summary calls through configured Claude; RemoteLlmClient and runner wire protocol are unchanged. Summary details remain in server-internals.
- `features/make-browser.md`: chat.ts changes only summary persistence/mapping and server.ts changes summary wiring; Make browser binding and authorization are unchanged.
- `features/manual-qa.md`: schema/database/server changes concern summaries only; QA tables, contracts and Kanban bridge are unchanged.
- `features/merge-runner.md`: schema/database/server changes concern summaries only; merge persistence, admission and bridge are unchanged.
- `features/playwright-reader.md`: types.ts adds optional summary source and database.ts adds its column; browser target selection, routes and screenshots are unchanged.
- `features/qa-stage-runs.md`: schema/database/server changes concern summaries only; QA stage persistence, subscriptions and transitions are unchanged.
- `features/releases.md`: Compose changes only owner image pins in 2dd38b0b; 2b9bba5e changes summary schema/wiring. Release orchestration and gate scripts are unchanged.
- `features/task-autopilot.md`: schema/database add only summary_source; task/QA transitions and autopilot persistence are unchanged.
- `features/task-preparation.md`: schema/database/server changes concern summaries only; readiness contracts, task persistence and preparation bridge are unchanged.
- `image-retouch.md`: types.ts/chat.ts/server.ts changes concern summaries only; retouch admission and historyFiles are unchanged.
- `llm.md`: conversationThread.ts:43-60 uses deterministic fallback after refresh; verified persisted boundary, source, skipped refresh and existing admission behavior against the updated topic.
- `machines.md`: schema/database/chat.ts changes concern conversation summaries only; machine repositories, agent commands and policies are unchanged.
- `projects.md`: types.ts and schema/database changes concern summaries only; project contracts and task/board transitions are unchanged.
- `server-internals.md`: conversationSummary.ts:4-168 verifies prompt/output limits, oldest-first batches, one secondary attempt, timeout, stdout diagnostics and background retry threshold.
- `shared.md`: types.ts:872-878 adds optional model|fallback source; added its compatibility semantics, including absence on successful model summaries.
- `stt-runner.md`: Compose changes only Make/Kanban image pins; server.ts changes only summary wiring. STT protocol, resources and lifecycle are unchanged.
- `testing-operations.md`: 2dd38b0b changes only Make/Kanban images in its tracked Compose file; gate scripts and Vitest configuration are unchanged.
- `tts-runner.md`: Compose changes only Make/Kanban image pins; server.ts changes only summary wiring. TTS protocol, resources and lifecycle are unchanged.
- `ui.md`: types.ts and chat.ts expose optional summary source; owner UI code is not in this diff. Updated clients.md describes the contract without claiming a rendered label.

## Validation

Run the configured KB touch at implementation HEAD, regenerate the index and
verify strict freshness again after the documentation commit. The workflow
reruns its project gate; this repair changes documentation only.
