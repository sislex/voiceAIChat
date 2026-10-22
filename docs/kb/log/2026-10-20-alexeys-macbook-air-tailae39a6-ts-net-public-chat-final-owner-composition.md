---
title: public-chat-final-owner-composition
date: 2026-10-20
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# public-chat-final-owner-composition

## Changes

- Pinned the verified UI 1.5.27, Identity 1.5.2, Billing 1.2.3,
  Runner 0.3.8 and runner-contracts 0.1.3 archives. The UI provenance records
  its actual Shared 0.1.43 requirement.
- Retained both reviewed Identity baselines in the Shared release packer.
- Integrated the independently reviewed recovery target binding correction.
- Recorded official owner publications separately from running deployment state.
- Aligned the current S3 provider inventory with the same verified archives.
- Advanced the four exact provider source commits in A07 acceptance; SDK,
  Analytics and all verification logic remain unchanged.
- Separated absent TTS deep-link coverage from configured TTS outage diagnostics
  in the published-UI browser integration fixture.

## Findings

- Composition updates archive identities but retains transitive lock metadata.
  Refreshing the exact Runner URL with npm corrected its stale contracts edge;
  the subsequent clean install passed.
- The Shared release test packages committed HEAD, so a baseline pin change
  also requires its post-commit run.
- A stale S3 inventory made the initial combined gate reject Identity's old pin.
  The failed-file rerun passed after updating the four provider rows; task and
  interface annotations remain unchanged.
- The following tooling stage also retained old A07 source SHAs. Its real
  loopback acceptance and S3 preflight rerun passed with the reviewed releases.
- The following browser stage still expected a TTS diagnostic for an absent
  module. The published UI intentionally hides that route; the integration
  fixture now checks absence and configured outages as separate behaviors.
- The unchanged universal-search integration then exposed a real mobile focus
  regression: closing the sidebar before the palette made its opener inert.
  A second owner regression covers different-chat and same-chat result selection.
  The owner fix preserves the opener on Escape and places navigation focus outside
  the closed drawer. Core's original focus assertion remains unchanged.
- The viewport matrix now starts a fresh document for each case. A same-hash
  navigation retained the correctly restored mobile drawer between cases and
  made the next case's open action hit its backdrop. Authentication storage and
  every existing behavioral assertion remain unchanged.

## References

- [Testing operations](../testing-operations.md)
- [Deployment recovery](../deploy.md)
- [Public chat launch plan](../../plans/public-chat-v1.md)

## Validation and deployment boundary

- Canonical UI 1.5.27 pack: 3,591 main UI tests, 47 browser tests and eight Core system
  tests passed, together with owner workspace checks. Exact source and archive
  digests are in the launch plan.
- The focused settings browser rerun passed all six enabled tests; the existing
  Electron opt-in case remains skipped. Both configured resource diagnostics and
  absent-module navigation were verified against the published UI.
- All 18 universal-search consumer checks passed with the original assertions
  and independently reviewed viewport isolation.
- The combined Core gate and final local stand acceptance follow this composition.
  Source publication does not change the protected old full-feature deployment.
- Public commissioning still needs its separate environment, DNS, outbound mail
  and dedicated service authentication.
