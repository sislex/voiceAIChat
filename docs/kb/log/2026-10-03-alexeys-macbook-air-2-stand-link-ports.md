---
title: stand-link-ports
date: 2026-10-03
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# stand-link-ports

## Что сделано

- `environment_stand.py`: optional `VC_STAND_LINK_PORTS` publishes listed services on loopback
  ports through a generated `stand-links.yml`; module machines may run several modules.

## Что выяснили (факты, которых не было в KB)

- environments-v3 C17 stopped: agent links connect to `127.0.0.1:<port>` on the server machine, but
  stand services other than Core were never published and C15 refused any other published port.

## Куда занесено

- docs/kb/deploy.md (Managed stands), docs/plans/environments.md (stage 3 decision 5).

## Открытые вопросы / что осталось

- C17 retry uses this mechanism.
