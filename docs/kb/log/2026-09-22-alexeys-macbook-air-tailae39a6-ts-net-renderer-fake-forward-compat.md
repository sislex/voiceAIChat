---
title: Renderer fake forward compatibility
date: 2026-09-22
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# Renderer fake forward compatibility

## Completed

- Kept `RendererApi` as a complete application host contract.
- Moved additive-channel tolerance to the independently released UI Foundation test fake.

## Learned

- Optional keys in the central mapped API type leak `undefined` into every generic channel consumer.
- A versioned library test fake can accept later host channels without weakening the runtime bridge contract.

## Recorded in

- `docs/kb/shared.md`

## Remaining work

- Publish UI Foundation 0.1.7 and pin it in the Core UI release.
