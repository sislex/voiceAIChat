---
title: stand-preview-inspector-session
date: 2026-10-30
machine: pc-radvilovich-tailae39a6-ts-net
author: voiceAIChat agent
---

# stand-preview-inspector-session

## Changes

- Forward the authenticated lease request cookie through previewInspectorScript to Core's Reader proxy.
- Return an empty 502 for non-2xx executor script responses.
- Cover cookie/origin forwarding, failed upstream statuses, and server wiring with a successful Reader HTTP fixture.

## Verified findings

- Core requires a session for the internal /api/preview/inspector.js request; forwarding only parentOrigin results in 401.

## Updated topic

- docs/kb/server-internals.md#dev-stand-access-proxy

## Strict-check reconciliation after 7eea67be

The strict check listed 20 topics, each invalidated by the single implementation
commit 7eea67be. Reviewed each topic's frontmatter areas and relevant content
against that commit's complete runtime diff: server.ts changes only the
previewInspectorScript callback; standProxy.ts changes its dependency signature,
cookie forwarding and non-2xx handling. Every listed topic overlaps that diff
through server.ts; none of their other areas changed in this commit.
Authentication and Reader/Kanban registration were also checked in server.ts.
The previous server-internals update already describes the implementation.

| Topic | Evidence and reconciliation |
| --- | --- |
| agent-api-access.md | API-token issuance and Bearer admission are unchanged; the internal stand request forwards a session cookie. |
| architecture.md | Reader ownership/modes are unchanged; server.ts still registers remote or embedded Reader at 1626–1628. |
| clients.md | Static Core UI and Android distribution are unchanged; no client artifact or route registration changed. |
| data-auth.md | Reviewed authenticateRaw/registerAuthGuard and standSession; documented the internal request's session boundary. |
| deploy.md | Reviewed stand preview deployment description; no port, environment, Compose or deployment changes. |
| features/ci-runner.md | CI contracts, runner transport and Kanban registration are unchanged. |
| features/kanban-assistant.md | Widget tools and Kanban adapters are unchanged; no orchestration behavior changed. |
| features/kb-usage.md | createKbUsageTracker wiring and KB telemetry sources are unchanged. |
| features/llm-runners.md | Remote/unconfigured LLM client selection is unchanged. |
| features/make-browser.md | Added executor authentication and non-2xx handling, linked to the existing stand proxy topic. |
| features/manual-qa.md | QA contracts, persistence and Kanban execution boundary are unchanged. |
| features/merge-runner.md | Merge contracts and Kanban proxy boundary are unchanged; no gate command was modified. |
| features/qa-stage-runs.md | QA-stage contracts, persistence and event forwarding are unchanged. |
| features/releases.md | Release contracts, artifact pins and deployment scripts are unchanged. |
| features/task-preparation.md | Preparation persistence and remote/offline Kanban selection are unchanged. |
| image-retouch.md | Retouch admission and processImageRetouch wiring are unchanged. |
| llm.md | Turn, session, prompt and machine-command behavior are unchanged. |
| stt-runner.md | RemoteSttClient configuration and lifecycle are unchanged. |
| tts-runner.md | RemoteTtsClient configuration and lifecycle are unchanged. |
| ui.md | Frontend ownership, asset routing and release wiring are unchanged. |

All 20 topics are touched through the configured KB CLI after this review.
The strict check is rerun after committing to catch cross-topic invalidation.

## Scope

- The server wiring test stubs the Reader script response while retaining Core authentication and HTTP proxying. Reader package behavior is owned separately.
