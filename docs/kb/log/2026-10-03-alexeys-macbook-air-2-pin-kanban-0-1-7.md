---
title: pin-kanban-0.1.7
date: 2026-10-03
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# pin-kanban-0.1.7

## Что сделано

- Pinned Kanban 0.1.7 (`c0107d6f`, sislex/sislexa-kanban#23): detached commands start a session
  through `setsid` or, on macOS, `perl POSIX::setsid`.

## Что выяснили (факты, которых не было в KB)

- On the U02 stand (MakBook M1 16) «Применить» stayed `pending` with an empty apply log: macOS has no
  `setsid`. The same affected the snapshot file server and the agent update button.
- Owner images are amd64-only; arm64 machines need `docker pull --platform linux/amd64` (Core #328 for the
  stand pull stage; `environment-apply.sh` pulls switched images too).

## Куда занесено

- docs/kb/deploy.md.

## Открытые вопросы / что осталось

- Release and deploy; repeat the stand apply.
