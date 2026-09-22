---
title: browser-ui-release-center
date: 2026-09-22
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# browser-ui-release-center

## Completed

- Added official Core UI release discovery, exact tag and archive resolution,
  server-side private asset download, production transfer and activation.
- Added idempotent operation history and container identity/start-time evidence
  for install, rollback and bundled fallback.
- Extended the deployment CLI with a verified inspection response for Release
  Center and operator diagnostics.

## New facts

- The Core UI repository is private, so anonymous GitHub release API requests
  return 404. Core must use `VC_GITHUB_TOKEN` and must not pass it to an agent.
- The immutable asset name contains the semantic version and the first twelve
  characters of the tag's full commit SHA.

## Documentation

- `docs/kb/features/releases.md`
- `docs/kb/deploy.md`
- `docs/plans/independent-browser-ui-releases.md`

## Remaining work

- Update the Core UI owner with the new contract and Release Center controls,
  then publish and validate both Core and browser UI releases in production.
