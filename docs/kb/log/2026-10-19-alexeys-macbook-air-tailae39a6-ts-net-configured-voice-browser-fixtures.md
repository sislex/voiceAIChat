---
title: Configured voice browser fixtures
date: 2026-10-19
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# Configured voice browser fixtures

The pinned optional-voice UI correctly hides the manual setup launcher when no
voice module is configured. Two existing Core browser cases assumed the launcher
would always exist, so the combined gate exposed an invalid test precondition.

The diagnostic/progress cases now use an explicitly configured loopback STT
fixture returning 503. They retain their existing assertions and also verify
Core reports configured but unavailable voice. A separate real Core/browser case
restarts without voice endpoints and checks both launchers stay hidden while
saved onboarding progress and theme remain intact.

The absence assertions wait for a nondefault persisted theme and the actual
unavailable TTS diagnostic to render, avoiding a false pass during bootstrap.
The required changed-file rerun passed all five enabled scenarios; the existing
Electron opt-in remains skipped in the browser-only run.

Knowledge: docs/kb/testing-operations.md. The implementation belongs to Core UI;
Core owns this capability-to-published-renderer integration check.
