---
title: image-studio-runner-sandbox
date: 2026-09-23
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# image-studio-runner-sandbox

## Completed

- Diagnosed the production Image Studio failure in the LLM Runner sandbox.
- Released and deployed LLM Runner 0.3.2 for the Ubuntu AppArmor user-namespace policy.
- Released and deployed LLM Runner 0.3.3 with Pillow and ImageMagick.
- Verified a real Codex `acceptEdits` run that created and exposed a PNG.

## New facts

- Docker's default policy and Ubuntu 24.04 AppArmor blocked Codex Bubblewrap namespaces.
- The previous runner image did not include either renderer named in the Image Studio prompt.

## Recorded in

- `docs/kb/deploy.md`
- `sislex/llm-runner/docs/operations.md`

## Open questions

- None for this incident.
