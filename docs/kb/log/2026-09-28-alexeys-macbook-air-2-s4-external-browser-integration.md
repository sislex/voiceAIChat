---
title: s4-external-browser-integration
date: 2026-09-28
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# s4-external-browser-integration

## Что сделано

- Added a Core-owned loopback HTTP integration test against the pinned Identity 1.4.2 provider and an in-memory database.
- Covered public redirect enrollment without an application component grant, preflight, consent, S256 code exchange, refresh rotation and replay revocation.

## Что выяснили (факты, которых не было в KB)

- The Core session proxy preserves Identity CORS and consent protection headers across the internal component RPC.
- A replayed refresh token revokes the token family, including its latest access token.

## Куда занесено

- docs/kb/data-auth.md, Public-client browser authorization transport (S4).

## Открытые вопросы / что осталось

- A real external app UI callback and deployed HTTPS browser run remain E07 acceptance work; this repository has no product app implementing that navigation.
