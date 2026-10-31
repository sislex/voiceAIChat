---
title: production-frontend-pins
date: 2026-10-31
machine: pc-radvilovich-tailae39a6-ts-net
author: voiceAIChat agent
---

# production-frontend-pins

## Changes

Production now prefers pinned frontend archives unless VC_APPLICATION_FRONTENDS_OVERRIDE=1. Development retains local owner overrides. Startup logs identify the source and manifest version/commit. Server integration tests cover both environments, explicit opt-in, inactive owners and startup metadata; route tests cover unpinned sources and missing pinned artifacts.

## Verified findings

The previous gateway always preferred configured sources for local owners, allowing old containers to replace pinned artifacts. UI manifest versions need not equal npm owner versions.

## Knowledge topic

- docs/kb/ui.md — independent product panel artifacts

## Strict freshness reconciliation after 242d084b

Reviewed the stale-topic areas against the complete code diff of 242d084b.
The only server.ts change passes the frontend override policy at line 1958;
config.ts adds that policy, and routes/applicationFrontends.ts implements it.
The other tracked subsystem implementations have no changes in this commit.
The evidence map below records why each topic was touched.

| Topic | Verification and result |
| --- | --- |
| agent-api-access | server.ts frontend registration changed; Identity session/token admission and REST/WS authentication did not. |
| clients | config.ts adds only applicationFrontendsOverride; Core UI, Android and Desktop distribution are unchanged. |
| data-auth | server.ts frontend registration changed; database, integration tokens, authorization and billing code did not. |
| deploy | config.ts and server.ts now prefer pinned production frontends; corrected the deployment application profiles section. |
| features/kanban-assistant | WidgetContextStore registration and registerKanbanProxy remain unchanged; the frontend policy does not change assistant tools. |
| features/kb-usage | registerKbRoutes/registerKbMcp and telemetry wiring remain unchanged. |
| features/llm-runners | config.ts adds only frontend policy; injected/remote/unconfigured LLM client selection remains unchanged. |
| features/make-browser | server.ts only changes frontend registration; browser-session binding, turn tokens and preview surfaces remain unchanged. |
| features/manual-qa | Kanban proxy and QA persistence/contracts remain unchanged. |
| features/merge-runner | Kanban proxy, merge contracts and run-feed wiring remain unchanged. |
| features/qa-stage-runs | subscribeQaStages wiring and QA persistence remain unchanged. |
| features/task-preparation | remote/offline Kanban selection and preparation proxy remain unchanged. |
| image-retouch | processImageRetouch admission, history reads and output persistence remain unchanged. |
| llm | client selection, turn assembly and remote MCP registration remain unchanged. |
| protocol | routes/applicationFrontends.ts changes source selection for manifests and assets; corrected the application frontend gateway section. |

No areas or gate rules were weakened. Updated topic freshness only after this
comparison; deploy/protocol receive substantive corrections in the same repair.
