---
title: identity-shared-subpath-compatibility
date: 2026-10-19
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# Identity Shared subpath compatibility

Identity 1.5.1 consumes public Shared subpaths. Published Shared already exports both extensionless and .js subpaths, but the Core workspace exposed only its root. Aligned workspace exports and the reviewed Identity peer baseline. Added runtime import coverage for the subpaths used by Identity.

Core typechecking and focused provider/release-tool checks pass. The full Core gate remains required before promotion. Recorded the distinction in `docs/kb/testing-operations.md`.
