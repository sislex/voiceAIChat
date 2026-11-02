---
title: make-service-storage-authorization-merge
date: 2026-10-31
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# make-service-storage-authorization-merge

## Changes and evidence

Reviewed Core merge SHA `49b74141` against `origin/dev` and the supplied task
diff. Extended the existing Make service storage section in
`docs/kb/data-auth.md`; no duplicate storage topic was created.
The topic's previously tracked areas have no source changes after its prior
`d5140cd7` marker. Reviewed the newly tracked component-runtime transport,
registry and credential-preservation test before touching the topic.

Core validates browser cookies, replaces incoming identity headers with a
five-minute Make delegation (sid null), Core ID and paired service credential,
and authenticates shared whoami from outer headers. Registry requests select the
Core URL and credential by coreId. Managed fetchImpl replaces Authorization;
publicFetchImpl verifies the dependency while preserving supplied credentials.

## Lookup and validation

No tracked data-storage.md exists in this Core checkout, and the installed Make
package contains no such file. The module map assigns Make storage to the make
owner; the existing Core authorization section now provides that lookup result.
The Core integration test uses a mocked Make endpoint and two fake storage
nodes; it does not establish two-Make-instance stand acceptance.
Updated topic freshness, generated the session log and regenerated the index.
Strict KB validation and git diff --check passed.

## Unverified owner evidence

The installed Make sharedServer still contains the old session/MCP/single-Core
guard. Inclusion of fix/storage-cookie-session, Make service storage wiring and
the real stand's shared files/UI result cannot be established from this checkout.
These remain explicit evidence gaps rather than claims of successful acceptance.
No code, commits or pushes were made.
