---
title: E07 browser integration
date: 2026-09-28
machine: alexeys-macbook-air-2
author: Codex
---

# E07 browser integration

Implemented exact-origin REST/WS admission, the SDK browser session exchange,
live parent-authority checks, chat-only socket handshakes/subscriptions, and
tenant-checked authenticated uploads. Delegated handles remain opt-in, scoped
to one conversation and subject to live grant revocation. Added a pinned E02
external host and real Chromium consumer suite to the Core application catalog.

Documented the browser/Identity/SDK boundary and operator commissioning in
docs/browser-chat-integration.md and docs/kb/clients.md.

Verification includes server typechecking, Shared's 822 tests, 20 focused
server/authorization tests and 19 application-gate planner tests. The required
npm gate exits 255 in this sandbox before checks; the browser suite fails at
the allocated Core port with loopback EPERM. Those checks require the delivery
supervisor. No runtime service, commit, publication or deployment was left.

Final compatibility coverage includes the 23 existing REST authentication tests, E02 public Bearer and paired backend credentials, parent-expiry capping and rejection of mismatched users.
