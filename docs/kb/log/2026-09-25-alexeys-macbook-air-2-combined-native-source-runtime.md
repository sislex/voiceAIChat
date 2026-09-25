---
title: combined-native-source-runtime
date: 2026-09-25
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# Combined native Core and immutable source runtime review

Combined the recovered immutable paired launcher and private Core fixture patches
with the separately reviewed fenced source recovery/status implementation.
No original worker checkout/index was changed. The complete gate planner run
(`npm run gate:fast`, selecting `gate:all`) passed on the combined standalone
checkout: typecheck, workspace and tooling tests, frontend/Core UI verification
and browser integration, exit 0 in 325 seconds. The independent paired launcher
Linux process suite passed 18/18; reviewed source recovery Linux passed 18/18
previously. No production installation or stage acceptance was performed.

The native macOS boundary separately passed all 189 server suites (2337 tests)
including 20 cleanup tests after Delivery Control exposed the fixed system lsof
executable. The native browser stage remains blocked by Chromium Mach port
registration. An additional readonly SystemAppearance bundle resolved the earlier
AppKit resource error but not that IPC restriction. The successful full owner
gate ran outside that native command sandbox; it is not a full native boundary
pass. Keep the model sandbox intact and use the reviewed owner validation path.

Updated deployment and testing topics preserve both runtime packaging and fixture
isolation guidance. Production data defaults and native sandbox roots remain
unchanged.

Secret review: the full diff scanner flags unchanged historical test-secret
constants and WebSocket template expressions in fixture context lines. These
are synthetic test inputs/source expressions, not private credentials. The newly
added preview fixture now generates its signing value with randomUUID(). The
scanner implementation and permissions are unchanged.
