---
title: identity-extraction
date: 2026-09-20
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# identity-extraction

## Changes

Extracted authentication, registration, recovery/TOTP, account/profile/session UI,
identity storage and SQL infrastructure to sislex/identity. Core uses pinned
adapters, remote identity verification and explicit Core callbacks. Preserved the
embedded development mode through the same upstream implementation. Added standalone
process/asset/auth smoke, PostgreSQL upgrade and authorization boundary tests.

## Findings

Account cache cancellation is a host port, as are performance marks and desktop
migration. The pure sessions-core archive must not depend on the full distribution,
otherwise Make's isolated build acquires React and database drivers. Machine enrollment
in apps/login-application is unrelated to user sign-in. Previously extracted product
workspaces retain adapters only; new source-ownership checks enforce that boundary.

## Knowledge updated

- docs/kb/data-auth.md
- docs/kb/architecture.md
- docs/kb/ui.md
- docs/plans/identity-extraction.md

## Validation and delivery

Independent gates (including real PostgreSQL), standalone startup/login and mobile
browser session-dialog checks passed. Identity 1.0.0 was published at `85ee08cdc7e3004a15417a1f86781ec68a0df47b`;
both GitHub CI runs passed. The independent linux/amd64 image passed startup, asset
and login checks. The Release Center context also passed npm ci, build and process
smoke; its adapter declares the isolated typecheck dependencies and native build
tools explicitly. A restored production PostgreSQL backup initialized successfully with every user
and session row unchanged. A real two-process Core/Identity check passed login,
account aggregation, asset proxy, role-change socket closure, remote deletion and
revoked access. Web/Electron route budgets passed without increasing thresholds;
a pure catalog factory prevents unrelated consumers loading release metadata.
The complete Core `gate:fast` and pre-release `gate` both exited successfully,
including all 807 application browser tests in each run.
An earlier route run failed when the required external font stylesheet was unavailable;
the unchanged isolated route suite and subsequent full gate both passed. No budgets
or mandatory checks were weakened. A fresh production database dump was also saved privately and its archive directory
validated. Core 0.1.315 was published through PR #211 and deployed successfully via installed
`voicechat-deploy` at 11:03:22 UTC. The initial readiness check caught a Web Reader
port mismatch in the prepared configuration; preserving the previous port 8795 and
recreating Core through the canonical deployer resolved it. All readiness checks,
existing-user/session/password continuity, HTTP/WS revocation, mobile account UI,
provider isolation, gallery isolation, voice round trip and external Codex checks
passed. Temporary test users and private credential files were removed. See the
production 0.1.315 section in deploy.md for immutable release and rollback evidence.
