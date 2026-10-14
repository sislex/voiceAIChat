---
title: system-gate-local-sha-regression
date: 2026-10-14
machine: alexeys-macbook-air-tailae39a6-ts-net
author: voicechat-ci
---

# system-gate-local-sha-regression

## Changes

- Added TC1 coverage for an explicit local SHA after Core HEAD advances and for clean source/fixture working trees. All 17 system-gate tests passed; TC1–TC4 coverage markers remain present.
- Re-ran `node scripts/system-gate.mjs --owners playwrightreader` against Core `bd6b51c4159c08052664e059e360fa3034eab6d6`. All 29 owner scenarios passed, including the three failures reported by integration_tests. No owner code, pins, timeouts or assertions changed.

- `npm run gate:fast` passed with exit 0, including its automatically selected full Core and browser checks. The first MCP invocation hit the 300-second transport limit; a background rerun persisted its successful exit code in `artifacts/SISL-718-gate-fast.exit`.

## Verified contracts

- A ready fixture is preserved solely by the package-lock.json marker; owner-host HEAD validation remains authoritative.
- Incomplete fixture recovery uses an encoded local file URL and preserves HTTPS origin. The process guard rejects live Git processes and failed, empty or malformed inspection.
- Preparation follows owner HEAD validation; failure stops suites and later owners. Dry-run performs neither preparation nor cleanup.

## Documentation

- docs/kb/testing-operations.md#extracted-application-test-ownership

## Remaining uncertainty

- The earlier browser restart and wheel assertion timeouts did not reproduce on the same Core SHA. Their root cause is not established by this successful rerun; no browser fix is claimed.
