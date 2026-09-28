---
title: core-release-retention
date: 2026-09-28
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# Core release retention

## Changed

- Added post-health retention planning for immutable Core release directories and
  matching local Core image tags. Protected paths and unfinished operations remain.
- Added build-cache and dangling-image pruning with deployment log receipts.
- Added isolated retention tests.

## Observed

- Production ran Core 0.1.336 from `/opt/voicechat/releases`; 0.1.335 remained
  available for rollback. The unreferenced 0.1.334 directory and local Core image
  were removed under the deployment lock, freeing about 1 GiB.
- The retired personal runner image is still referenced by a stopped container
  with named data and profile volumes, so it was retained.
- Production now has a daily logrotate rule for `voicechat-deploy.log` with a
  20 MiB early rotation threshold and 14 retained compressed logs. Docker's
  largest current container JSON log was about 11 MiB, so Docker daemon log
  settings were not changed or restarted during this maintenance.

## Knowledge base

- `docs/kb/deploy.md`

## Remaining

- Publish and install the updated launcher in a future authorized Core release.
