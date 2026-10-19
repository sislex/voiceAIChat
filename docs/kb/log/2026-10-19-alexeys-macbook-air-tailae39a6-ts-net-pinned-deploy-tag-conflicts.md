---
title: pinned-deploy-tag-conflicts
date: 2026-10-19
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# Pinned deployment and conflicting historical tags

The Core 0.1.480 production launcher stopped before Docker because fetching all
tags rejected unrelated historical tag conflicts. The running 0.1.479 service
was unaffected.

Pinned deployments with an explicit version now pull without tags. The existing
exact-commit, clean-checkout, host-lock and delivery-authority checks remain in
place. Deployments that need tag-derived metadata retain the failing tag fetch.
Regression coverage exercises both paths and the existing safety checks.

Documented in [deployment](../deploy.md#local-owner-image-delivery).
