---
title: identity-sign-in-ticket-snapshot
date: 2026-10-19
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# Identity sign-in ticket snapshot classification

Identity 1.5.1 adds identity_sign_in_tickets to its schema. Registered the table under Identity ownership and excluded its rows from production snapshots. The existing schema/ownership gates detected the missing classification; their focused rerun passes (12 tests, one configured integration skip). The snapshot tooling checks pass with their existing integration skip.

The full Core gate is required again before promotion. Updated `docs/kb/data-auth.md`.
