---
title: delivery-source-fencing
date: 2026-09-25
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# Delivery source fencing

The controlled detached Core launcher now accepts a protected immutable authority
envelope, compares the expected previous runtime under its existing host lock,
and verifies the live lease before Git/Docker commands and successful completion.
Reconciliation requires renewed authority for the same immutable transition.

Disposable launcher fixtures cover success, revocation before/after the first
effect, input mutation, previous-runtime mismatch and renewed reconciliation.
The envelope contract is documented in `docs/delivery-release-adapter.md` and
`docs/kb/deploy.md`. No production deployment or stage acceptance occurred.
