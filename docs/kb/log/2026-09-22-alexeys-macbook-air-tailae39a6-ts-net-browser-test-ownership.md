---
title: browser-test-ownership
date: 2026-09-22
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# Browser test ownership

Moved 67 detailed browser assertions in six suites to their owner repositories:
Playwright Reader (29), Web Reader (30), and Core UI shell layout (8). Core keeps
four panel-loading smoke checks and its existing host/transport/authentication
integration. Owner tests use pinned Core fixtures, never neighboring checkouts.

Added separate system/release gates, immutable owner selection, installed-artifact
acceptance, failure propagation tests, and release-center integration. Owner CI
and packaging include system acceptance. Documentation records the ownership and
fixture modes in testing-operations, UI, Reader and release articles.

The migrated layout fixture previously re-inserted a legacy Bearer token on every
reload, causing competing cookie/CSRF sessions. Seed it once per browser session;
all eight geometry/navigation assertions then pass without weakened expectations.

Validation and timings are recorded in docs/plans/browser-test-ownership.md.

Installed-artifact acceptance found a second pre-existing fixture race: queue size
did not prove the active evaluation had begun. The owner cancellation test now
uses an HTTP latch and checks successful completion, preserving cancellation and
final user-input assertions. All 30 Web Reader system cases then passed.
