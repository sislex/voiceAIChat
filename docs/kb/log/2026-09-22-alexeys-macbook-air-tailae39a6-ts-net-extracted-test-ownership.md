---
title: Extracted application test ownership
date: 2026-09-22
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# Extracted application test ownership

## Implemented

Web Reader PR #3 (`00f63e8ac4d384a8cd8c4241fb6cfe1d96a7f47f`) now owns 18
Chromium suites copied from Core with only local import/path changes. A normalized
file comparison verified preservation of every assertion and fixture. Its canonical
gate passed 885 workspace tests, builds, and all 688 browser cases. The first
owner-only run exposed `import.meta.resolve` under Vitest; the fixture now resolves
its immutable shared snapshot through `createRequire`, with no Core path fallback.

Local story accessibility discovery, UI providers and serious/critical axe checks
now run in each owner repository. Required product-state checks moved with them.
All five owner gates passed before removing discovery and copied tests from Core.
Image Studio and Identity GitHub gate checks also passed before merge.

- make: https://github.com/sislex/make/pull/3 (`370d4afe132db77c3d8b544819bd0fe96cf6c20d`).
- playwrightreader: https://github.com/sislex/playwrightreader/pull/3 (`c0b1a5b7c72951342c6b068862efa0da0f4abdea`).
- image-studio: https://github.com/sislex/image-studio/pull/29 (`c74493b69b6e2ab5264f3d458570444f0e0f7413`).
- identity: https://github.com/sislex/identity/pull/5 (`18acd099128aa23fbf2f4325d5ddeee8e10041a4`).

Core removes the 18 suites, three Image Studio story re-export shims, external
story globs and external required-state entries. Core retains integration coverage
for server/WS/project-resource behavior and public host widgets. Knowledge is in
`testing-operations.md`, `ui.md` and `docs/plans/extraction-completion.md`.

## Remaining

Both canonical Core gates (`npm run gate:fast`, then `npm run gate`) exited 0.
The final browser pass ran 13 suites / 119 cases; the 688 owner browser cases no
longer run in Core. Typechecks, workspace tests, frontend/Storybook/Electron builds
and route budgets passed. PR publication follows this recorded validation. The adapter workspaces still invoke
owner internal unit checks and builds; removing those adapters and switching to
independent artifacts remain required, as does the LLM Runner boundary cutover.
This is an ownership increment, not completion of all extractions.
