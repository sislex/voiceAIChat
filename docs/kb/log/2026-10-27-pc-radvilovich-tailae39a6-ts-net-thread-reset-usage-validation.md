---
title: thread-reset-usage-validation
date: 2026-10-27
machine: pc-radvilovich-tailae39a6-ts-net
author: voicechat-ci
---

# Thread reset usage validation

## Changes

Reviewed the recovered SISL-783 implementation and its compatibility route.
Thread cost now excludes replies without input/cache-read measurements while
retaining explicitly measured zero usage. Added regression coverage for estimate
fallback and preservation of the last measured reset recommendation.
Chat settings reuse the shared ThreadResetMode type.

## Verified facts

A provider session id alone does not establish that a reply has measured usage.
Treating missing usage as zero can replace a valid reset recommendation with ok.
The scalar SQL projection distinguishes absent fields from measured zero.

## Knowledge updated

- docs/kb/llm.md#session-cost-and-summary-reset

## Validation

Targeted thread, settings and REST contract suites passed (143 tests).
`npm run gate:fast` passed, including Core (2,326 tests), Shared (1,298 tests),
type checks, builds and selected consumer contracts.

