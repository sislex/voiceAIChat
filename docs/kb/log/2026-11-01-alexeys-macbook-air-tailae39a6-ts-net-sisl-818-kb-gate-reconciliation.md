---
title: sisl-818-kb-gate-reconciliation
date: 2026-11-01
machine: alexeys-macbook-air-tailae39a6-ts-net
author: voicechat-ci
---

# sisl-818-kb-gate-reconciliation

## Repair

The project gate failed on KB freshness after `a1a8f8a6`, not a test failure.
Reviewed the 26 topics reported by strict mode and their declared areas before
running the configured touch command. Also updated the thumbnail protocol topic.
No gate logic, runtime code, area masks or tests were changed.

## Evidence map

The review compared each available checked revision with `a1a8f8a6`, restricting
diffs to the topic's areas. Most topics share `server.ts`, `protocol.ts` or
`types.ts`; their only newly uncovered behavior is optional thumbnail metadata.
For the unavailable `98722e6a` marker, reviewed the date-fallback interval from
`bbfe7c7e` (before 2026-10-31) and current voice clients instead.

| Topic | Reviewed evidence and disposition |
| --- | --- |
| agent-api-access | Since dab1b380: server upload metadata and UploadInfo field only; token management/authentication unchanged. |
| architecture | Since 47b29314: full file-storage client/node/coordinator diff and server upload metadata; documented HMAC direct routes, durable part reservations, node copies, streaming and injected preview generation. |
| clients | Since dab1b380: server upload metadata only within the declared areas; Android/frontend distribution unchanged. |
| conversation-groups | Since 8bb433d2: MessageAttachment and UploadInfo optional fields; group repositories, routes and membership invariants unchanged. |
| data-auth | Since df60202a: server thumbnail eligibility helper; inspected coordinator readThumbnail/cleanup and direct upload reservations. Clarified live ACL checks, node capacity versus owner quota, and best-effort post-commit cleanup. |
| deploy | Since df60202a: server thumbnail eligibility helper; checked Sharp generator and existing node startup/configuration. Documented two jobs, byte/pixel bounds, cleanup and cache headers; no thumbnail env variable added. |
| features/ci-runner | Since 30744ae9: server/UploadInfo thumbnail additions in tracked areas; CI contracts, runner, KB adapters and stage selection unchanged. |
| features/kanban-assistant | Since dab1b380: server and UploadInfo thumbnail additions; widget relay/orchestration contracts unchanged. |
| features/kb-usage | Since dab1b380: server upload metadata only; telemetry, KB broker and knowledge implementation unchanged. |
| features/llm-runners | Since dab1b380: server upload metadata only; resolveUpload and runner attachment transport unchanged. |
| features/make-browser | Since dab1b380: server upload metadata only; browser binding, routes and turn assembly unchanged. |
| features/manual-qa | Since dab1b380: server/UploadInfo thumbnail additions; QA contracts, persistence and execution boundary unchanged. |
| features/merge-runner | Since dab1b380: server/UploadInfo thumbnail additions; merge contracts, bridge and turn handling unchanged. |
| features/playwright-reader | Since f1d5fd04c: MessageAttachment thumbnail field only within its areas; browser bridge and screenshot behavior unchanged. |
| features/qa-stage-runs | Since dab1b380: server upload metadata only; QA stage contracts, repository and bridge unchanged. |
| features/releases | Date-fallback review: file-storage catalog/Docker target, application pins, config and server integration; inspected applicationCatalog and shared release/build/deploy paths. Release execution remains owner-managed. |
| features/task-preparation | Since dab1b380: server upload metadata only; preparation persistence, contracts and bridge unchanged. |
| image-retouch | Since dab1b380: server/UploadInfo/MessageAttachment thumbnail additions; original attachment reads and retouch admission unchanged. |
| llm | Since dab1b380: server/UploadInfo thumbnail additions; LLM transport and resolveUpload unchanged. |
| machines | Since c17fb5ae: UploadInfo thumbnail field only within declared areas; machine APIs and policies unchanged. |
| projects | Since f1d5fd04c: MessageAttachment thumbnail field only within declared areas; task contracts, database and board bridge unchanged. |
| server-internals | Since df60202a: inspected direct-transfer config/runtime/routes and thumbnail changes; direct transfer is already documented by 968f31e5. Added decoder validation, limits, shared eligibility and node I/O before thumbnail 304. |
| shared | Since 47b29314: reviewed complete Shared contract diff (fileStorage, UploadInfo, MessageAttachment). Documented resumable/direct/batch/compression additions and clarified single-request versus multipart size limits. |
| stt-runner | Date-fallback review: no changes to STT/session implementation; checked RemoteSttClient's owner protocol import and PCM transport, config/Docker/Compose diff including voice image pin updates. |
| tts-runner | Date-fallback review: no changes to TTS/session implementation; checked tts/client/remoteTtsClient.ts and its owner resource protocol, plus config/Docker/Compose diff. |
| ui | Since dab1b380: server and optional attachment fields; added thumbnail consumer contract without claiming delivery of the separately owned UI. |
| protocol | Inspected routes.ts conditional headers and thumbnail generator; documented weak/list ETags, date precedence, 415 and eligibility semantics. |

## Verified details added

Thumbnail conditional requests still read or generate the derived blob before
evaluating validators. They do not inherit the metadata-only optimization of
ordinary file reads. The availability flag checks MIME and size, not decoding.
Unsupported actual image formats and corrupt image bytes map to 415.
Derived cleanup can leave orphan blobs on node failure while preserving the
committed metadata operation.

## Validation

`npm run kb:index`, `npm run kb:check -- --strict` and `git diff --check`
passed. The workflow will rerun its complete project-gate command; no full gate
was invoked during this documentation repair.
