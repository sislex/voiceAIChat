---
title: account-progressive-loading-mobile
date: 2026-09-15
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# account-progressive-loading-mobile

## Work completed

- Split account resources into profile, access, usage, security, and machines
  with tab-aware loading, per-resource retry, and in-page caching.
- Added a structural route fallback and account chunk preloading on menu intent.
- Optimized the profile query with concurrent targeted repository reads and
  moved full machine telemetry to the Machines tab.
- Improved loading, empty, long-list, keyboard, reduced-motion, and responsive
  behavior across the five account tabs.
- Ran 20 review cycles covering ten checks each: request timing, request count,
  caching, failure isolation, empty data, long data, keyboard access, touch
  targets, narrow-layout overflow, and visual hierarchy. The cycles covered
  initial load, each tab, return navigation, period changes, event filters,
  retries, history pagination/export, desktop, tablet, 390 px, 320 px, dark
  tokens, reduced motion, direct routes, chunk loading, server queries, bridge
  contracts, accessibility semantics, and final regression review.

## New facts

- A changing default `Date.now()` used as an effect dependency can repeatedly
  refetch usage while sibling account resources settle.
- Shrinkable children in the column profile flex container collapse the mobile
  tab list to its 1 px border on tall pages.
- `scrollIntoView` for a clipped horizontal tab can also move the vertical page;
  scrolling only the tab list avoids the sticky account header.

## Knowledge base updates

- `docs/kb/ui.md`
- `docs/kb/protocol.md`
- `docs/kb/server-internals.md`

## Open items

- None for the account change. Isolated QA still reports missing local TTS
  catalog resources; those requests are outside the account data path.
