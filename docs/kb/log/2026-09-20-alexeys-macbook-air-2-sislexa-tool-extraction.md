---
title: sislexa-tool-extraction
date: 2026-09-20
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# Sislexa tool extraction

The separate Make, Playwright Reader and Web Reader repositories own their API,
UI, contracts and tests. Web Reader also owns the iframe recorder. Core retains
compatibility adapters and consumes integrity-pinned archives with source commit
metadata. Complete upstream checks run through the adapters; static boundary
checks inspect the installed implementation. Storybook and axe coverage retain
the original story inventory by discovering the installed upstream files directly.
Storybook cannot index re-export-only CSF files; its browser regression passed
after switching discovery to real upstream stories.

Shared UI fixture and Monaco asset imports were made installable without a host
source checkout. Common snapshots record the original commit and a source patch
where necessary. npm's optional UI peer handling conflicted with linked host
workspaces; UI requirements now live in the owned UI package and the root archive
declares only API peers. Independent installations and Docker startup were checked.

Independent repository gates passed with exit 0 after clean installs. Version 1.0.0 tags and GitHub releases were published with source archives. The complete host publication gate passed with exit 0; production cutover is pending.
Knowledge: docs/kb/architecture.md, docs/kb/deploy.md, docs/kb/ui.md.

Published source revisions:

- make: `7fb6727e9ccf28cdb1ee3d421968e5b82b618ca5` (https://github.com/sislex/make/releases/tag/v1.0.0).
- playwright-reader: `04520f8587ba092c977bddcb0c753891d7fb853f` (https://github.com/sislex/playwrightreader/releases/tag/v1.0.0).
- web-reader: `f65719c07ca19f3dea6b20e7409334dd030ab29a` (https://github.com/sislex/webreader/releases/tag/v1.0.0).

Six production-host images built successfully from the published commits. Network-isolated API/frontend smoke containers verified version/commit metadata and frontend SRI, then were removed. The corrected Storybook browser suite passed 14 tests and all three accessibility shards retained 745 passing tests.

A fresh private backup at `/var/backups/voicechat/sislexa-tools-20260919T234739Z`
contains a 381828939-byte Postgres dump with a readable 1100-entry restore list,
operator configuration and previous image identities. Before building the six
images, unused build cache older than 45 minutes was pruned; data volumes and
existing images were preserved. The three new UI asset volumes were seeded from
core 0.1.310, excluding manifests and checking immutable filename collisions.

Reader E2E fixtures now resolve the pinned installed implementation explicitly; all
23 Reader browser suites passed (730 tests). The aggregate gate exposed a Linux-only
Electron executable path, now resolved through the installed package. A complete
route measurement then exposed pre-existing size-budget drift. Eleven initial Web
assets matched production 0.1.310 by SHA-256. The reviewed measurement, fingerprints,
and narrow numerical budget corrections are committed under
`frontend-quality/measurements/sislexa-extraction/`; forbidden initial modules and
measurement validation are unchanged.

The full browser gate exposed a stale-dialog race in the Playwright Reader E2E
workflow. MCP completion does not mean the independently observed panel has removed
the previous prompt. Explicitly waiting for removal and the new alert message
fixed the interaction; all 29 Playwright Reader browser scenarios passed afterward,
including downloads and Make preview recovery.

The browser gate also exposed a genuine 200% zoom overflow: UI Kit's global
important mobile minimum button width beat the navigation's shrink rule. The
scoped width override now has matching priority while minimum height remains.
The real 390px/200% scenario passed, with a screenshot checked. The Make fixture
now owns its Node process and OS-selected port with bounded startup diagnostics;
the Image Studio selection fixture scrolls back from the footer to the canvas
before using pointer coordinates.

After the fixture corrections, all 9 Image Studio browser scenarios passed.
Make's mobile fixture revealed another real CSS specificity defect: the collapsed
desktop two-column grid overrode the mobile one-column layout and hid content in
a zero-width column. Matching specificity fixes Make and Console layouts. All
10 Make browser scenarios then passed, including responsive layout, Monaco
autosave, React/Angular preview, language switching and publication. These shell
CSS corrections fit the reviewed budget without increasing it again.

A refreshed pre-cutover backup at
`/var/backups/voicechat/sislexa-tools-ready-20260920T010101Z` contains the original
operator/checkout configuration, image references and core revision, plus a
381828938-byte Postgres dump with a readable 1100-line restore listing.

Final validation: `npm run gate` completed with exit 0. This includes all workspace
typechecks/tests, production panel/Web/recorder/Storybook/Desktop builds, real
Web/Electron route checks and all 31 application E2E suites (807 tests). The final
route report is retained as `frontend-quality/measurements/sislexa-extraction/verified.json`.
