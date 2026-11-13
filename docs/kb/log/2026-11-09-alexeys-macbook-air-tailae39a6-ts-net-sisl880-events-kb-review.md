---
title: sisl880-events-kb-review
date: 2026-11-09
machine: alexeys-macbook-air-tailae39a6-ts-net
author: voicechat-ci
---

# sisl880-events-kb-review

## Review scope

SISL-880 changes only `kanbanBridge/eventsDelivery.test.ts` in production source
areas (commit `5ceebde17`). The workflow KB gate also requires topics tracking
that directory to be current. Reviewed each affected topic's metadata and Core
boundary against its `checked..HEAD` changes, current repositories, bridge and
session initialization. No gate rules or runtime code changed in this repair.

## Evidence by topic

| Topic | Evidence and result |
| --- | --- |
| architecture | Since `694e6cbd`, its areas contain the seed-helper migration and event-delivery test fix. Runtime bridge contracts and architecture are unchanged. |
| features/ci-runner | `ci.ts` retains CI readers, logs, workspace support and defaults; Kanban workflow writers and `getCiRunLog` were removed. `seed.ts:withCtx` waits for readiness and uses the port lane. Corrected the Core boundary. |
| features/development-preview | Shared preview contracts are unchanged; CI writer removals do not move preview execution back into Core. Current settings reader and remote/off boundary remain consistent. |
| features/feature-preview | Preview port and tunnel callbacks remain in `kanbanBridge/remote.ts`; database facade only loses workflow type exports and gains the independent assistant-mode migration. No preview lifecycle change. |
| features/kanban-assistant | `turns.ts` gates Kanban context and MCP with `isWorkspaceAssistantMode`; documented the Chat-mode exclusion. Widget relay and remote Kanban boundaries remain intact. |
| features/manual-qa | Current `QaRepo` is empty; QA/component/integration workflow methods were deleted from Core repositories. Corrected persistence ownership. |
| features/merge-runner | `claimQueuedMergeRun` and merge workflow writers are absent from Core's CI repository. Corrected ownership; remote run feed remains unchanged. |
| features/qa-stage-runs | QA stage writers are absent from `QaRepo`; `remote.ts` still delivers `qaStage` through `subscribeQaStages`. Corrected boundary text. |
| features/releases | Reviewed `application-gate.mjs` changes: release suites and tooling are separated from development selection. Added the current selection rules; release event transport is unchanged. |
| features/task-autopilot | `autoPilotSnapshot`, `transitionAutoPilotTask` and `recordAutoPilotEvent` were removed from Core repositories. Corrected the stale Core implementation claim. |
| features/task-preparation | Preparation attempts/events/questions and readiness workflow methods were removed from `tasks.ts`. Shared contracts/schema and preparation event relay remain. Corrected boundary text. |
| projects | Reviewed task/schema/facade and seed changes; clarified retained Core readers versus removed workflow writers. |
| server-internals | Reviewed net changes since `91bf61b06`: repository writer removal, test seeds, assistant-mode gating, REST context and stand origin rewriting. Existing user-stand Git/release/research and origin-rewrite sections cover the stand behavior. Added assistant-mode, repository and notification-readiness details. |
| kb-workflow | Since `c79bac7b`, affected changes are the bridge test's seed migration and readiness correction; KB CLI semantics are unchanged. |
| conventions | Reviewed `application-gate.mjs`, `quick-gate.mjs` and package scripts since `97cadc810`. Added development/release selection details and corrected the overly broad `claude.active` readiness advice. |

Notification readiness evidence: `session.ts` sends `claude.active` before
awaiting `resumeQueues` and the agents list. Notification and board listeners
are installed synchronously after the `agents` frame. `remote.ts` emits to
currently registered listeners without replay. The test now waits for that
snapshot before publishing and awaits the expected frames.

## Validation

- Original implementation: focused `eventsDelivery.test.ts` passed 4/4 on
  SQLite and 4/4 on Postgres; `npm run gate:fast` passed before this repair.
- Documentation repair: `git diff --check` passed; `npm run kb:index` passed.
- `npm run kb:check -- --strict` without the workflow overlay reports 19
  pre-existing topics outside this task's areas.
- The workflow's scoped KB check (same metadata/area comparison and child-only
  read overlay, with inactive merge-touch handling omitted) passed with exit 0:
  all scoped topics fresh, links and package coverage valid. All 19 remaining
  topics qualified as pre-existing on `origin/dev`; none were touched or hidden
  by changing gate configuration.
- No implementation or test changes in this repair, so no additional package
  typecheck/build/full gate was launched. The supervisor reruns the workflow.

## Remaining work

No task-specific KB failures remain. Unrelated baseline freshness warnings stay
under the workflow's existing scoped exemption.

