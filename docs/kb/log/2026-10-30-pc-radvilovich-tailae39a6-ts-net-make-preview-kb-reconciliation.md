---
title: make-preview-kb-reconciliation
date: 2026-10-30
machine: pc-radvilovich-tailae39a6-ts-net
author: voicechat-ci
---

# make-preview-kb-reconciliation

## Cause and scope

Strict freshness found 23 topics invalidated by 78f28530 and one pre-existing
topic invalidated by 883a572a. The feature commit updated its Make and stand
topics but not the other topics tracking the shared composition files.
No gate command, freshness rule or area mask was weakened.

## Evidence used for reconciliation

Topic frontmatter and the relevant behavior sections were compared with their
tracked changes. The complete runtime diff in the affected topic areas is:

- S: `apps/server/src/server.ts:703` adds a stand executor callback fetching
  the Reader script with the encoded lease parent origin and no-store;
  line 1762 forwards conversationId to preview result resolution.
- T: `apps/server/src/turns.ts:979-1003` adds the Make-only, non-delegated
  preview branch and prompt; the bound Reader branch retains priority.
- L: `packages/shared/src/llm.ts:110` adds make-preview to previewSurface.
- K: 883a572a changes only `packages/kb-tools/package.json` from 0.1.0 to
  0.1.1 within the project-knowledge-base areas. The checker at
  `packages/kb-tools/kb.mjs:127-154` excludes same-topic commits as documented.
- The host subscriptions at `server.ts:1743-1772` still keep board,
  preparation, QA, release, KB usage and widget channels separate.
- `llm/remoteClient.ts:200-213` spreads the full request into the runner body.
- `readerBridge/localCore.ts:57-69` preserves Reader capability admission
  and maps Make relay disconnect/timeout errors to make_preview_closed.

| Topic | Tracked changes reviewed | Result |
| --- | --- | --- |
| agent-api-access | S | API token issuance, bearer/session checks and revocation are unchanged. |
| architecture | S, T | Core composition and process-global turns remain; preview execution still uses owner contracts. |
| clients | S | Core UI artifact/Android distribution and Desktop packaging are unchanged. |
| data-auth | S | Identity, tenancy, DB and billing admission are unchanged. |
| deploy | S | No environment, Compose, release or deployment behavior changed. |
| features/ci-runner | S | CI bridge and run subscriptions are unchanged; Make chat preview is not a CI browser mode. |
| features/kanban-assistant | S, T, L | Widget context and Kanban tool assembly are unchanged; new branch is explicitly Make-only. |
| features/kb-usage | S, T | KB token registration, auto-context and telemetry remain separate from preview. |
| features/llm-runners | S, L | Documented the additive surface and complete request forwarding. |
| features/manual-qa | S | QA bridge/persistence and owner execution boundaries are unchanged. |
| features/merge-runner | S, T | Merge run feed and owner execution remain unchanged; no merge turn path was edited. |
| features/project-knowledge-base | K | Version-only release; documented indexing and freshness behavior still hold. |
| features/qa-stage-runs | S | subscribeQaStages remains wired to Kanban. |
| features/releases | S | subscribeReleases and release application scripts are unchanged. |
| features/task-preparation | S | Preparation subscriptions, notifications and owner execution are unchanged. |
| image-retouch | S | Retouch admission, attachment reads and saving were not changed. |
| llm | S, T | Removed the obsolete Make exclusion and documented preview token, surface and prompt. |
| machines | T | Machine selection, remote policy and filesystem tooling are outside the edited branch. |
| projects | T, L | Project/task prompt context and Kanban transport are unchanged. |
| protocol | L | Documented Make use of existing preview frames and Core conversation correlation. |
| shared | L | Documented the additive three-value surface union. |
| stt-runner | S | RemoteSttClient selection and STT session transport are unchanged. |
| tts-runner | S | RemoteTtsClient selection, FIFO and resource lifecycle are unchanged. |
| ui | S, T | UI artifact ownership remains independent; Core changed turn/relay assembly only. |

## Validation

`npm run kb:index`, `npm run kb:check -- --strict` and `git diff --check`
passed before committing. Strict mode reports all topics fresh, valid links
and package coverage. The workflow owns the full project gate retry.

