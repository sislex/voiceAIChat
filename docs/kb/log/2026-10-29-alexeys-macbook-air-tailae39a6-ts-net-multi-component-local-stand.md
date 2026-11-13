---
title: multi-component-local-stand
date: 2026-10-29
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# multi-component-local-stand

## Changes

Added prepared source overrides, component routing and repository-scoped delivery. Primary worktree paths remain compatible; secondary paths include the component.

## Documentation

deploy.md, server-internals.md

## Validation scope

Local automated tests cover the new behavior. Live acceptance of core, core-ui and
make on http://127.0.0.1:25273 remains **NOT COMPLETED**. Passing gates does not
replace that acceptance. No verified authorization method is available; the
authorization decision has been escalated separately. No account, authentication
configuration or secrets were changed. No acceptance executor has been assigned.

## SISL-10797 delivery

The task runner delivers these commits from branch `SISL-10797`; this run did not
push them and did not execute a release:

| Repository | Implementation commit |
| --- | --- |
| sislex/voiceAIChat | f43bcd8e3a2ff65cba816c40ed438f9dcf7bdb6b |
| sislex/make | ddc9aa1d54bcf827214c3830bd4f84326a92a9b4 |
| sislex/sislexa-kanban | e1738aa94c46b870adeb176efff7d50ce90c039c |

The stand panel is implemented in Make and embedded by Core UI. The
sislexa-core-ui owner checkout has no implementation changes for this task.
Publishing or pinning dependency versions and loading the coordinated changes
into the dev instance are integration work, not performed by this run.

## Automated validation evidence

- Core: `env -u VC_APPLICATION_VERSION -u VC_APPLICATION_COMMIT -u VC_RELEASE_VERSION -u VC_RELEASE_COMMIT npm run gate:fast` exited 0.
  Server: 221 test files passed, 4 skipped; 2391 tests passed, 40 skipped.
  Server build passed. Knowledge: 4 files / 19 tests passed; typecheck and build
  passed. Prepared-source launcher tests passed (5 tests).
- After the last Core adjustments, server typecheck and 137 targeted tests passed
  (makeStand 78, coreRpc 15, standWorkspace 24, standDeliveries 20).
  Three more RPC cases were subsequently added; coreRpc passed all 18 tests and
  server typecheck passed again. The full fast gate was not repeated after those
  final adjustments.
- Make: `env -u VC_APPLICATION_VERSION -u VC_APPLICATION_COMMIT -u VC_RELEASE_COMMIT npm run gate:fast`
  exited 0: 321 selected tests, 67.1 seconds; all 3 frontend artifact checks passed.
  Initial frontend JavaScript: 1,462,751 bytes against the 1.5 MB gate.
- Kanban: `npm run gate:fast` exited 0: 54 selected tests, 12.6 seconds.
- KB touch, log and index updates were completed in the three changed repositories.

Earlier Core attempts encountered inherited service version metadata and a
command timeout. The successful Core gate above used the cleared environment
and was observed through completion (exit code 0).

## Live verification procedure — pending

Prerequisites: the integrator loads the coordinated development changes and
resolves dependency pins. An authorized access method must first be confirmed
through the separately escalated decision. Do not create accounts, change
authentication or search for secrets to unblock this procedure. Do not release.

1. Open http://127.0.0.1:25273, select project Sislexa and one Make conversation.
   Record its full UUID, first eight UUID characters, local stand name and
   machine. Use the same conversation throughout the checks.
2. Bind a local stand with core as primary. Use “Подключить компонент” to attach
   make and core-ui. Record each component, branch, phase and working-copy path.
   New local branches must be `make/conversation-<id8>`. The primary checkout
   keeps the existing conversation path; secondary paths have the component
   suffix. Wait for the attached components to be ready.
3. Query Git status separately for core, make and core-ui before editing. Record
   any existing changes and preserve them. Confirm each operation selects the
   corresponding working copy.
4. In this conversation ask the assistant, explicitly targeting component
   `make`, to change a harmless visible Make UI/API string to a unique marker.
   Read the changed file through the component-aware file tool and record its
   absolute path. Reload the conversation stand preview and confirm the marker
   is visible. Confirm the change is in the conversation's Make working copy,
   not the stand-owned `src/make` checkout.
5. Repeat the same marker check for a visible Core UI string with component
   `core-ui`, then a harmless Core API response string with component `core`.
   Record the file path and rendered response for each. All three changes must
   be visible on the same conversation stand.
6. Run status, commit and push separately for each component, selecting only
   the intended marker files. Record commit IDs and upstream branches in
   sislex/make, sislex/sislexa-core-ui and sislex/voiceAIChat. Verify branches are
   `make/conversation-<id8>`; do not push protected branches. This runtime
   acceptance check is distinct from the task runner's SISL-10797 delivery.
7. Select each touched repository in the stand delivery panel and submit its
   delivery. Record the resulting Kanban task IDs, repository, branch and head
   commit; confirm every touched repository is represented.
8. Detach or reset a secondary component and verify the other live components
   remain attached and functional. Reattach it and check its working copy and
   branch. Confirm non-local stands still reject secondary live attachments.
9. Remove only the temporary marker edits with explicit inverse edits or revert
   commits on the conversation branches, preserving unrelated work. Retain
   timestamps, paths, commit/task IDs and UI/API evidence for the observations.

Every step above is pending live execution. The reachable health endpoint and
an unauthorized projects response establish neither a usable session nor
successful acceptance.
