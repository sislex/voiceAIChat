---
title: chat-457-shell
date: 2026-09-13
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# chat-457-shell

## Changes

Implemented user-scoped command history, notification retention/read state, system theme initialization, sidebar pins/project groups/search/swipe, connection episodes and retry, three configurable shortcuts, mobile navigation, grouped/paused toasts with reversible local archive/hide actions, and a per-user four-step tour.

Added the required shell story surfaces and TC1–TC9 coverage markers. Extended Development Brief regressions with TC11–TC13: strict complete JSON, absent/string/null question links, incompatible types, and all four null links with preservation and idempotence assertions.

## Verified findings

The command registry is exported by `@voicechat/ui-foundation/runtime`; the previous UI KB paths were stale. The current preparation parser and prompt already implemented strict JSON and nullable-link normalization, so the change extends their regression coverage. Chat archival and card hiding are local visibility preferences, not server deletion operations.

## Documentation

- `docs/kb/ui.md`
- `docs/kb/features/task-preparation.md`

## Validation

`npm run gate:fast` passed on 2026-09-13 with exit code 0. Its selected checks included workspace types/tests, frontend and Storybook builds, and 28 browser suites with 784 passing tests. The 75 preparation regressions and 11 toast tests passed; App and story DOM tests included axe checks.

Chromium checks verified the saved system theme before App content, 390px layout, 200% zoom, real socket loss/retry/recovery, accessible More navigation, and toast separation from bottom navigation. Screenshots were visually reviewed. Existing Make and reader regressions passed after reserving shell space in mobile splits and marking returning-user fixtures explicitly; independent model/embedded browser sessions skip their first-entry tour through its visible control. TC9 separately verifies first entry, completion, skipping and user isolation.
