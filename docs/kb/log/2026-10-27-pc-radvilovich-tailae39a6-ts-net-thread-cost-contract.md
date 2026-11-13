---
title: thread-cost-contract
date: 2026-10-27
machine: pc-radvilovich-tailae39a6-ts-net
author: voiceAIChat agent
---

# thread-cost-contract

## Changes

Shared now exports thread-cost contracts through its barrel, adds encoded route
builders and a strict summary result type, and explicitly validates reset-mode
strings. Contract tests cover route encoding and valid/invalid modes.

## Verified findings

The existing nullable reset response remains necessary for summarize:false.
Baseline input includes cache reads and averages up to three measured turns;
recommendations use absolute last-turn input rather than the delta.

## Knowledge locations

- docs/kb/protocol.md — contract, settings persistence and test pointers.
- docs/kb/clients.md — Core UI ownership and verification boundary.

## Remaining verification

ThreadCostPanel and UI DOM tests are absent from this Core checkout. Verify the
reported UI behavior in sislex/sislexa-core-ui before documenting it as implemented.
