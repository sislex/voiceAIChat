---
title: sisl-883-kb-gate-repair
date: 2026-11-10
machine: alexeys-macbook-air-tailae39a6-ts-net
author: voicechat-ci
---

# sisl-883-kb-gate-repair

## Review scope and evidence

Reviewed the 21 stale topics whose areas intersect SISL-883, against their
checked revisions and the current tree. The task changes server.ts only by
assigning the existing browserRunner.start payload to startInput; the selected
URL, Reader ownership/capability checks and binding order remain unchanged.

- agent-api-access, clients and features/llm-runners: the area delta is Make
  stand browser/research wiring in server.ts; token APIs, client distribution
  and runner transport are unchanged.
- architecture: reviewed server.ts, turns.ts and Make/Core UI pin updates.
  Existing owner boundaries still apply.
- data-auth and ui: reviewed conversation mode schema/mapping/setter, REST
  settings/context projection, removed Kanban workflow repository methods,
  Make proxy/RPC body limits and server wiring. Added the missing mode and
  transport-limit explanations.
- features/kb-usage: removed the obsolete local kbHit implementation claim;
  documented Chat mode overriding the saved KB mode.
- features/ci-runner, features/manual-qa, features/qa-stage-runs,
  features/task-preparation: retained Core readers/contracts and extracted
  Kanban workflow ownership agree with current repositories. Reviewed CI
  method removal, notification test synchronization and the Make Compose pin.
- features/kanban-assistant, features/merge-runner and llm: reviewed turns.ts
  workspace-mode gates and embedded-versus-Reader Make browser routing.
  Existing mode and owner-boundary descriptions remain applicable.
- features/releases: reviewed the Make browserTarget RPC forwarding and
  Compose image pin; neither changes release workflow ownership.
- image-retouch: conversation-mode contract additions and chat mapping do
  not change retouch source ownership or admission.
- stt-runner and tts-runner: server changes concern Make; Compose changes only
  the Make image. Voice transports and endpoints remain unchanged.
- deploy and testing-operations: checked fullSharedServices, loadShared,
  copied component routing and the full shared process fixture. Added the
  fixture's evidence and limits to testing-operations.
- features/make-browser: documented the unchanged window.url payload and
  pinned-contract typing accommodation.

Used the configured KB CLI to touch these topics after review. No implementation,
test, gate configuration or baseline freshness exceptions were changed.

## Validation

- npm run kb:index: exit 0.
- npm run test:files -- apps/server/src/kb/taskInjection.test.ts: exit 0,
  7 tests passed against the actual KB corpus.
- git diff --check: exit 0.
- npm run kb:check -- --strict: exit 1, now only 10 baseline stale topics.
  For each, Git verified unchanged topic metadata, no task/worktree/untracked
  changes in its areas (excluding the generated index), and area commits
  between its checked SHA and origin/dev. They match the existing workflow's
  baseline-exemption conditions: conventions, conversation-groups,
  features/feature-preview, features/playwright-reader,
  features/project-knowledge-base, features/release-gate-plan, machines,
  projects, protocol and shared.
- The CI targeted-test tool is not exposed in this session; the concrete test
  file ran through remote:bash and the repository test-files runner instead.
  This repair changes only Markdown; no TypeScript package was changed.
  The supervisor reruns the authoritative project gate.

## Operational follow-up

Live stand migration, removal of the manual launcher and cross-service hot-reload
acceptance remain in task e56b1afc-a1af-4947-9a30-a9cbf6d93d79.

