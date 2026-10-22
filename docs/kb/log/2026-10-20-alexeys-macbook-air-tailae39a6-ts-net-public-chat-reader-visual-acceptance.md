---
title: public-chat-reader-visual-acceptance
date: 2026-10-20
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# public-chat-reader-visual-acceptance

## Changes

- Documented visual-enabled Reader acceptance and retained the failed Core
  system attempt separately from the successful owner correction.
- Applied the verified official Web Reader 1.3.4 release through Core's canonical
  composition command, including its provenance-only contracts archive.

## Findings

- Streaming hosts use `GET /frames` and do not promise future screenshot POSTs.
  Visual readiness must observe a visible, refreshed, decoded image; control
  ownership does not itself imply changed page pixels.
- Web Reader 1.3.4's canonical pack passed all 31 system checks on immutable Core
  `0d04afc3febdb0fcca48f167de3f2c5adacc9a21` with visual capture enabled. Both
  trusted-origin and manual-control PNGs were independently inspected.
- The owner runtime implementation and 11 contract payload files are unchanged.
  The compiled frontend registration changes only its source commit.
- Strict lockfile refresh and `npm ci --strict-peer-deps` passed without further
  lockfile changes. All 125 runtime and 12 contracts archive files match the
  installed bytes, including frontend integrity and source provenance.

## References

- `docs/kb/testing-operations.md`, extracted application test ownership.
- `docs/plans/public-chat-v1.md`, published owners and prepared candidates.

## Remaining work

- Renewed complete Core validation and stand acceptance remain separate required
  steps; the owner pack is not evidence of their completion.
