---
title: release-317-verification
date: 2026-09-21
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# release-317-verification

## Release

Core PR #217 merged and release 0.1.317 deployed successfully through installed
voicechat-deploy at 11:06:10 UTC. Identity 1.2.0, Billing 1.0.0, SDK 1.0.0 and
Image Studio 1.0.5 are the pinned independent components. All fifteen application
images match the release and configured healthchecks pass.

## Evidence

Both canonical gates passed, including 2,387 Core tests and 807 browser tests.
The fresh 10:35 UTC production dump passed full restore and repeatable stable-ID
migration. Two model requests were allowed to finish during admission drain;
normal admission was restored immediately after deployment readiness.
Production checks passed existing-session continuity, stable identity, tenant
isolation, provider scopes/revocation, frontend integrity and tool callbacks.
Billing rejected over-budget and cross-tenant operations and duplicate settlement.
HTTPS login/account and image upload/read/viewer passed; local standalone studio
login, gallery creation, upload/viewer/logout and mobile layout also passed.
Release test accounts, galleries, ledger rows and private credentials were removed.

## Knowledge

Updated deploy.md, testing-operations.md and the delivery roadmap. Fresh Core
profiles show onboarding and then the shell tour; wait for both when testing
real pointer actions. File upload alone can pass while an overlay blocks clicks.
The local SSH tunnel now reconnects after sleep; forced-disconnect recovery passed.

## Remaining work

Real execution attribution, enforceable work allocations, durable usage delivery
and reconciliation remain the next increment. This release is the foundation,
not completion of the roadmap's first three end-to-end deliverables.
