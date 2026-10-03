---
title: Stand machine lifecycle scripts
date: 2026-10-03
machine: alexeys-macbook-air-2
author: unknown
---

# Stand machine lifecycle scripts

Implemented the stand Compose overlay and provision/remove entrypoints using
`compose_env.py`. Validation protects the production checkout and data volume;
provision builds Core sequentially, pulls missing owner images and verifies
HEAD and container health. Removal keeps data unless explicitly requested.
JSON stage output redacts dotenv values.

Documented the CLI, exit codes, safeguards and commissioning boundary in
`docs/kb/deploy.md`. Added fake Docker/curl contracts to the existing production
script suite, plus a Compose config-only integration check that skips when
Docker Compose is unavailable. Real machine commissioning remains with the
operator; no persistent services were started for this task.
