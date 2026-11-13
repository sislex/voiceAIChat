---
title: sm-47-merge-storage-admission
date: 2026-11-02
machine: pc-radvilovich-tailae39a6-ts-net
author: voiceAIChat agent
---

# sm-47-merge-storage-admission

## Changes and evidence

Reviewed merge 5b13f13f against origin/dev. The runtime diff is the Storage
admission branch in apps/server/src/server.ts and the legacy/shared GET/PUT
regression in apps/server/src/routes/applicationTickets.delegation.test.ts.
Verified token expiry/signature handling in
packages/component-runtime/src/sharedServices.ts.

Updated docs/kb/data-auth.md at the existing Make service-storage lookup and
SM-47 contract: sessionless MCP uses service credential plus signed authority,
not a ticket; current account/tenant checks and scoped-token rejection remain
mandatory. Updated docs/kb/server-internals.md after reviewing its changed
server.ts behavior at the merge SHA. Both topics were touched at 5b13f13f.

## Validation and limits

npm run kb:index, npm run kb:check -- --strict and git diff --check passed.
This documentation-only update did not rerun application tests. The inspected
Core regression calls Storage directly; it does not establish Make's ordering
of authority installation before stand-binding reads. apps/make is absent from
this Core checkout, so that consumer detail requires the Make owner source.
No commit or push was performed.
