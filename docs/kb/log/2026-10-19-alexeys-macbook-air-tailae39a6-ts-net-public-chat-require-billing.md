---
title: public-chat-require-billing
date: 2026-10-19
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# Require Billing for public chat

Core accepts `VC_CHAT_REQUIRE_BILLING=true` and refuses startup when no managed
Billing dependency or injected Billing transport is configured. This prevents
an incomplete public deployment from falling back to unaccounted legacy turns.
Existing installations retain their default behavior.

Documented in `docs/kb/deploy.md`. The focused missing-dependency test and
`npm run gate:quick -- --base a42bdd4fb65d78be8be61cdecfb8ebdd908d1677` passed;
the quick gate expanded to the complete Core gate because Compose changed.
Stand wiring and real accounting acceptance remain pending.
