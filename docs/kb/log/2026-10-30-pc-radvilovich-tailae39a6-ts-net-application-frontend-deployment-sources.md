---
title: application-frontend-deployment-sources
date: 2026-10-30
machine: pc-radvilovich-tailae39a6-ts-net
author: voiceAIChat agent
---

# Application frontend deployment sources

## Changes

- Validate frontend source IDs before filtering by deployment.
- Retain overrides for enabled local owners derived from catalog runtime dependencies.
- Cover all four owner panels with local, disabled and external deployment integration cases.

## Verified facts added to the KB

- Frontend IDs differ from deployment application IDs; matching only the frontend ID dropped all four configured panel overrides.
- Unknown source IDs must reach registration validation even with an empty deployment.

## Updated topic

- docs/kb/ui.md, independent product panel artifacts.

## Validation

- Focused frontend and deployment server tests: 18 passed.
- `npm run gate:fast`: passed; server 2425 tests passed (40 skipped), knowledge 19 tests passed, typechecks and builds passed.
