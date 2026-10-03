---
title: pin-kanban-0.1.5
date: 2026-10-03
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# pin-kanban-0.1.5

## Что сделано

- Production deploy of Core 0.1.371 was rejected before start: every managed preflight check reported
  `Managed preflight не пройден`. Cause: shared 0.1.15 (environments-v2 B02) returns
  `parseEnvironmentManifest` fields in another key order (`kind` last), and the Kanban preflight compared
  `environment.json` byte-for-byte with the re-serialized manifest.
- Operator unblock: production `environment.json` rewritten in the new key order (same values; backup
  `environment.json.key-order-bak-20261003` next to it).
- Kanban 0.1.5 (`a9ec1a3d`, sislex/sislexa-kanban#18) compares manifests as JSON values in the release
  preflight (`python3`) and in the stand `directories` stage; pinned here.

## Что выяснили (факты, которых не было в KB)

- The preflight hides the failing step: an empty script output becomes the same message for all eight
  checks. Reproduce the steps on the machine to find the failing one.
- Delivery Control installed-adapter tests fail with `operator_path_not_protected` when the checkout sits
  under a world-writable parent (`~/PhpstormProjects` is `rwxrwxrwx`); run its gate from a 0700 directory.

## Куда занесено

- docs/kb/deploy.md (Kanban pin and the manifest comparison).

## Открытые вопросы / что осталось

- Production deployment of the release with this pin.
