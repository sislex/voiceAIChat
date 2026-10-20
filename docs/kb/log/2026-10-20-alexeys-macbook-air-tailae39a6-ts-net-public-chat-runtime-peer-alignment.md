---
title: public-chat-runtime-peer-alignment
date: 2026-10-20
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# public-chat-runtime-peer-alignment

## Changes

- Integrate the immutable Web Reader release that fixes MCP upload transport
  limits while preserving the decoded file boundary and authentication.
- Validate independently versioned owner/frontend manifests against their
  respective package metadata, the same source commit and every asset digest.
- Align Core's component-runtime workspace with its published 1.4.0 source.

## Findings

- Owner system fixtures overlay an archive after installing the pinned Core
  graph; passing their runtime checks does not establish npm peer compatibility.
- Runtime 1.4.0 has exactly the current eight Core source files, but historical
  runtime 1.0.1 lacks the newer shared-service/MCP APIs. Lowering a Reader peer
  requirement would misrepresent that older release.
- Billing's exact runtime 1.0.1 peer needs an immutable metadata correction;
  ordinary Core installation and installed-owner acceptance remain required.

## Documentation

- `docs/kb/testing-operations.md`
- `docs/kb/shared.md`
- `docs/plans/public-chat-v1.md`

## Remaining release work

- Bind final owner artifacts and the Core commit to successful combined,
  performance and installed-owner checks, then validate the coordinated local
  stand. Keep the existing full-feature production deployment unchanged.
