---
title: identity-release-package-alignment
date: 2026-10-19
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# Identity release package alignment

The release train published Identity 1.5.1 but changed only its service pin. The Core gate correctly rejected the remaining 1.5.0 embedded package in the S3 exact-provider manifest.

Applied the published 1.5.1 owner archive, verified its source and digests, and aligned Core package references, archive inventory, S3 manifest and A07 source. The focused provider test passes; the full Core gate remains required before promotion.

Recorded the consumer/service consistency rule in `docs/kb/data-auth.md`.
