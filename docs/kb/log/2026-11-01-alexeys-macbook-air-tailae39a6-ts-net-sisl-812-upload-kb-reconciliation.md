---
title: sisl-812-upload-kb-reconciliation
date: 2026-11-01
machine: alexeys-macbook-air-tailae39a6-ts-net
author: voicechat-ci
---

# sisl-812-upload-kb-reconciliation

## Review scope

The strict check reported 25 topics after `a0f36043`. Its commit-based rows
identify that upload commit; three unavailable checked markers use the date
fallback. Read each topic's metadata/current boundary and compared its tracked
areas with the feature diff against `202e29b9`. Inspected the complete changed
upload parser, coordinator write path, HTTP node client and server route diff.
No runtime or gate command changes are part of this repair.

## Per-topic evidence

| Topic | Verified evidence and disposition |
| --- | --- |
| agent-api-access.md | The server diff adds upload parsing and CORS metadata headers; token issuance, read-only grants, revocation and auth guard wiring are unchanged. |
| architecture.md | Reviewed service.ts:206-268, client.ts:5-73 and node/server.ts:62. Documented the new iterable/putStream boundary and the unchanged node buffering. |
| clients.md | The server parser changes only upload admission. No frontend artifact pin or renderer source changes; documented legacy client compatibility. |
| conversation-groups.md | The only changed tracked file is protocol.ts, with a comment on REST.uploads. Group routes, types and persistence are unchanged. |
| data-auth.md | Reviewed uploadBody.ts and the full upload route diff, plus coordinator transaction/counting/cleanup. Documented quota and CSRF invariants; added new implementation paths to areas. |
| deploy.md | The server diff adds no env reads or bootstrap changes; package.json adds multipart. Documented that the existing storage URL/token configuration remains sufficient. |
| features/ci-runner.md | The tracked server/protocol changes are upload-only. Kanban proxy, run feeds, CI contracts and preparation storage are unchanged. |
| features/kanban-assistant.md | Widget contexts, turn assembly, relay and orchestration contracts are absent from the code diff; only common server/protocol areas triggered freshness. |
| features/kb-usage.md | The server diff does not change kbUsage creation or injection; tracker, query, telemetry and Knowledge package areas are unchanged. |
| features/llm-runners.md | The server's resolveUpload and runner client wiring are unchanged. The existing LlmAttachment base64 leg is independent of the new inbound upload forms. |
| features/make-browser.md | The server diff does not touch browser binding, preview auth or proxying; turns.ts, routes/rest.ts and ChatRepo are unchanged. |
| features/manual-qa.md | Only common server/protocol areas changed, outside QA paths. QA contracts, persistence and Kanban proxy behavior are unchanged. |
| features/merge-runner.md | Only common server/protocol areas changed, outside merge paths. Merge contracts, run delivery and extracted owner responsibilities are unchanged. |
| features/qa-stage-runs.md | Only the upload block/CORS changed in server.ts. QA stage contracts, persistence and bridge subscriptions are unchanged. |
| features/releases.md | Compared the feature commit against its parent across the listed areas: server upload/CORS and a REST.uploads comment only. Build/deploy/gate scripts, release contracts and pins are unchanged; replaced the unavailable checked SHA via CLI. |
| features/task-preparation.md | The server upload route changes do not modify preparation execution, readiness, notifications or Core's Kanban bridge. |
| image-retouch.md | The upload diff retains the 300/20 admission windows and UploadInfo; imageRetouch handler, source authorization and generated-file persistence are unchanged. |
| llm.md | Only server/protocol upload changes intersect areas. resolveUpload, LlmAttachment transport, runner selection and turn/session assembly are unchanged. |
| machines.md | The only changed tracked file is protocol.ts, with a REST.uploads comment. Machine/agent contracts, bindings, registry and remote tools are unchanged. |
| protocol.md | Reviewed fileStorage.ts additions, REST.uploads comment, uploadBody.ts and CORS test expectation. Added request forms, precedence, MIME, limits, CSRF and unchanged response; added fileStorage.ts to areas. |
| server-internals.md | Reviewed scoped parser, stream consumption, storage dispatch and machine fsWrite conversion. Added Core buffering boundaries and multipart completion behavior. |
| shared.md | The shared diff adds only upload request interfaces/constants, their tests and REST.uploads documentation. Added the 32 MiB chat versus 64 MiB service distinction. |
| stt-runner.md | Compared parent-to-feature changes across listed areas; only upload/CORS in server.ts changed. RemoteSttClient wiring and voice protocols/configuration are untouched; replaced unavailable checked SHA via CLI. |
| tts-runner.md | Compared parent-to-feature changes across listed areas; only upload/CORS in server.ts changed. RemoteTtsClient wiring and TTS lifecycle/configuration are untouched; replaced unavailable checked SHA via CLI. |
| ui.md | No owner UI source or artifact pin changed. Added the server-only upload capability and unchanged response/renderer boundary. |

## Validation

Touched all 25 reviewed topics with the configured KB CLI and regenerated the
index. `npm run kb:check -- --strict` exited 0: all topics are fresh and links
and package coverage pass. Used explicit `docs/kb/<topic>.md` paths where a
short name collides with a repository directory. The workflow reruns the
complete project gate; no runtime tests or gate commands were changed.
