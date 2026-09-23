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
- Released and deployed LLM Runner 0.3.4 with the isolated profile as the default workspace.
- Verified a real Codex `acceptEdits` run without `cwd` that created a PNG readable through the Runner file API.
- Recorded the external GitHub billing block on the 0.3.4 GHCR publish job; the production image was built and verified directly on the runner host.

## New facts

- Docker's default policy and Ubuntu 24.04 AppArmor blocked Codex Bubblewrap namespaces.
- The previous runner image did not include either renderer named in the Image Studio prompt.
- Runs without a project directory inherited read-only `/app` instead of the user's profile.

## Recorded in

- `docs/kb/deploy.md`
- `sislex/llm-runner/docs/operations.md`

## Open questions

- None for this incident.
