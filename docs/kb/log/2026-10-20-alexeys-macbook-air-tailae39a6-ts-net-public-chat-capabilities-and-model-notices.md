---
title: public-chat-capabilities-and-model-notices
date: 2026-10-20
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# public-chat-capabilities-and-model-notices

## Changes

- Added optional Analytics configuration to system capabilities. The value
  reflects the managed dependency, including when its endpoint is offline.
- Suppressed inherited account model/provider substitution notices under an
  explicit deployment model policy. Conversation/project choices, transport
  notices and deployments without that policy preserve existing warnings.

- Updated Core invitation subjects/bodies and a user-visible task error to the
  product name `sislexa`; storage names and protocol identifiers are unchanged.

## Evidence

- The application manifest alone cannot identify an unconfigured Analytics
  dependency; exposing configuration avoids confusing removal with an outage.
- A new account can retain legacy Claude/Astra preferences while the settings
  response and actual first turn use deployment Luna. Those implicit defaults
  should not add warnings to the stored answer.
- Regression tests reproduced eight failures before implementation. The focused
  suite then passed all 13 tests, including explicit overrides, ordinary
  deployments, actual component configuration and secret redaction.

- First broad gate: 577 passed, one existing session hook timed out at 60 seconds.
  The failed file was rerun first and passed all 31 tests without source changes.
  The original failure log is retained. The required gate rerun passed: 1,183
  related server tests (31 existing skips), 147 related Shared tests, 38 focused
  tests and affected workspace typecheck/build. The full Shared suite also
  passed all 1,287 tests; repository-wide typecheck passed.
- Independent review found no blockers in the capability/notices changes or
  Core invitation branding.

## Knowledge

- `docs/kb/deploy.md`
- `docs/kb/protocol.md`

## Follow-up

- Owner UI consumption and combined candidate acceptance follow the committed
  contract. Production `89.125.68.35` remains unchanged.
