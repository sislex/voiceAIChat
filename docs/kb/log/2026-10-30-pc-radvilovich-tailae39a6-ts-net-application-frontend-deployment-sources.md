---
title: application-frontend-deployment-sources
date: 2026-10-30
machine: pc-radvilovich-tailae39a6-ts-net
author: voiceAIChat agent
---

# Application frontend deployment sources

## Changes

- Validate frontend source IDs before filtering by deployment.
- Retain overrides for enabled local owners derived from catalog runtime dependencies.
- Cover all four owner panels with local, disabled and external deployment integration cases.

## Verified facts added to the KB

- Frontend IDs differ from deployment application IDs; matching only the frontend ID dropped all four configured panel overrides.
- Unknown source IDs must reach registration validation even with an empty deployment.

## Updated topic

- docs/kb/ui.md, independent product panel artifacts.

## Validation

- Focused frontend and deployment server tests: 18 passed.
- `npm run gate:fast`: passed; server 2425 tests passed (40 skipped), knowledge 19 tests passed, typechecks and builds passed.

## Post-commit KB reconciliation

Strict freshness reported 21 topics after commit `2f8053a1`. Compared each topic's
tracked areas against that commit: runtime changes are confined to the frontend
registration call and source filter; the other changed server files are tests.
The evidence below records the relevant topic boundary and impact review.

| Topic | Code evidence | Result |
| --- | --- | --- |
| agent-api-access | server.ts:594-599 | Identity authentication/token wiring unchanged |
| architecture | server.ts:1953; deploymentApplications.ts:31-38; routes/applicationFrontends.ts:25-88 | Documented source selection separately from the direct deployment-ID route guard |
| clients | server.ts:1953-1966 | Only product-panel sources changed; Core UI/browser UI and recorder setup unchanged |
| data-auth | server.ts:594-599 | Authentication, delegation and database setup unchanged |
| deploy | server.ts:1953; routes/applicationFrontends.ts:32-43 | Documented frontend IDs versus deployment owner IDs and override fallback |
| features/ci-runner | server.ts:1583 | Kanban proxy wiring and CI contracts/persistence unchanged |
| features/kanban-assistant | server.ts:1009-1010,1583 | Widget context/relay and Kanban MCP wiring unchanged |
| features/kb-usage | server.ts:843,1038,1089 | KB routes, MCP and research registration unchanged |
| features/llm-runners | server.ts:785,1477 | Remote LLM construction and engine selection unchanged |
| features/make-browser | server.ts diff; turns.ts and routes/rest.ts unchanged | Browser-session association and preview routing unchanged |
| features/manual-qa | server.ts:1583,1744 | Kanban proxy and QA subscriptions unchanged |
| features/merge-runner | server.ts:1583 | Kanban execution proxy unchanged; no merge-manager or Shared contract edits |
| features/qa-stage-runs | server.ts:1744 | subscribeQaStages wiring unchanged |
| features/releases | server.ts:1746; applicationCatalog.ts unchanged | Release subscriptions, pins and catalog metadata unchanged |
| features/task-preparation | server.ts:1583 | Preparation still runs behind the unchanged Kanban proxy |
| image-retouch | server.ts:1352 | Retouch processing and its admission code unchanged |
| llm | server.ts:785,1477; turns.ts unchanged | Runner selection and turn execution unchanged |
| protocol | routes/applicationFrontends.ts:25-108 | Documented source selection; manifest validation, MIME, URL checks and cache policy unchanged |
| server-internals | server.ts:1953; routes/applicationFrontends.ts:25-43 | Documented complete map/deployment handoff and validation before filtering |
| stt-runner | server.ts:1115,1700-1702 | STT client construction and session injection unchanged |
| tts-runner | server.ts:1169,1703 | TTS client construction and session injection unchanged |

The freshness command and tracked areas are unchanged. Full workflow validation
is rerun by the workflow after this documentation-only repair.
