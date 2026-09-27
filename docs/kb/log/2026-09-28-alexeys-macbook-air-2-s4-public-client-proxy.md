---
title: s4-public-client-proxy
date: 2026-09-28
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# s4-public-client-proxy

## Work completed

- Pinned the S4 Identity archive with its exact source and digest.
- Verified OAuth preflight and consent headers through Core's installed Identity RPC.

## Verified findings

- The previous managed Identity proxy omitted OPTIONS and consent security headers.
- The pinned Identity provider now carries these responses across the component RPC.

## Knowledge updated

- docs/kb/data-auth.md

## Remaining work

- Exercise a clean external browser client through Core's public HTTP origin before S4 acceptance.
