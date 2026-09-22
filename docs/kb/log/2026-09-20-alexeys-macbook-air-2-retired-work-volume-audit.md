---
title: retired-work-volume-audit
date: 2026-09-20
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# retired-work-volume-audit

## Findings

Read-only checks found no container or bind-mount references to the 2.5 GiB
`voiceaichat_vc-runner-work-data` volume on the core host. Confirmed the active
remote runner is healthy and uses a different host-local volume. Read the entire
migration backup archive successfully; it contains work-data profiles.

## Knowledge updated

- docs/kb/deploy.md: current volume usage, backup evidence and rollback consequence.

## Authorized removal

After the read-only audit, the operator explicitly requested deletion. Rechecked
all container and bind-mount references, removed only the named core-host volume,
and confirmed its absence. Core health, dependency readiness and the remote work
runner health passed afterward. Root filesystem free space was about 11 GiB.
The remote profiles and migration backup were retained. The original dirty
checkout remains untouched; evidence is in the existing isolated worktree.
