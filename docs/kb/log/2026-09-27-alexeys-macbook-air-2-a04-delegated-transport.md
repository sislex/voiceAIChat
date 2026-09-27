---
title: a04-delegated-transport
date: 2026-09-27
machine: alexeys-macbook-air-2
author: unknown
---

# a04-delegated-transport

## Changes

- Added standalone delegated REST/WS admission and resource-bound v1 handshake.
- Restricted unsupported mutations, attachments and child tools; prevented account prompt inheritance and unmetered application execution.
- Added Core transport, resource, revocation and billing-fallback regression tests.

## Findings

- Pinned Billing requires a session bearer for reserve/start. Pinned Identity's session verifier does not accept application grants. Standalone execution therefore needs a provider-owned admission/exchange contract.

## Documentation

- docs/kb/data-auth.md

## Outstanding

- A04 remains blocked on delegated Billing admission; this is not operator commissioning.
- The worker sandbox could not run its gate because npm registry DNS failed. The operator recovered the patch, fixed a duplicate Fastify request decorator, and ran the full Core gate successfully on the recovered revision.
- The operator regenerated KB metadata and the index with normal Git access.
