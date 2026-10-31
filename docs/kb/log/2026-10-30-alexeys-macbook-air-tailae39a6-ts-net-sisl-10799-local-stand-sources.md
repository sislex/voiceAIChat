---
title: sisl-10799-local-stand-sources
date: 2026-10-30
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# sisl-10799-local-stand-sources

## Changes

Frontend metadata now comes from the built manifest. Per-service source/configuration
records prevent reuse after a source switch; detach stops obsolete frontend watchers.
Local clone preparation receives the host environment shared root instead of using
the agent HOME. Supervised logs are bounded and startup errors include service tails.

## Evidence and documentation

Updated deploy.md and server-internals.md. Process tests cover reuse, switching,
detach, metadata, failure tails and log rotation; workspace tests cover seed selection.
The local UI health endpoint responds on 25273, but conversation API access returned
unauthorized, so acceptance against conversation cf2fda81 remains unverified.
