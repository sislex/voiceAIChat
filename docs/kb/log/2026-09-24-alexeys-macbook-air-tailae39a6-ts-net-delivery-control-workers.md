---
title: delivery-control-workers
date: 2026-09-24
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# Delivery Control B01–B03 acceptance

Audited B01/B02 and implemented B03 in the owner repository. Published
`sislex/delivery-control@c8cb8e3afcc8a9f788be9037a146159069650e22` and deployed its
0.2.0 coordinator release on the LLM Runner host after owner gates, disposable
PostgreSQL migration/API checks, three-worker fault recovery and a real Codex run.
Backed up v1 state before activation. All runner container identities/start times
and healthy states remained unchanged.

Recorded B01–B03 as externally accepted in the durable coordinator state; S0 stays
paused, B04–B06 remain blocked and no production workers are enrolled. Updated
`docs/kb/deploy.md` with current release provenance, state, rollback requirements,
checks and the owner worker enrollment guide. Core product code was not changed.
